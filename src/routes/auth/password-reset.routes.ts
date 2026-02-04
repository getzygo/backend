/**
 * Password Reset Routes
 *
 * POST /api/v1/auth/forgot-password - Request password reset code
 * POST /api/v1/auth/verify-reset-code - Verify reset code
 * POST /api/v1/auth/reset-password - Reset password with valid code
 *
 * Per UNIFIED_AUTH_STRATEGY.md - completing Phase 1 auth implementation.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { randomInt, randomBytes } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { users, auditLogs, tenantMembers } from '../../db/schema';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../../db/redis';
import { getUserByEmail, hashPassword } from '../../services/user.service';
import { updateAuthUser } from '../../services/supabase.service';
import { getEnv } from '../../config/env';
import { sendPasswordResetEmail } from '../../services/email.service';
import { notify } from '../../services/notification-hub.service';
import { NOTIFICATION_CONFIGS, EMAIL_TEMPLATES } from '../../services/notification-configs';
import { rateLimit, RATE_LIMITS } from '../../middleware/rate-limit.middleware';

const app = new Hono();

/**
 * Generate a cryptographically secure 6-digit verification code
 */
function generateCode(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * Generate a cryptographically secure reset token
 */
function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

// Request password reset schema
const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

// Verify reset code schema
const verifyCodeSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'Code must be 6 digits'),
});

// Reset password schema - must match signup password requirements
const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
  reset_token: z.string().min(1, 'Reset token is required'),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
});

/**
 * POST /api/v1/auth/forgot-password
 * Request password reset - sends 6-digit code to email
 * Rate limit: 3 requests per minute (prevent email bombing)
 */
app.post('/forgot-password', rateLimit(RATE_LIMITS.STRICT), zValidator('json', forgotPasswordSchema), async (c) => {
  const { email } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();
  const redis = getRedis();
  const env = getEnv();

  // Always return success to prevent email enumeration
  const successResponse = {
    success: true,
    message: 'If an account exists with this email, a password reset code has been sent.',
    expires_in: REDIS_TTL.PASSWORD_RESET,
  };

  // Check if user exists
  const user = await getUserByEmail(email);

  if (!user) {
    // Don't reveal that user doesn't exist
    return c.json(successResponse);
  }

  // Check if user is blocked/suspended
  if (user.status === 'suspended' || user.status === 'deleted') {
    // Don't reveal status, just return success
    return c.json(successResponse);
  }

  // Check rate limiting - only allow 3 reset requests per hour
  const rateLimitKey = `${REDIS_KEYS.RATE_LIMIT}pwreset:${email.toLowerCase()}`;
  const attempts = await redis.incr(rateLimitKey);

  if (attempts === 1) {
    await redis.expire(rateLimitKey, 3600); // 1 hour
  }

  if (attempts > 3) {
    // Still return success to prevent enumeration
    console.warn(`Rate limit exceeded for password reset: ${email}`);
    return c.json(successResponse);
  }

  // Generate and store code
  const code = generateCode();
  const codeKey = `${REDIS_KEYS.PASSWORD_RESET}code:${email.toLowerCase()}`;

  // Store code with 1 hour TTL
  await redis.setex(codeKey, REDIS_TTL.PASSWORD_RESET, JSON.stringify({
    code,
    attempts: 0,
    createdAt: Date.now(),
  }));

  // Send email with code using email service
  try {
    await sendPasswordResetEmail(email, code, user.firstName || undefined);
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    // Still return success - don't reveal email sending failure
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'password_reset_requested',
    resourceType: 'user',
    resourceId: user.id,
    details: {},
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json(successResponse);
});

/**
 * POST /api/v1/auth/verify-reset-code
 * Verify the reset code and return a reset token
 * Rate limit: 5 requests per minute (prevent code guessing)
 */
app.post('/verify-reset-code', rateLimit(RATE_LIMITS.SENSITIVE), zValidator('json', verifyCodeSchema), async (c) => {
  const { email, code } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();
  const redis = getRedis();

  // Check if user exists
  const user = await getUserByEmail(email);

  if (!user) {
    return c.json(
      {
        error: 'invalid_code',
        message: 'Invalid or expired code',
      },
      400
    );
  }

  // Get stored code
  const codeKey = `${REDIS_KEYS.PASSWORD_RESET}code:${email.toLowerCase()}`;
  const storedData = await redis.get(codeKey);

  if (!storedData) {
    return c.json(
      {
        error: 'expired_code',
        message: 'Code has expired. Please request a new one.',
      },
      400
    );
  }

  const data = JSON.parse(storedData);

  // Check attempts (max 5)
  if (data.attempts >= 5) {
    await redis.del(codeKey);

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'password_reset_code_blocked',
      resourceType: 'user',
      resourceId: user.id,
      details: { reason: 'too_many_attempts' },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'failure',
    });

    return c.json(
      {
        error: 'too_many_attempts',
        message: 'Too many incorrect attempts. Please request a new code.',
      },
      400
    );
  }

  // Verify code
  if (data.code !== code) {
    // Increment attempts
    data.attempts += 1;
    await redis.setex(codeKey, REDIS_TTL.PASSWORD_RESET, JSON.stringify(data));

    return c.json(
      {
        error: 'invalid_code',
        message: 'Invalid code. Please try again.',
        attempts_remaining: 5 - data.attempts,
      },
      400
    );
  }

  // Code is valid - generate reset token
  const resetToken = generateResetToken();
  const tokenKey = `${REDIS_KEYS.PASSWORD_RESET}token:${email.toLowerCase()}`;

  // Store reset token with 15 minute TTL
  await redis.setex(tokenKey, 15 * 60, JSON.stringify({
    token: resetToken,
    userId: user.id,
    createdAt: Date.now(),
  }));

  // Delete the code (no longer needed)
  await redis.del(codeKey);

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'password_reset_code_verified',
    resourceType: 'user',
    resourceId: user.id,
    details: {},
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    success: true,
    reset_token: resetToken,
    expires_in: 15 * 60, // 15 minutes
    message: 'Code verified. You can now reset your password.',
  });
});

