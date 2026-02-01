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
import { getUserTenants, getTenantBySlug, isTenantMember } from '../../services/tenant.service';
import { checkVerificationStatus } from '../../services/verification.service';
import { mfaService } from '../../services/mfa.service';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';

const app = new Hono();

// Signin request schema
const signinSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  tenant_slug: z.string().optional(),
  mfa_code: z.string().length(6).optional(),
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
    const remainingMinutes = Math.ceil(
      (new Date(user.lockedUntil).getTime() - Date.now()) / 60000
    );
    return c.json(
      {
        error: 'account_locked',
        message: `Account is temporarily locked. Try again in ${remainingMinutes} minutes.`,
        locked_until: user.lockedUntil,
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
        },
        403
      );
    }

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
      },
      401
    );
  }

  // Check MFA if enabled
  if (user.mfaEnabled) {
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
  } else if (userTenants.length === 1) {
    // Auto-select single tenant
    targetTenant = userTenants[0].tenant;
    verificationStatus = await checkVerificationStatus(user, targetTenant.id);
  }

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

  // Generate auth token for redirect
  const authToken = Buffer.from(JSON.stringify({
    userId: user.id,
    tenantId: targetTenant?.id,
    exp: Date.now() + 300000, // 5 minutes
  })).toString('base64url');

  // Determine redirect URL
  let redirectUrl = '/select-workspace';
  if (targetTenant) {
    if (verificationStatus && !verificationStatus.complete) {
      redirectUrl = '/complete-profile';
    } else {
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
