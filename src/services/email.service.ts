/**
 * Email Service
 *
 * Handles email sending using React Email templates.
 * Supports verification codes, password resets, security alerts, and more.
 */

import { render } from '@react-email/render';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';
import { getEnv } from '../config/env';
import type { ReactElement } from 'react';

// Import templates
import { EmailVerification } from '../emails/templates/email-verification';
import { PasswordReset } from '../emails/templates/password-reset';
import { PasswordChanged } from '../emails/templates/password-changed';
import { Welcome } from '../emails/templates/welcome';
import { LoginAlert } from '../emails/templates/login-alert';
import { MfaEnabled } from '../emails/templates/mfa-enabled';
import { MfaDisabled } from '../emails/templates/mfa-disabled';
import { SessionRevoked } from '../emails/templates/session-revoked';
import { BackupCodesRegenerated } from '../emails/templates/backup-codes-regenerated';

// Types
interface SendEmailOptions {
  to: string;
  subject: string;
  template: ReactElement;
  headers?: Record<string, string>;
}

interface SendEmailResult {
  sent: boolean;
  error?: string;
}

// Nodemailer transporter (lazy loaded)
let transporterPromise: Promise<import('nodemailer').Transporter> | null = null;

async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  transporterPromise = (async () => {
    const nodemailer = await import('nodemailer');
    const env = getEnv();

    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  })();

  return transporterPromise;
}

/**
 * Check if SMTP is configured
 */
function isSmtpConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

/**
 * Send an email using a React Email template
 */
async function sendEmail({ to, subject, template, headers = {} }: SendEmailOptions): Promise<SendEmailResult> {
  const env = getEnv();

  try {
    // Render HTML and plain text versions
    const html = await render(template);
    const text = await render(template, { plainText: true });

    if (!isSmtpConfigured()) {
      console.warn('[DEV] SMTP not configured, skipping email send');
      console.log(`[DEV] Would send email to ${to}: ${subject}`);
      console.log(`[DEV] Plain text preview:\n${text.substring(0, 500)}...`);
      return { sent: true };
    }

    const transporter = await getTransporter();

    await transporter.sendMail({
      from: `"Zygo" <${env.EMAIL_FROM}>`,
      to,
      subject,
      html,
      text,
      headers: {
        'X-Mailer': 'Zygo Mail Service',
        ...headers,
      },
    });

    return { sent: true };
  } catch (error) {
    console.error('Failed to send email:', error);
    return {
      sent: false,
      error: error instanceof Error ? error.message : 'Failed to send email',
    };
  }
}

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

// ============================================================================
// Public API
// ============================================================================

/**
 * Send email verification code
 */
export async function sendVerificationEmail(
  email: string,
  firstName?: string
): Promise<{ sent: boolean; expiresIn: number; code?: string; error?: string }> {
  const code = generateCode();
  await storeCode(email, code);

  if (!isSmtpConfigured()) {
    console.log(`[DEV] Email verification code for ${email}: ${code}`);
    return { sent: true, expiresIn: REDIS_TTL.EMAIL_CODE, code };
  }

  const result = await sendEmail({
    to: email,
    subject: 'Verify your email address - Zygo',
    template: EmailVerification({
      firstName: firstName || 'there',
      code,
      expiresInMinutes: Math.floor(REDIS_TTL.EMAIL_CODE / 60),
    }),
  });

  return {
    ...result,
    expiresIn: REDIS_TTL.EMAIL_CODE,
  };
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

/**
 * Send password reset code email
 */
export async function sendPasswordResetEmail(
  email: string,
  code: string,
  firstName?: string
): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) {
    console.log(`[DEV] Password reset code for ${email}: ${code}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'Reset your password - Zygo',
    template: PasswordReset({
      firstName: firstName || 'there',
      code,
      expiresInMinutes: 60,
    }),
  });
}

/**
 * Send password changed notification (ALWAYS_SEND - cannot be disabled)
 */
export async function sendPasswordChangedEmail(
  email: string,
  firstName?: string,
  details?: { ipAddress?: string; deviceInfo?: string }
): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) {
    console.log(`[DEV] Password changed notification would be sent to ${email}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'Your password has been changed - Zygo',
    template: PasswordChanged({
      firstName: firstName || 'there',
      changedAt: new Date(),
      ipAddress: details?.ipAddress,
      deviceInfo: details?.deviceInfo,
    }),
  });
}

/**
 * Send welcome email after verification
 */
