/**
 * WebAuthn Routes
 *
 * POST /api/v1/auth/webauthn/register/options - Generate registration challenge
 * POST /api/v1/auth/webauthn/register/verify - Verify and store passkey
 * POST /api/v1/auth/webauthn/authenticate/options - Generate auth challenge
 * POST /api/v1/auth/webauthn/authenticate/verify - Verify passkey login
 * GET /api/v1/auth/webauthn/credentials - List user passkeys
 * DELETE /api/v1/auth/webauthn/credentials/:id - Remove passkey
 * PATCH /api/v1/auth/webauthn/credentials/:id - Rename passkey
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';
import {
  generateRegistrationOpts,
  verifyRegistration,
  generateAuthenticationOpts,
  verifyAuthentication,
  getUserPasskeys,
  deletePasskey,
  renamePasskey,
} from '../../services/webauthn.service';
import { getSupabaseAdmin } from '../../services/supabase.service';
import { createAuthToken } from '../../services/auth-token.service';
import { getUserTenants, getTenantMembershipWithRole } from '../../services/tenant.service';
import { parseUserAgent } from '../../services/device-fingerprint.service';
import { createSession } from '../../services/session.service';
import crypto from 'crypto';

const app = new Hono();

// Registration verify schema
const registerVerifySchema = z.object({
  response: z.any(), // RegistrationResponseJSON
  name: z.string().max(100).optional(),
});

// Authentication options schema
const authOptionsSchema = z.object({
  email: z.string().email().optional(),
});

// Authentication verify schema
const authVerifySchema = z.object({
  response: z.any(), // AuthenticationResponseJSON
});

// Rename passkey schema
const renameSchema = z.object({
  name: z.string().min(1).max(100),
});

/**
 * POST /api/v1/auth/webauthn/register/options
 * Generate registration options for a new passkey.
 * Requires authentication.
 */
