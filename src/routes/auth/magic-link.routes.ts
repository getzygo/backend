/**
 * Magic Link Routes
 *
 * POST /api/v1/auth/magic-link/send - Send magic link email
 * POST /api/v1/auth/magic-link/verify - Verify token and sign in
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { users, auditLogs, tenantMembers, tenants, roles } from '../../db/schema';
import { createMagicLink, verifyMagicLink } from '../../services/magic-link.service';
import { createAuthToken, type TenantMembership } from '../../services/auth-token.service';
import { generateSessionForUser } from '../../services/supabase.service';

const app = new Hono();

// Send magic link schema
const sendSchema = z.object({
  email: z.string().email('Invalid email address'),
  redirect_url: z.string().url().optional(),
});

// Verify magic link schema
const verifySchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

/**
 * POST /api/v1/auth/magic-link/send
 * Send a magic link to the user's email.
 */
app.post('/send', zValidator('json', sendSchema), async (c) => {
  const { email, redirect_url } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const result = await createMagicLink({
    email,
    redirectUrl: redirect_url,
    ipAddress,
    userAgent,
  });

  if (!result.success) {
    if (result.error === 'too_many_requests') {
      return c.json(
        {
          error: 'too_many_requests',
          message: 'Too many magic link requests. Please try again later.',
        },
        429
      );
    }

    return c.json(
      {
        error: 'send_failed',
        message: 'Failed to send magic link. Please try again.',
      },
      500
    );
  }

  // Always return success to prevent email enumeration
  return c.json({
    success: true,
    message: 'If an account exists with this email, a magic link has been sent.',
    expires_in: 15 * 60, // 15 minutes in seconds
  });
});

/**
 * POST /api/v1/auth/magic-link/verify
 * Verify a magic link token and create a session.
 */
app.post('/verify', zValidator('json', verifySchema), async (c) => {
  const { token } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const result = await verifyMagicLink(token, ipAddress, userAgent);

  if (!result.success) {
    const errorMessages: Record<string, string> = {
      invalid_or_expired_token: 'This magic link is invalid or has expired.',
      user_not_found: 'Account not found.',
      account_disabled: 'Your account has been disabled.',
    };

    return c.json(
      {
        error: result.error,
        message: errorMessages[result.error || ''] || 'Verification failed.',
      },
      400
    );
  }

  // Get the user
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.email, result.email!),
  });

  if (!user) {
    return c.json(
      {
        error: 'user_not_found',
        message: 'Account not found.',
      },
      404
    );
  }

  // Get user's tenant memberships with role info
  const memberships = await db
    .select({
      tenantId: tenantMembers.tenantId,
      isOwner: tenantMembers.isOwner,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      tenantPlan: tenants.plan,
      roleId: roles.id,
      roleName: roles.name,
      roleSlug: roles.slug,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .innerJoin(roles, eq(tenantMembers.primaryRoleId, roles.id))
    .where(
      and(
        eq(tenantMembers.userId, user.id),
        eq(tenantMembers.status, 'active')
      )
    );

  if (memberships.length === 0) {
    return c.json(
      {
        error: 'no_workspace',
        message: 'You are not a member of any workspace.',
      },
      403
    );
  }

  // Use the first tenant as default, or check redirect_url for tenant slug
  const targetMembership = memberships[0];

  // Build tenant memberships for switcher UI
  const tenantMemberships: TenantMembership[] = memberships.map((m) => ({
    id: m.tenantId,
    name: m.tenantName,
    slug: m.tenantSlug,
    plan: m.tenantPlan || 'free',
    role: {
      id: m.roleId,
      name: m.roleName,
    },
    isOwner: m.isOwner,
  }));

  // Generate Supabase session tokens for the user
  // This allows the tenant app to make authenticated API calls
  let supabaseAccessToken: string | undefined;
  let supabaseRefreshToken: string | undefined;

  const sessionResult = await generateSessionForUser(user.id);
  if (sessionResult.session) {
    supabaseAccessToken = sessionResult.session.access_token;
    supabaseRefreshToken = sessionResult.session.refresh_token;
    console.log('[MagicLink] Generated Supabase session for user:', user.id);
  } else {
    console.warn('[MagicLink] Could not generate Supabase session:', sessionResult.error);
  }

  // Generate opaque auth token for cross-domain redirect
  const authToken = await createAuthToken({
    userId: user.id,
    tenantId: targetMembership.tenantId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl || undefined,
    avatarSource: user.avatarSource || undefined,
    emailVerified: user.emailVerified,
    emailVerifiedVia: user.emailVerifiedVia,
    roleId: targetMembership.roleId,
    roleName: targetMembership.roleName,
    roleSlug: targetMembership.roleSlug,
    isOwner: targetMembership.isOwner,
    // Include Supabase tokens for authenticated API calls
    supabaseAccessToken,
    supabaseRefreshToken,
    tenantMemberships,
  });

  // Update last login
  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress || null,
    })
    .where(eq(users.id, user.id));

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'login',
    resourceType: 'user',
    resourceId: user.id,
    details: { method: 'magic_link' },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Build redirect URL
  const redirectUrl = result.redirectUrl || `https://${targetMembership.tenantSlug}.zygo.tech?auth_token=${authToken}`;

  return c.json({
    success: true,
    auth_token: authToken,
    redirect_url: redirectUrl,
    user: {
      id: user.id,
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
      email_verified: user.emailVerified,
      mfa_enabled: user.mfaEnabled,
    },
    tenant: {
      id: targetMembership.tenantId,
      name: targetMembership.tenantName,
      slug: targetMembership.tenantSlug,
    },
    requires_workspace_selection: memberships.length > 1,
    workspaces: memberships.length > 1 ? tenantMemberships : undefined,
  });
});

export default app;
