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
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../../db/redis';
import { getUserByEmail, hashPassword } from '../../services/user.service';
import { updateAuthUser } from '../../services/supabase.service';
import { getEnv } from '../../config/env';

const app = new Hono();

/**
 * Generate a 6-digit verification code
 */
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generate a secure reset token
 */
function generateResetToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
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
 */
app.post('/forgot-password', zValidator('json', forgotPasswordSchema), async (c) => {
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

  // Send email with code
  try {
    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      const nodemailer = await import('nodemailer');

      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });

      const name = user.firstName || 'there';

      await transporter.sendMail({
        from: `"Zygo" <${env.EMAIL_FROM}>`,
        to: email,
        subject: 'Reset your password - Zygo',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Reset your password</h2>
            <p>Hi ${name},</p>
            <p>We received a request to reset your password. Use this code to reset it:</p>
            <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; font-weight: bold; margin: 20px 0;">
              ${code}
            </div>
            <p>This code will expire in 1 hour.</p>
            <p>If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
            <p>Best,<br>The Zygo Team</p>
          </div>
        `,
        text: `Hi ${name},\n\nWe received a request to reset your password. Use this code to reset it: ${code}\n\nThis code will expire in 1 hour.\n\nIf you didn't request a password reset, you can safely ignore this email.\n\nBest,\nThe Zygo Team`,
      });
    } else {
      // Development mode - log the code
      console.log(`[DEV] Password reset code for ${email}: ${code}`);
    }
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
 */
app.post('/verify-reset-code', zValidator('json', verifyCodeSchema), async (c) => {
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
 */
app.post('/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
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

  // Send confirmation email
  try {
    const env = getEnv();

    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      const nodemailer = await import('nodemailer');

      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });

      const name = user.firstName || 'there';

      await transporter.sendMail({
        from: `"Zygo" <${env.EMAIL_FROM}>`,
        to: email,
        subject: 'Your password has been reset - Zygo',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Reset Successful</h2>
            <p>Hi ${name},</p>
            <p>Your password has been successfully reset.</p>
            <p>If you did not make this change, please contact our support team immediately.</p>
            <p>Best,<br>The Zygo Team</p>
          </div>
        `,
        text: `Hi ${name},\n\nYour password has been successfully reset.\n\nIf you did not make this change, please contact our support team immediately.\n\nBest,\nThe Zygo Team`,
      });
    } else {
      console.log(`[DEV] Password reset confirmation would be sent to ${email}`);
    }
  } catch (error) {
    console.error('Failed to send password reset confirmation email:', error);
    // Non-blocking - password was still reset
  }

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
