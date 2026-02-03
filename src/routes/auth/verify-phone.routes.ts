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
import { rateLimit, RATE_LIMITS } from '../../middleware/rate-limit.middleware';

const app = new Hono();

// Apply strict rate limiting to phone verification (SMS costs money)
app.use('*', rateLimit(RATE_LIMITS.STRICT));

// Country dial codes map
const countryDialCodes: Record<string, string> = {
  US: "+1", CA: "+1", MX: "+52", GB: "+44", DE: "+49", FR: "+33", ES: "+34",
  IT: "+39", NL: "+31", BE: "+32", CH: "+41", AT: "+43", SE: "+46", NO: "+47",
  DK: "+45", FI: "+358", IE: "+353", PT: "+351", GR: "+30", PL: "+48", CZ: "+420",
  HU: "+36", RO: "+40", AU: "+61", NZ: "+64", JP: "+81", CN: "+86", IN: "+91",
  KR: "+82", SG: "+65", MY: "+60", TH: "+66", ID: "+62", PH: "+63", VN: "+84",
  HK: "+852", TW: "+886", PK: "+92", BD: "+880", LK: "+94", AE: "+971", SA: "+966",
  IL: "+972", TR: "+90", EG: "+20", QA: "+974", KW: "+965", BH: "+973", OM: "+968",
  JO: "+962", LB: "+961", BR: "+55", AR: "+54", CL: "+56", CO: "+57", PE: "+51",
  VE: "+58", EC: "+593", UY: "+598", ZA: "+27", NG: "+234", KE: "+254", GH: "+233",
  MA: "+212", TN: "+216", ET: "+251", UG: "+256", RU: "+7", UA: "+380", BY: "+375",
  KZ: "+7", CR: "+506", PA: "+507", GT: "+502", JM: "+1876", TT: "+1868",
  HR: "+385", SI: "+386", SK: "+421", BG: "+359", LT: "+370", LV: "+371",
  EE: "+372", IS: "+354", LU: "+352", MT: "+356", CY: "+357", NP: "+977",
  MM: "+95", KH: "+855", LA: "+856", MN: "+976", BN: "+673", MV: "+960",
  AF: "+93", IQ: "+964", IR: "+98", SY: "+963", YE: "+967", FJ: "+679",
  PG: "+675", DZ: "+213", AO: "+244", BW: "+267", CM: "+237", CD: "+243",
  CI: "+225", GA: "+241", GM: "+220", GN: "+224", LY: "+218", MW: "+265",
  MZ: "+258", NA: "+264", NE: "+227", RW: "+250", SN: "+221", SD: "+249",
  TZ: "+255", ZM: "+260", ZW: "+263", BO: "+591", PY: "+595", GY: "+592",
  SR: "+597", AM: "+374", AZ: "+994", GE: "+995", BS: "+1242", BB: "+1246",
  BZ: "+501", CU: "+53", DO: "+1809", HT: "+509", NI: "+505", PR: "+1787",
  SV: "+503", HN: "+504",
};

// Send phone code schema - accepts raw phone number and country code
const sendPhoneCodeSchema = z.object({
  phone: z.string().min(4, 'Phone number is required'),
  country_code: z.string().length(2, 'Country code must be 2 letters (e.g., US)'),
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

    // Get dial code for country
    const dialCode = countryDialCodes[body.country_code.toUpperCase()];
    if (!dialCode) {
      return c.json(
        {
          error: 'invalid_country',
          message: 'Unknown country code',
        },
        400
      );
    }

    // Clean phone number (remove non-digits) and format to E.164
    const cleanPhone = body.phone.replace(/\D/g, '');
    const e164Phone = `${dialCode}${cleanPhone}`;

    // Validate E.164 format
    if (!smsService.isValidE164(e164Phone)) {
      return c.json(
        {
          error: 'invalid_phone',
          message: 'Invalid phone number for the selected country',
        },
        400
      );
    }

    // Check for existing active code
    const hasActive = await smsService.hasActiveCode(e164Phone);
    if (hasActive) {
      const ttl = await smsService.getCodeTTL(e164Phone);
      return c.json(
        {
          error: 'code_active',
          message: 'A verification code was recently sent. Please wait before requesting a new one.',
          retry_after: ttl,
        },
        429
      );
    }

    // Update user's phone number (store raw number and country code, NOT E.164)
    const db = getDb();
    await db
      .update(users)
      .set({
        phone: cleanPhone, // Store clean number without country code
        phoneCountryCode: body.country_code.toUpperCase(),
        phoneVerified: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Send verification SMS using E.164 format
    const result = await smsService.sendVerificationSms(e164Phone);

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

    // Check if user has a phone number and country code
    if (!user.phone || !user.phoneCountryCode) {
      return c.json(
        {
          error: 'no_phone',
          message: 'No phone number to verify. Please send a verification code first.',
        },
        400
      );
    }

    // Get dial code and construct E.164 format for verification
    const dialCode = countryDialCodes[user.phoneCountryCode];
    if (!dialCode) {
      return c.json(
        {
          error: 'invalid_country',
          message: 'Invalid country code stored. Please re-send the verification code.',
        },
        400
      );
    }
    const e164Phone = `${dialCode}${user.phone}`;

    // Verify the code
    const result = await smsService.verifySmsCode(e164Phone, body.code);

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
