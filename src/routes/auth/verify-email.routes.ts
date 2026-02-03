/**
 * Email Verification Routes
 *
 * POST /api/v1/auth/verify-email - Verify email with code
 * POST /api/v1/auth/resend-email-verification - Resend verification email
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware';
import { emailService, sendWelcomeEmail } from '../../services/email.service';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';
import { rateLimit, RATE_LIMITS } from '../../middleware/rate-limit.middleware';

const app = new Hono();

// Apply rate limiting to all email verification routes
app.use('*', rateLimit(RATE_LIMITS.SENSITIVE));

// Verify email schema (authenticated)
const verifyEmailSchema = z.object({
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

// Verify email schema (public - email + code)
const verifyEmailPublicSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

/**
 * POST /api/v1/auth/verify-email/public
 * Verify email address with email + 6-digit code (no auth required)
 * The code itself acts as proof of identity
 */
app.post('/public', zValidator('json', verifyEmailPublicSchema), async (c) => {
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const normalizedEmail = body.email.toLowerCase().trim();

  // Find the user
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (!user) {
    return c.json(
      {
        error: 'user_not_found',
        message: 'No account found with this email',
      },
      404
    );
  }

  // Check if already verified
  if (user.emailVerified) {
    return c.json({
      verified: true,
      message: 'Email already verified',
    });
  }

  // Verify the code
  const result = await emailService.verifyEmailCode(normalizedEmail, body.code);

  if (!result.verified) {
    return c.json(
      {
        error: 'invalid_code',
        message: result.error || 'Invalid or expired verification code',
      },
      400
    );
  }

  // Update user email_verified status
  await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerifiedVia: 'email',
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'email_verified',
    resourceType: 'user',
    resourceId: user.id,
    details: { email: normalizedEmail },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Send welcome email (non-blocking)
  sendWelcomeEmail(normalizedEmail, user.firstName || undefined).catch((err) => {
    console.error('Failed to send welcome email:', err);
  });

  return c.json({
    verified: true,
  });
});

/**
 * POST /api/v1/auth/verify-email
 * Verify email address with 6-digit code (authenticated)
 */
app.post('/', authMiddleware, zValidator('json', verifyEmailSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  // Check if already verified
  if (user.emailVerified) {
    return c.json(
      {
        verified: true,
        message: 'Email already verified',
      }
    );
  }

  // Verify the code
  const result = await emailService.verifyEmailCode(user.email, body.code);

  if (!result.verified) {
    return c.json(
      {
        error: 'invalid_code',
        message: result.error || 'Invalid or expired verification code',
      },
      400
    );
  }

  // Update user email_verified status
  const db = getDb();
  await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerifiedVia: 'email',
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'email_verified',
    resourceType: 'user',
    resourceId: user.id,
    details: { email: user.email },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Send welcome email (non-blocking)
  sendWelcomeEmail(user.email, user.firstName || undefined).catch((err) => {
    console.error('Failed to send welcome email:', err);
  });

  return c.json({
    verified: true,
    redirect_url: '/complete-profile',
  });
});

// Resend email schema (public)
const resendEmailPublicSchema = z.object({
  email: z.string().email('Invalid email address'),
});

/**
 * POST /api/v1/auth/verify-email/resend-public
 * Resend verification email (no auth required)
 */
app.post('/resend-public', zValidator('json', resendEmailPublicSchema), async (c) => {
  const body = c.req.valid('json');
  const normalizedEmail = body.email.toLowerCase().trim();

  // Find the user
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (!user) {
    return c.json(
      {
        error: 'user_not_found',
        message: 'No account found with this email',
      },
      404
    );
  }

  // Check if already verified
  if (user.emailVerified) {
    return c.json(
      {
        error: 'already_verified',
        message: 'Email already verified',
      },
      400
    );
  }

  // Check for existing active code
  const hasActive = await emailService.hasActiveCode(normalizedEmail);
  if (hasActive) {
    const ttl = await emailService.getCodeTTL(normalizedEmail);
    return c.json(
      {
        error: 'code_active',
        message: 'A verification code was recently sent. Please wait before requesting a new one.',
        retry_after: ttl,
      },
      429
    );
  }

  // Send new verification email
  const result = await emailService.sendVerificationEmail(normalizedEmail, user.firstName || undefined);

  if (!result.sent) {
    return c.json(
      {
        error: 'send_failed',
        message: result.error || 'Failed to send verification email',
      },
      500
    );
  }

  return c.json({
    sent: true,
    expires_in: result.expiresIn,
  });
});

/**
 * POST /api/v1/auth/resend-email-verification
 * Resend verification email (authenticated)
 */
app.post('/resend', authMiddleware, async (c) => {
  const user = c.get('user');

  // Check if already verified
  if (user.emailVerified) {
    return c.json(
      {
        error: 'already_verified',
        message: 'Email already verified',
      },
      400
    );
  }

  // Check for existing active code
  const hasActive = await emailService.hasActiveCode(user.email);
  if (hasActive) {
    const ttl = await emailService.getCodeTTL(user.email);
    return c.json(
      {
        error: 'code_active',
        message: 'A verification code was recently sent. Please wait before requesting a new one.',
        retry_after: ttl,
      },
      429
    );
  }

  // Send new verification email
  const result = await emailService.sendVerificationEmail(user.email, user.firstName || undefined);

  if (!result.sent) {
    return c.json(
      {
        error: 'send_failed',
        message: result.error || 'Failed to send verification email',
      },
      500
    );
  }

  return c.json({
    sent: true,
    expires_in: result.expiresIn,
  });
});

/**
 * GET /api/v1/auth/verify-email/status
 * Check email verification status
 */
app.get('/status', authMiddleware, async (c) => {
  const user = c.get('user');

  return c.json({
    email: user.email,
    verified: user.emailVerified,
  });
});

export default app;
