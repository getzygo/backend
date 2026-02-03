/**
 * SMS Verification Service
 *
 * Handles phone verification via Twilio.
 * Supports both Twilio Verify API (recommended) and direct SMS.
 * Per UNIFIED_AUTH_STRATEGY.md Section 3.
 */

import { randomInt } from 'crypto';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';
import { getEnv } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Generate a cryptographically secure 6-digit verification code
 */
function generateCode(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * Normalize phone number (remove spaces, dashes)
 */
function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, '');
}

/**
 * Store verification code in Redis (for direct SMS mode)
 */
async function storeCode(phone: string, code: string): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.PHONE_CODE}${normalizePhone(phone)}`;
  await redis.setex(key, REDIS_TTL.PHONE_CODE, code);
}

/**
 * Get stored verification code from Redis
 */
async function getStoredCode(phone: string): Promise<string | null> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.PHONE_CODE}${normalizePhone(phone)}`;
  return redis.get(key);
}

/**
 * Delete verification code from Redis
 */
async function deleteCode(phone: string): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.PHONE_CODE}${normalizePhone(phone)}`;
  await redis.del(key);
}

/**
 * Validate E.164 phone format
 */
export function isValidE164(phone: string): boolean {
  // E.164 format: +[country code][number], max 15 digits total
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(normalizePhone(phone));
}

/**
 * Get Twilio client for general SMS (supports API keys)
 */
async function getTwilioClient() {
  const env = getEnv();
  const twilio = await import('twilio');

  const hasApiKey = env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET;

  if (hasApiKey) {
    return twilio.default(env.TWILIO_API_KEY_SID!, env.TWILIO_API_KEY_SECRET!, {
      accountSid: env.TWILIO_ACCOUNT_SID,
    });
  }

  return twilio.default(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!);
}

/**
 * Get Twilio client for Verify API (requires Auth Token, not API keys)
 */
async function getTwilioVerifyClient() {
  const env = getEnv();
  const twilio = await import('twilio');

  // Verify API requires Account SID + Auth Token (API keys may not have Verify permissions)
  return twilio.default(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!);
}

/**
 * Check if Twilio Verify is configured
 */
function isVerifyConfigured(): boolean {
  const env = getEnv();
  const hasAuth = (env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET) || env.TWILIO_AUTH_TOKEN;
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_VERIFY_SERVICE_SID && hasAuth);
}

/**
 * Check if direct SMS is configured
 */
function isDirectSmsConfigured(): boolean {
  const env = getEnv();
  const hasAuth = (env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET) || env.TWILIO_AUTH_TOKEN;
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_PHONE_NUMBER && hasAuth);
}

/**
 * Send verification SMS via Twilio Verify API (recommended)
 */
async function sendViaVerifyApi(phone: string): Promise<{ sent: boolean; expiresIn: number; error?: string }> {
  const env = getEnv();

  try {
    const client = await getTwilioVerifyClient();

    await client.verify.v2
      .services(env.TWILIO_VERIFY_SERVICE_SID!)
      .verifications.create({
        to: normalizePhone(phone),
        channel: 'sms',
      });

    // Twilio Verify codes expire in 10 minutes by default
    return { sent: true, expiresIn: 600 };
  } catch (error) {
    logger.error('Twilio Verify API error:', error);
    return {
      sent: false,
      expiresIn: 0,
      error: error instanceof Error ? error.message : 'Failed to send verification',
    };
  }
}

/**
 * Verify code via Twilio Verify API
 */
async function verifyViaVerifyApi(phone: string, code: string): Promise<{ verified: boolean; error?: string }> {
  const env = getEnv();

  try {
    const client = await getTwilioVerifyClient();

    const verification = await client.verify.v2
      .services(env.TWILIO_VERIFY_SERVICE_SID!)
      .verificationChecks.create({
        to: normalizePhone(phone),
        code,
      });

    if (verification.status === 'approved') {
      return { verified: true };
    }

    return { verified: false, error: 'Invalid code' };
  } catch (error) {
    logger.error('Twilio Verify check error:', error);
    return {
      verified: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

/**
 * Send verification SMS via direct Twilio Messages API
 */
async function sendViaDirectSms(phone: string): Promise<{ sent: boolean; expiresIn: number; error?: string }> {
  const env = getEnv();

  try {
    const client = await getTwilioClient();
    const code = generateCode();
    await storeCode(phone, code);

    await client.messages.create({
      body: `Your Zygo verification code is: ${code}. This code expires in 10 minutes.`,
      from: env.TWILIO_PHONE_NUMBER,
      to: normalizePhone(phone),
    });

    return { sent: true, expiresIn: REDIS_TTL.PHONE_CODE };
  } catch (error) {
    logger.error('Twilio SMS error:', error);
    return {
      sent: false,
      expiresIn: 0,
      error: error instanceof Error ? error.message : 'Failed to send SMS',
    };
  }
}

/**
 * Send verification SMS
 * Uses Twilio Verify API if configured, falls back to direct SMS
 */
export async function sendVerificationSms(
  phone: string
): Promise<{ sent: boolean; expiresIn: number; error?: string }> {
  // Validate phone format
  if (!isValidE164(phone)) {
    return {
      sent: false,
      expiresIn: 0,
      error: 'Invalid phone number format. Use E.164 format (e.g., +1234567890)',
    };
  }

  // Use Twilio Verify API if configured (recommended)
  if (isVerifyConfigured()) {
    return sendViaVerifyApi(phone);
  }

  // Fall back to direct SMS
  if (isDirectSmsConfigured()) {
    return sendViaDirectSms(phone);
  }

  // Development mode - generate code locally
  logger.dev('Twilio not configured, using development mode');
  const code = generateCode();
  await storeCode(phone, code);
  logger.dev(`Phone verification code for ${phone}: ${code}`);
  return { sent: true, expiresIn: REDIS_TTL.PHONE_CODE };
}

/**
 * Verify phone code
 */
export async function verifySmsCode(
  phone: string,
  code: string
): Promise<{ verified: boolean; error?: string }> {
  // Use Twilio Verify API if configured
  if (isVerifyConfigured()) {
    return verifyViaVerifyApi(phone, code);
  }

  // Fall back to Redis-stored code verification
  const storedCode = await getStoredCode(phone);

  if (!storedCode) {
    return { verified: false, error: 'Code expired or not found' };
  }

  if (storedCode !== code) {
    return { verified: false, error: 'Invalid code' };
  }

  // Delete the code after successful verification
  await deleteCode(phone);

  return { verified: true };
}

/**
 * Check if a verification code exists (for rate limiting)
 * Note: Only works for direct SMS mode, not Verify API
 */
export async function hasActiveCode(phone: string): Promise<boolean> {
  // Twilio Verify handles rate limiting internally
  if (isVerifyConfigured()) {
    return false; // Let Twilio handle it
  }

  const storedCode = await getStoredCode(phone);
  return storedCode !== null;
}

/**
 * Get remaining TTL for verification code
 * Note: Only works for direct SMS mode
 */
export async function getCodeTTL(phone: string): Promise<number> {
  if (isVerifyConfigured()) {
    return 0; // Twilio Verify handles this internally
  }

  const redis = getRedis();
  const key = `${REDIS_KEYS.PHONE_CODE}${normalizePhone(phone)}`;
  const ttl = await redis.ttl(key);
  return ttl > 0 ? ttl : 0;
}

export const smsService = {
  sendVerificationSms,
  verifySmsCode,
  hasActiveCode,
  getCodeTTL,
  isValidE164,
};
