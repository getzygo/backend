/**
 * Signin Routes
 *
 * POST /api/v1/auth/signin - Authenticate user
 * Per UNIFIED_AUTH_STRATEGY.md Section 6.1.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { signInWithPassword } from '../../services/supabase.service';
import { getUserByEmail, verifyPassword } from '../../services/user.service';
import { getUserTenants, getTenantBySlug, isTenantMember, getTenantMembershipWithRole } from '../../services/tenant.service';
import { checkVerificationStatus } from '../../services/verification.service';
import { mfaService } from '../../services/mfa.service';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';
import { authMiddleware } from '../../middleware/auth.middleware';
import { createAuthToken } from '../../services/auth-token.service';
import { trustDevice, isDeviceTrusted } from '../../services/trusted-device.service';
import { createDeviceHash, parseUserAgent } from '../../services/device-fingerprint.service';
import { createSession } from '../../services/session.service';

const app = new Hono();

// Signin request schema
const signinSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  tenant_slug: z.string().optional(),
  mfa_code: z.string().length(6).optional(),
  trust_device: z.boolean().optional(),
});

/**
 * POST /api/v1/auth/signin
 * Authenticate user and return session
 */
app.post('/', zValidator('json', signinSchema), async (c) => {
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();

  // Get user from database
  const user = await getUserByEmail(body.email);

  if (!user) {
    return c.json(
      {
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      },
      401
    );
  }

  // Check account status
  if (user.status === 'suspended') {
    return c.json(
      {
        error: 'account_suspended',
        message: 'Your account has been suspended. Please contact support.',
      },
      403
    );
  }

  if (user.status === 'deleted') {
    return c.json(
      {
        error: 'account_deleted',
        message: 'This account has been deleted.',
      },
      403
    );
  }

  // Check if account is locked
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const lockoutSeconds = Math.ceil(
      (new Date(user.lockedUntil).getTime() - Date.now()) / 1000
    );
    const remainingMinutes = Math.ceil(lockoutSeconds / 60);
    return c.json(
      {
        error: 'account_locked',
        message: `Account is temporarily locked. Try again in ${remainingMinutes} minutes.`,
        locked_until: user.lockedUntil,
        lockout_in: lockoutSeconds,
        remaining_attempts: 0,
      },
      403
    );
  }

  // Verify password
  const passwordValid = await verifyPassword(body.password, user.passwordHash);

  if (!passwordValid) {
    // Increment failed login attempts
    const attempts = parseInt(user.failedLoginAttempts || '0', 10) + 1;
    const MAX_ATTEMPTS = 5;

    if (attempts >= MAX_ATTEMPTS) {
      // Lock account for 15 minutes
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      const lockoutSeconds = 15 * 60;

      await db
        .update(users)
        .set({
          failedLoginAttempts: attempts.toString(),
          lockedUntil: lockUntil,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // Audit log
      await db.insert(auditLogs).values({
        userId: user.id,
        action: 'account_locked',
        resourceType: 'user',
        resourceId: user.id,
        details: { reason: 'too_many_failed_attempts', attempts },
        ipAddress: ipAddress || undefined,
        userAgent: userAgent || undefined,
        status: 'failure',
      });

      return c.json(
        {
          error: 'account_locked',
          message: 'Too many failed attempts. Account locked for 15 minutes.',
          remaining_attempts: 0,
          lockout_in: lockoutSeconds,
        },
        403
      );
    }

    const remainingAttempts = MAX_ATTEMPTS - attempts;

    await db
      .update(users)
      .set({
        failedLoginAttempts: attempts.toString(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return c.json(
      {
        error: 'invalid_credentials',
        message: 'Invalid email or password',
        remaining_attempts: remainingAttempts,
      },
      401
    );
  }

  // Check MFA if enabled
  if (user.mfaEnabled) {
    // Check if this device is trusted (can skip MFA)
    const isTrusted = await isDeviceTrusted({
      userId: user.id,
      userAgent: userAgent || undefined,
      ipAddress: ipAddress || undefined,
    });

    if (!isTrusted) {
      if (!body.mfa_code) {
        return c.json(
          {
            error: 'mfa_required',
            message: 'MFA verification required',
            require_mfa_code: true,
          },
          403
        );
      }

      const mfaResult = await mfaService.verifyMfaCode(user.id, body.mfa_code);
      if (!mfaResult.verified) {
        return c.json(
          {
            error: 'mfa_invalid',
            message: mfaResult.error || 'Invalid MFA code',
          },
          403
        );
      }

      // Trust device if requested after successful MFA verification
      if (body.trust_device) {
        await trustDevice({
          userId: user.id,
          userAgent: userAgent || undefined,
          ipAddress: ipAddress || undefined,
        });
      }
    }
  }

  // Sign in with Supabase to get session
  const authResult = await signInWithPassword(body.email, body.password);

  if (authResult.error || !authResult.session) {
    console.error('Supabase signin error:', authResult.error);
    return c.json(
      {
        error: 'signin_failed',
        message: 'Authentication failed',
      },
      500
    );
  }

  // Reset failed login attempts and update last login
  await db
    .update(users)
    .set({
      failedLoginAttempts: '0',
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress || undefined,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Create session record for session management
  const deviceInfo = parseUserAgent(userAgent);
  await createSession({
    userId: user.id,
    refreshToken: authResult.session.refresh_token,
    deviceName: deviceInfo.deviceName,
    browser: deviceInfo.browser,
    os: deviceInfo.os,
    ipAddress: ipAddress || undefined,
  });

  // Get user's tenants
  const userTenants = await getUserTenants(user.id);

  // If tenant_slug provided, verify membership
  let targetTenant = null;
  let verificationStatus = null;

  if (body.tenant_slug) {
    targetTenant = await getTenantBySlug(body.tenant_slug);

    if (!targetTenant) {
      return c.json(
        {
          error: 'tenant_not_found',
          message: 'Workspace not found',
        },
        404
      );
    }

    const isMember = await isTenantMember(user.id, targetTenant.id);
    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check verification status for this tenant
    verificationStatus = await checkVerificationStatus(user, targetTenant.id);
  } else if (userTenants.length === 0) {
    // No tenants - redirect to onboarding to create first workspace
    return c.json({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        email_verified: user.emailVerified,
        phone_verified: user.phoneVerified,
        mfa_enabled: user.mfaEnabled,
      },
      session: {
        access_token: authResult.session.access_token,
        refresh_token: authResult.session.refresh_token,
        expires_at: authResult.session.expires_at,
      },
      redirect_url: '/onboarding',
      message: 'Please create your first workspace',
    });
  }
  // Note: We no longer auto-select single tenant - always show workspace picker
  // This gives users better control and prevents confusion after logout

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'login',
    resourceType: 'user',
    resourceId: user.id,
    details: {
      tenant_id: targetTenant?.id,
      tenant_slug: targetTenant?.slug,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Determine redirect URL
  let redirectUrl = '/select-workspace';
  if (targetTenant) {
    if (verificationStatus && !verificationStatus.complete) {
      redirectUrl = '/complete-profile';
    } else {
      // Get user's membership with role for this tenant
      const membership = await getTenantMembershipWithRole(user.id, targetTenant.id);
      if (!membership) {
        return c.json(
          { error: 'membership_not_found', message: 'User membership not found' },
          500
        );
      }

      // Map user's tenant memberships for the switcher UI (cached, no API calls needed)
      const tenantMemberships = userTenants.map((m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        slug: m.tenant.slug,
        plan: m.tenant.plan,
        role: {
          id: m.role.id,
          name: m.role.name,
        },
        isOwner: m.isOwner,
      }));

      // Generate secure opaque auth token stored in Redis
      // Include Supabase tokens so tenant app can make authenticated API calls
      const authToken = await createAuthToken({
        userId: user.id,
        tenantId: targetTenant.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl || undefined,
        avatarSource: user.avatarSource || undefined,
        emailVerified: user.emailVerified,
        emailVerifiedVia: user.emailVerifiedVia,
        roleId: membership.role.id,
        roleName: membership.role.name,
        roleSlug: membership.role.slug,
        isOwner: membership.isOwner,
        supabaseAccessToken: authResult.session.access_token,
        supabaseRefreshToken: authResult.session.refresh_token,
        tenantMemberships, // Cached tenant list for switcher UI
      });
      redirectUrl = `https://${targetTenant.slug}.zygo.tech?auth_token=${authToken}`;
    }
  }

  // Build response
  const response: Record<string, unknown> = {
    user: {
      id: user.id,
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
      email_verified: user.emailVerified,
      phone_verified: user.phoneVerified,
      mfa_enabled: user.mfaEnabled,
    },
    session: {
      access_token: authResult.session.access_token,
      refresh_token: authResult.session.refresh_token,
      expires_at: authResult.session.expires_at,
    },
    redirect_url: redirectUrl,
  };

  // Add verification status if we have a target tenant
  if (verificationStatus) {
    response.verification_status = {
      complete: verificationStatus.complete,
      missing: verificationStatus.missing,
      deadlines: verificationStatus.deadlines,
    };
  }

  // Add tenant list if user has multiple tenants and no specific tenant selected
  if (!body.tenant_slug && userTenants.length > 1) {
    response.tenants = userTenants.map((m) => ({
      id: m.tenant.id,
      name: m.tenant.name,
      slug: m.tenant.slug,
      type: m.tenant.type,
      plan: m.tenant.plan,
      role: {
        id: m.role.id,
        name: m.role.name,
      },
      is_owner: m.isOwner,
    }));
  }

  // Add current tenant if selected
  if (targetTenant) {
    response.current_tenant = {
      id: targetTenant.id,
      name: targetTenant.name,
      slug: targetTenant.slug,
      type: targetTenant.type,
      plan: targetTenant.plan,
    };
  }

  return c.json(response);
});

// Switch tenant request schema
const switchTenantSchema = z.object({
  tenant_slug: z.string().min(1, 'Tenant slug is required'),
});

/**
 * POST /api/v1/auth/switch-tenant
 * Switch to a different tenant workspace
 * Requires Supabase access token in Authorization header
 * Uses email-based lookup to handle OAuth users with mismatched IDs
 */
app.post('/switch-tenant', zValidator('json', switchTenantSchema), async (c) => {
  const { tenant_slug } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  // Get and validate authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'Missing or invalid authorization header',
      },
      401
    );
  }

  const token = authHeader.slice(7);

  // Validate token with Supabase
  const { getSession } = await import('../../services/supabase.service');
  const sessionResult = await getSession(token);

  if (sessionResult.error || !sessionResult.user) {
    return c.json(
      {
        error: 'unauthorized',
        message: sessionResult.error || 'Invalid or expired token',
      },
      401
    );
  }

  const supabaseUser = sessionResult.user;
  const userEmail = supabaseUser.email;

  if (!userEmail) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'No email found in token',
      },
      401
    );
  }

  // Look up user by email (handles OAuth users with different IDs)
  const user = await getUserByEmail(userEmail);

  if (!user) {
    return c.json(
      {
        error: 'user_not_found',
        message: 'User not found',
      },
      404
    );
  }

  // Check account status
  if (user.status !== 'active') {
    return c.json(
      {
        error: 'account_inactive',
        message: user.status === 'suspended'
          ? 'Your account has been suspended. Please contact support.'
          : 'Your account is not active.',
      },
      403
    );
  }

  const db = getDb();

  // Get target tenant
  const tenant = await getTenantBySlug(tenant_slug);

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_not_found',
        message: 'Workspace not found',
      },
      404
    );
  }

  // Get user's membership with role for this tenant (also verifies membership)
  const membership = await getTenantMembershipWithRole(user.id, tenant.id);

  if (!membership) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Get avatar from Supabase user metadata if not in our DB
  const supabaseMeta = supabaseUser.user_metadata || {};
  const avatarUrl = user.avatarUrl || supabaseMeta.avatar_url || supabaseMeta.picture;

  // Get all user's tenants for the switcher UI
  const userTenants = await getUserTenants(user.id);
  const tenantMemberships = userTenants.map((m) => ({
    id: m.tenant.id,
    name: m.tenant.name,
    slug: m.tenant.slug,
    plan: m.tenant.plan,
    role: {
      id: m.role.id,
      name: m.role.name,
    },
    isOwner: m.isOwner,
  }));

  // Generate secure opaque auth token stored in Redis
  // Include Supabase access token so tenant app can make authenticated API calls
  const authToken = await createAuthToken({
    userId: user.id,
    tenantId: tenant.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: avatarUrl,
    avatarSource: user.avatarSource || undefined,
    emailVerified: user.emailVerified,
    emailVerifiedVia: user.emailVerifiedVia,
    roleId: membership.role.id,
    roleName: membership.role.name,
    roleSlug: membership.role.slug,
    isOwner: membership.isOwner,
    supabaseAccessToken: token, // Pass current access token for API calls
    tenantMemberships, // Cached tenant list for switcher UI
  });

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'tenant_switch',
    resourceType: 'tenant',
    resourceId: tenant.id,
    details: {
      from_tenant: c.req.header('x-zygo-tenant-slug'),
      to_tenant: tenant_slug,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    auth_token: authToken,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      type: tenant.type,
      plan: tenant.plan,
    },
  });
});

/**
 * POST /api/v1/auth/signout
 * Sign out user and invalidate session
 */
app.post('/signout', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: true });
  }

  const token = authHeader.slice(7);

  try {
    const { signOut } = await import('../../services/supabase.service');
    await signOut(token);
  } catch (error) {
    console.error('Signout error:', error);
    // Still return success - token might already be invalid
  }

  return c.json({ success: true });
});

export default app;