app.post('/register/options', authMiddleware, async (c) => {
  const user = c.get('user');

  const options = await generateRegistrationOpts(
    user.id,
    user.email,
    `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
  );

  return c.json(options);
});

/**
 * POST /api/v1/auth/webauthn/register/verify
 * Verify registration response and store the new passkey.
 * Requires authentication.
 */
app.post('/register/verify', authMiddleware, zValidator('json', registerVerifySchema), async (c) => {
  const user = c.get('user');
  const { response, name } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const origin = c.req.header('origin');

  const result = await verifyRegistration(user.id, response, name, ipAddress, userAgent, origin);

  if (!result.success) {
    const errorMessages: Record<string, string> = {
      challenge_expired: 'Registration session expired. Please try again.',
      verification_failed: 'Failed to verify passkey. Please try again.',
    };

    return c.json(
      {
        error: result.error,
        message: errorMessages[result.error || ''] || 'Registration failed.',
      },
      400
    );
  }

  return c.json({
    success: true,
    passkey_id: result.passkeyId,
    message: 'Passkey registered successfully.',
  });
});

/**
 * POST /api/v1/auth/webauthn/authenticate/options
 * Generate authentication options for passkey login.
 * Does not require authentication (used during login).
 */
app.post('/authenticate/options', zValidator('json', authOptionsSchema), async (c) => {
  const { email } = c.req.valid('json');

  const options = await generateAuthenticationOpts(email);

  return c.json(options);
});

/**
 * POST /api/v1/auth/webauthn/authenticate/verify
 * Verify authentication response and sign in.
 * Does not require authentication (used during login).
 */
app.post('/authenticate/verify', zValidator('json', authVerifySchema), async (c) => {
  const { response } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const origin = c.req.header('origin');

  const result = await verifyAuthentication(response, ipAddress, userAgent, origin);

  if (!result.success) {
    const errorMessages: Record<string, string> = {
      credential_not_found: 'Passkey not found.',
      challenge_expired: 'Authentication session expired. Please try again.',
      verification_failed: 'Failed to verify passkey. Please try again.',
    };

    return c.json(
      {
        error: result.error,
        message: errorMessages[result.error || ''] || 'Authentication failed.',
      },
      400
    );
  }

  // Get user
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, result.userId!),
  });

  if (!user) {
    return c.json(
      {
        error: 'user_not_found',
        message: 'User not found.',
      },
      404
    );
  }

  // Check user status
  if (user.status === 'suspended' || user.status === 'deleted') {
    return c.json(
      {
        error: 'account_disabled',
        message: 'Your account has been disabled.',
      },
      403
    );
  }

  // Update last login
  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress || undefined,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Create session record for session management
  const deviceInfo = parseUserAgent(userAgent);
  const passkeySessionToken = crypto.randomBytes(32).toString('hex');
  await createSession({
    userId: user.id,
    refreshToken: passkeySessionToken,
    deviceName: deviceInfo.deviceName,
    browser: deviceInfo.browser,
    os: deviceInfo.os,
    ipAddress: ipAddress || undefined,
  });

  // Get user's tenants
  const userTenants = await getUserTenants(user.id);

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'login_passkey',
    resourceType: 'user',
    resourceId: user.id,
    details: { method: 'passkey', tenant_count: userTenants.length },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Build response
  const responseData: Record<string, unknown> = {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
      email_verified: user.emailVerified,
      mfa_enabled: user.mfaEnabled,
    },
  };

  // Map user's tenant memberships for the switcher UI
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

  // If user has only one tenant, generate auth token directly
  if (userTenants.length === 1) {
    const membership = userTenants[0];
    const authToken = await createAuthToken({
      userId: user.id,
      tenantId: membership.tenant.id,
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
      tenantMemberships,
    });
    responseData.auth_token = authToken;
    // Use fragment (#) instead of query param (?) - fragments are NOT sent to server/logged
    responseData.redirect_url = `https://${membership.tenant.slug}.zygo.tech/#auth_token=${authToken}`;
  } else if (userTenants.length === 0) {
    responseData.redirect_url = '/create-workspace';
  } else {
    // Multiple tenants - show workspace picker
    responseData.tenants = userTenants.map((m) => ({
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
    responseData.redirect_url = '/select-workspace';
  }

  return c.json(responseData);
});

/**
 * GET /api/v1/auth/webauthn/credentials
 * List all passkeys for the current user.
 * Requires authentication.
 */
app.get('/credentials', authMiddleware, async (c) => {
  const user = c.get('user');

  const passkeys = await getUserPasskeys(user.id);

  return c.json({
    credentials: passkeys.map((pk) => ({
      id: pk.id,
      name: pk.name,
      device_type: pk.deviceType,
      last_used_at: pk.lastUsedAt?.toISOString(),
      created_at: pk.createdAt.toISOString(),
    })),
  });
});

/**
 * DELETE /api/v1/auth/webauthn/credentials/:id
 * Remove a passkey.
 * Requires authentication.
 */
app.delete('/credentials/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const passkeyId = c.req.param('id');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const success = await deletePasskey(passkeyId, user.id, ipAddress, userAgent);

  if (!success) {
    return c.json(
      {
        error: 'passkey_not_found',
        message: 'Passkey not found.',
      },
      404
    );
  }

  return c.json({
    success: true,
    message: 'Passkey removed successfully.',
  });
});

/**
 * PATCH /api/v1/auth/webauthn/credentials/:id
 * Rename a passkey.
 * Requires authentication.
 */
app.patch('/credentials/:id', authMiddleware, zValidator('json', renameSchema), async (c) => {
  const user = c.get('user');
  const passkeyId = c.req.param('id');
  const { name } = c.req.valid('json');

  const success = await renamePasskey(passkeyId, user.id, name);

  if (!success) {
    return c.json(
      {
        error: 'passkey_not_found',
        message: 'Passkey not found.',
      },
      404
    );
  }

  return c.json({
    success: true,
    message: 'Passkey renamed successfully.',
  });
});

export default app;
