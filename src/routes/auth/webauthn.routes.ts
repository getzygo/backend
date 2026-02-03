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
import { generateAuthToken } from '../../services/auth-token.service';

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

  const result = await verifyRegistration(user.id, response, name, ipAddress, userAgent);

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

  const result = await verifyAuthentication(response, ipAddress, userAgent);

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

  // Create Supabase session
  const supabase = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });

  if (authError) {
    console.error('[WebAuthn] Failed to generate session:', authError);
    return c.json(
      {
        error: 'session_failed',
        message: 'Failed to create session.',
      },
      500
    );
  }

  // Generate opaque auth token for cross-domain redirect
  const authToken = await generateAuthToken(user.id, {
    access_token: authData.properties?.access_token || '',
    refresh_token: authData.properties?.refresh_token || '',
    expires_in: 3600,
    token_type: 'bearer',
  });

  // Update last login
  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress || null,
    })
    .where(eq(users.id, user.id));

  return c.json({
    success: true,
    auth_token: authToken,
    user: {
      id: user.id,
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
      email_verified: user.emailVerified,
      mfa_enabled: user.mfaEnabled,
    },
  });
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
