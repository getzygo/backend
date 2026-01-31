/**
 * Email Verification Service
 *
 * Handles email verification code generation, storage, and validation.
 * Per UNIFIED_AUTH_STRATEGY.md Section 3.
 */

import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';
import { getEnv } from '../config/env';

/**
 * Generate a 6-digit verification code
 */
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Store verification code in Redis
 */
async function storeCode(email: string, code: string): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.EMAIL_CODE}${email.toLowerCase()}`;

  await redis.setex(key, REDIS_TTL.EMAIL_CODE, code);
}

/**
 * Get stored verification code from Redis
 */
async function getStoredCode(email: string): Promise<string | null> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.EMAIL_CODE}${email.toLowerCase()}`;

  return redis.get(key);
}

/**
 * Delete verification code from Redis
 */
async function deleteCode(email: string): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.EMAIL_CODE}${email.toLowerCase()}`;

  await redis.del(key);
}

/**
 * Send verification email with 6-digit code
 * Uses nodemailer for SMTP delivery
 */
export async function sendVerificationEmail(
  email: string,
  firstName?: string
): Promise<{ sent: boolean; expiresIn: number; error?: string }> {
  const env = getEnv();

  // Check if SMTP is configured
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    console.warn('SMTP not configured, skipping email send');
    // In development, still generate and store the code for testing
    const code = generateCode();
    await storeCode(email, code);
    console.log(`[DEV] Email verification code for ${email}: ${code}`);
    return { sent: true, expiresIn: REDIS_TTL.EMAIL_CODE };
  }

  try {
    // Dynamic import to avoid issues if nodemailer not installed
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

    const code = generateCode();
    await storeCode(email, code);

    const name = firstName || 'there';

    await transporter.sendMail({
      from: `"Zygo" <${env.EMAIL_FROM}>`,
      to: email,
      subject: 'Verify your email address - Zygo',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verify your email</h2>
          <p>Hi ${name},</p>
          <p>Your verification code is:</p>
          <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; font-weight: bold; margin: 20px 0;">
            ${code}
          </div>
          <p>This code will expire in 15 minutes.</p>
          <p>If you didn't request this code, you can safely ignore this email.</p>
          <p>Best,<br>The Zygo Team</p>
        </div>
      `,
      text: `Hi ${name},\n\nYour verification code is: ${code}\n\nThis code will expire in 15 minutes.\n\nIf you didn't request this code, you can safely ignore this email.\n\nBest,\nThe Zygo Team`,
    });

    return { sent: true, expiresIn: REDIS_TTL.EMAIL_CODE };
  } catch (error) {
    console.error('Failed to send verification email:', error);
    return {
      sent: false,
      expiresIn: 0,
      error: error instanceof Error ? error.message : 'Failed to send email',
    };
  }
}

/**
 * Verify email code
 */
export async function verifyEmailCode(
  email: string,
  code: string
): Promise<{ verified: boolean; error?: string }> {
  const storedCode = await getStoredCode(email);

  if (!storedCode) {
    return { verified: false, error: 'Code expired or not found' };
  }

  if (storedCode !== code) {
    return { verified: false, error: 'Invalid code' };
  }

  // Delete the code after successful verification
  await deleteCode(email);

  return { verified: true };
}

/**
 * Check if a verification code exists (for rate limiting)
 */
export async function hasActiveCode(email: string): Promise<boolean> {
  const storedCode = await getStoredCode(email);
  return storedCode !== null;
}

/**
 * Get remaining TTL for verification code
 */
export async function getCodeTTL(email: string): Promise<number> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.EMAIL_CODE}${email.toLowerCase()}`;

  const ttl = await redis.ttl(key);
  return ttl > 0 ? ttl : 0;
}

export const emailService = {
  sendVerificationEmail,
  verifyEmailCode,
  hasActiveCode,
  getCodeTTL,
};
