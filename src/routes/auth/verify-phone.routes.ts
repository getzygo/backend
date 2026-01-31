/**
 * Phone Verification Routes
 *
 * POST /api/v1/auth/send-phone-code - Send verification SMS
 * POST /api/v1/auth/verify-phone - Verify phone with code
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authMiddleware, requireEmailVerified } from '../../middleware/auth.middleware';
import { smsService } from '../../services/sms.service';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';

const app = new Hono();

// Send phone code schema
const sendPhoneCodeSchema = z.object({
  phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Phone must be in E.164 format (e.g., +1234567890)'),
});

// Verify phone schema
const verifyPhoneSchema = z.object({
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

/**
 * POST /api/v1/auth/send-phone-code
 * Send phone verification SMS
 */
app.post(
  '/send-code',
  authMiddleware,
  requireEmailVerified,
  zValidator('json', sendPhoneCodeSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    // Validate phone format
    if (!smsService.isValidE164(body.phone)) {
      return c.json(
        {
          error: 'invalid_phone',
          message: 'Phone number must be in E.164 format (e.g., +1234567890)',
        },
        400
      );
    }

    // Check for existing active code
    const hasActive = await smsService.hasActiveCode(body.phone);
    if (hasActive) {
      const ttl = await smsService.getCodeTTL(body.phone);
      return c.json(
        {
          error: 'code_active',
          message: 'A verification code was recently sent. Please wait before requesting a new one.',
          retry_after: ttl,
        },
        429
      );
    }

    // Update user's phone number (unverified)
    const db = getDb();
    await db
      .update(users)
      .set({
        phone: body.phone,
        phoneVerified: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Send verification SMS
    const result = await smsService.sendVerificationSms(body.phone);

    if (!result.sent) {
      return c.json(
        {
          error: 'send_failed',
          message: result.error || 'Failed to send verification SMS',
        },
        500
      );
    }

    return c.json({
      sent: true,
      expires_in: result.expiresIn,
    });
  }
);

/**
 * POST /api/v1/auth/verify-phone
 * Verify phone number with 6-digit code
 */
app.post(
  '/',
  authMiddleware,
  requireEmailVerified,
  zValidator('json', verifyPhoneSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    // Check if already verified
    if (user.phoneVerified) {
      return c.json({
        verified: true,
        message: 'Phone already verified',
      });
    }

    // Check if user has a phone number
    if (!user.phone) {
      return c.json(
        {
          error: 'no_phone',
          message: 'No phone number to verify. Please send a verification code first.',
        },
        400
      );
    }

    // Verify the code
    const result = await smsService.verifySmsCode(user.phone, body.code);

    if (!result.verified) {
      return c.json(
        {
          error: 'invalid_code',
          message: result.error || 'Invalid or expired verification code',
        },
        400
      );
    }

    // Update user phone_verified status
    const db = getDb();
    await db
      .update(users)
      .set({
        phoneVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'phone_verified',
      resourceType: 'user',
      resourceId: user.id,
      details: { phone: user.phone },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      verified: true,
    });
  }
);

/**
 * GET /api/v1/auth/verify-phone/status
 * Check phone verification status
 */
app.get('/status', authMiddleware, async (c) => {
  const user = c.get('user');

  return c.json({
    phone: user.phone,
    verified: user.phoneVerified,
  });
});

export default app;