/**
 * POST /api/v1/auth/reset-password
 * Reset password with valid reset token
 * Rate limit: 5 requests per minute
 */
app.post('/reset-password', rateLimit(RATE_LIMITS.SENSITIVE), zValidator('json', resetPasswordSchema), async (c) => {
  const { email, reset_token, password } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();
  const redis = getRedis();

  // Check if user exists
  const user = await getUserByEmail(email);

  if (!user) {
    return c.json(
      {
        error: 'invalid_token',
        message: 'Invalid or expired reset token',
      },
      400
    );
  }

  // Get stored reset token
  const tokenKey = `${REDIS_KEYS.PASSWORD_RESET}token:${email.toLowerCase()}`;
  const storedData = await redis.get(tokenKey);

  if (!storedData) {
    return c.json(
      {
        error: 'expired_token',
        message: 'Reset token has expired. Please request a new code.',
      },
      400
    );
  }

  const data = JSON.parse(storedData);

  // Verify token
  if (data.token !== reset_token || data.userId !== user.id) {
    return c.json(
      {
        error: 'invalid_token',
        message: 'Invalid reset token',
      },
      400
    );
  }

  // Hash the new password
  const passwordHash = await hashPassword(password);
  const now = new Date();

  // Update password in our database
  await db
    .update(users)
    .set({
      passwordHash,
      passwordChangedAt: now,
      // Reset login lockout on password change
      failedLoginAttempts: '0',
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  // Update password in Supabase Auth
  await updateAuthUser(user.id, { password });

  // Delete the reset token
  await redis.del(tokenKey);

  // Clear any remaining password reset rate limits
  const rateLimitKey = `${REDIS_KEYS.RATE_LIMIT}pwreset:${email.toLowerCase()}`;
  await redis.del(rateLimitKey);

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'password_reset_completed',
    resourceType: 'user',
    resourceId: user.id,
    details: {},
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Get user's primary tenant for in-app notification
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, user.id),
      eq(tenantMembers.status, 'active')
    ),
    columns: { tenantId: true },
  });

  // Send password changed notification (email + in-app) - ALWAYS_SEND
  const config = NOTIFICATION_CONFIGS.password_changed;
  notify({
    userId: user.id,
    tenantId: membership?.tenantId,
    category: config.category,
    type: config.type,
    title: config.title,
    message: config.message as string,
    severity: config.severity,
    actionRoute: config.actionRoute,
    actionLabel: config.actionLabel,
    emailTemplate: EMAIL_TEMPLATES.passwordChanged({
      firstName: user.firstName || undefined,
      ipAddress: ipAddress || undefined,
    }),
    emailSubject: config.emailSubject,
  }).catch((err) => console.error('[Password] Notification failed:', err));

  return c.json({
    success: true,
    message: 'Password has been reset successfully. You can now sign in with your new password.',
  });
});

/**
 * GET /api/v1/auth/reset-status
 * Check if a reset code/token is still valid
 */
app.get('/reset-status', async (c) => {
  const email = c.req.query('email');

  if (!email) {
    return c.json(
      {
        error: 'missing_email',
        message: 'Email is required',
      },
      400
    );
  }

  const redis = getRedis();

  // Check for active code
  const codeKey = `${REDIS_KEYS.PASSWORD_RESET}code:${email.toLowerCase()}`;
  const codeTtl = await redis.ttl(codeKey);

  // Check for active token
  const tokenKey = `${REDIS_KEYS.PASSWORD_RESET}token:${email.toLowerCase()}`;
  const tokenTtl = await redis.ttl(tokenKey);

  return c.json({
    has_pending_code: codeTtl > 0,
    code_expires_in: codeTtl > 0 ? codeTtl : null,
    has_reset_token: tokenTtl > 0,
    token_expires_in: tokenTtl > 0 ? tokenTtl : null,
  });
});

export default app;