export async function sendWelcomeEmail(
  email: string,
  firstName?: string
): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) {
    console.log(`[DEV] Welcome email would be sent to ${email}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'Welcome to Zygo!',
    template: Welcome({ firstName: firstName || 'there' }),
    headers: {
      'List-Unsubscribe': '<https://app.getzygo.com/settings/notifications>',
    },
  });
}

/**
 * Send login alert email
 */
export async function sendLoginAlertEmail(
  email: string,
  firstName: string | undefined,
  details: {
    alerts: string[];
    device?: string;
    browser?: string;
    os?: string;
    location?: string;
    ipAddress?: string;
    isSuspicious?: boolean;
  }
): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) {
    console.log(`[DEV] Login alert would be sent to ${email}:`, details);
    return { sent: true };
  }

  const subject = details.isSuspicious
    ? 'Suspicious sign-in detected - Zygo'
    : 'New sign-in to your account - Zygo';

  return sendEmail({
    to: email,
    subject,
    template: LoginAlert({
      firstName: firstName || 'there',
      alerts: details.alerts,
      device: details.device,
      browser: details.browser,
      os: details.os,
      location: details.location,
      ipAddress: details.ipAddress,
      timestamp: new Date(),
      isSuspicious: details.isSuspicious,
    }),
    // Suspicious login alerts cannot be unsubscribed
    headers: details.isSuspicious
      ? {}
      : { 'List-Unsubscribe': '<https://app.getzygo.com/settings/notifications>' },
  });
}

/**
 * Send MFA enabled notification
 */
export async function sendMfaEnabledEmail(
  email: string,
  firstName?: string,
  method?: 'totp' | 'webauthn' | 'sms'
): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) {
    console.log(`[DEV] MFA enabled email would be sent to ${email}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'Two-factor authentication enabled - Zygo',
    template: MfaEnabled({
      firstName: firstName || 'there',
      method: method || 'totp',
      enabledAt: new Date(),
    }),
    headers: {
      'List-Unsubscribe': '<https://app.getzygo.com/settings/notifications>',
    },
  });
}

/**
 * Send MFA disabled notification (ALWAYS_SEND - cannot be disabled)
 */
export async function sendMfaDisabledEmail(
  email: string,
  firstName?: string,
  details?: { ipAddress?: string; deviceInfo?: string }
): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) {
    console.log(`[DEV] MFA disabled email would be sent to ${email}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'Two-factor authentication disabled - Zygo',
    template: MfaDisabled({
      firstName: firstName || 'there',
      disabledAt: new Date(),
      ipAddress: details?.ipAddress,
      deviceInfo: details?.deviceInfo,
    }),
  });
}

/**
 * Send session revoked notification
 */
export async function sendSessionRevokedEmail(
  email: string,
  firstName: string | undefined,
  details: {
    revokedDevice?: string;
    revokedBrowser?: string;
    revokedLocation?: string;
    revokedBy?: 'user' | 'admin' | 'system';
    revokerDevice?: string;
  }
): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) {
    console.log(`[DEV] Session revoked email would be sent to ${email}:`, details);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'A session has been logged out - Zygo',
    template: SessionRevoked({
      firstName: firstName || 'there',
      revokedDevice: details.revokedDevice,
      revokedBrowser: details.revokedBrowser,
      revokedLocation: details.revokedLocation,
      revokedAt: new Date(),
      revokedBy: details.revokedBy || 'user',
      revokerDevice: details.revokerDevice,
    }),
    headers: {
      'List-Unsubscribe': '<https://app.getzygo.com/settings/notifications>',
    },
  });
}

/**
 * Send backup codes regenerated notification
 */
export async function sendBackupCodesRegeneratedEmail(
  email: string,
  firstName?: string,
  details?: { ipAddress?: string; deviceInfo?: string }
): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) {
    console.log(`[DEV] Backup codes regenerated email would be sent to ${email}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'Backup codes regenerated - Zygo',
    template: BackupCodesRegenerated({
      firstName: firstName || 'there',
      regeneratedAt: new Date(),
      ipAddress: details?.ipAddress,
      deviceInfo: details?.deviceInfo,
    }),
    headers: {
      'List-Unsubscribe': '<https://app.getzygo.com/settings/notifications>',
    },
  });
}

// Export the service object for backwards compatibility
export const emailService = {
  sendVerificationEmail,
  verifyEmailCode,
  hasActiveCode,
  getCodeTTL,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendWelcomeEmail,
  sendLoginAlertEmail,
  sendMfaEnabledEmail,
  sendMfaDisabledEmail,
  sendSessionRevokedEmail,
  sendBackupCodesRegeneratedEmail,
};
