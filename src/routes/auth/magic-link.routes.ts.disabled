/**
 * Magic Link Routes
 *
 * POST /api/v1/auth/magic-link/send - Send magic link email
 * POST /api/v1/auth/magic-link/verify - Verify token and sign in
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';
import { createMagicLink, verifyMagicLink } from '../../services/magic-link.service';
import { getSupabaseAdmin } from '../../services/supabase.service';
import { createAuthToken } from '../../services/auth-token.service';

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

  // Create Supabase session
  const supabase = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });

  if (authError) {
    console.error('[MagicLink] Failed to generate session:', authError);
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

  return c.json({
    success: true,
    auth_token: authToken,
    redirect_url: result.redirectUrl,
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

export default app;
