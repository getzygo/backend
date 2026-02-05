/**
 * Email Service
 *
 * Handles email sending using React Email templates.
 * Supports verification codes, password resets, security alerts, and more.
 */

import { randomInt } from 'crypto';
import { render } from '@react-email/render';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';
import { getEnv } from '../config/env';
import { logger } from '../utils/logger';
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
import { MfaReminder } from '../emails/templates/mfa-reminder';
import { PhoneReminder } from '../emails/templates/phone-reminder';
import { TrialReminder } from '../emails/templates/trial-reminder';
import { BillingEmailChanged } from '../emails/templates/billing-email-changed';
import { PrimaryContactChanged } from '../emails/templates/primary-contact-changed';
import { TenantDeletionRequested } from '../emails/templates/tenant-deletion-requested';
import { TenantDeletionCancelled } from '../emails/templates/tenant-deletion-cancelled';
import { MagicLink } from '../emails/templates/magic-link';
import { TenantEmailVerification } from '../emails/templates/tenant-email-verification';
import { CriticalActionVerification } from '../emails/templates/critical-action-verification';
// TeamInvite React Email template replaced with raw HTML for reliable Gmail rendering

// Types
interface SendEmailOptions {
  to: string;
  subject: string;
  template?: ReactElement;
  rawHtml?: string;
  rawText?: string;
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
 * Send an email using a React Email template or raw HTML
 */
export async function sendEmail({ to, subject, template, rawHtml, rawText, headers = {} }: SendEmailOptions): Promise<SendEmailResult> {
  const env = getEnv();

  try {
    // Render HTML and plain text versions
    const html = rawHtml || await render(template!);
    const text = rawText || await render(template!, { plainText: true });

    if (!isSmtpConfigured()) {
      logger.dev(`SMTP not configured, skipping email to ${to}: ${subject}`);
      return { sent: true };
    }

    const transporter = await getTransporter();

    await transporter.sendMail({
      from: `"Zygo" <${env.EMAIL_FROM}>`,
      replyTo: '"Zygo Support" <support@getzygo.com>',
      to,
      subject,
      html,
      text,
      headers: {
        'X-Mailer': 'Zygo Mail Service',
        ...headers,
      },
    });

    // Log successful email sends in production for tracking
    console.log(`[Email] Sent "${subject}" to ${to}`);

    return { sent: true };
  } catch (error) {
    logger.error('Failed to send email:', error);
    return {
      sent: false,
      error: error instanceof Error ? error.message : 'Failed to send email',
    };
  }
}

/**
 * Generate a cryptographically secure 6-digit verification code
 */
function generateCode(): string {
  return randomInt(100000, 1000000).toString();
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
    logger.dev(`Email verification code for ${email}: ${code}`);
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
    logger.dev(`Password reset code for ${email}: ${code}`);
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
  details?: { ipAddress?: string; deviceInfo?: string; appUrl?: string }
): Promise<SendEmailResult> {
  const baseUrl = details?.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Password changed notification would be sent to ${email}`);
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
      appUrl: baseUrl,
    }),
  });
}

/**
 * Send welcome email after verification
 */
export async function sendWelcomeEmail(
  email: string,
  firstName?: string,
  appUrl?: string
): Promise<SendEmailResult> {
  const baseUrl = appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Welcome email would be sent to ${email}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'Welcome to Zygo!',
    template: Welcome({ firstName: firstName || 'there', appUrl: baseUrl }),
    headers: {
      'List-Unsubscribe': `<${baseUrl}/settings/notifications>`,
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
    appUrl?: string;
  }
): Promise<SendEmailResult> {
  const baseUrl = details.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Login alert would be sent to ${email}:`, details);
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
      appUrl: baseUrl,
    }),
    // Suspicious login alerts cannot be unsubscribed
    headers: details.isSuspicious
      ? {}
      : { 'List-Unsubscribe': `<${baseUrl}/settings/notifications>` },
  });
}

/**
 * Send MFA enabled notification
 */
export async function sendMfaEnabledEmail(
  email: string,
  firstName?: string,
  method?: 'totp' | 'webauthn' | 'sms',
  appUrl?: string
): Promise<SendEmailResult> {
  const baseUrl = appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` MFA enabled email would be sent to ${email}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'Two-factor authentication enabled - Zygo',
    template: MfaEnabled({
      firstName: firstName || 'there',
      method: method || 'totp',
      enabledAt: new Date(),
      appUrl: baseUrl,
    }),
    headers: {
      'List-Unsubscribe': `<${baseUrl}/settings/notifications>`,
    },
  });
}

/**
 * Send MFA disabled notification (ALWAYS_SEND - cannot be disabled)
 */
export async function sendMfaDisabledEmail(
  email: string,
  firstName?: string,
  details?: { ipAddress?: string; deviceInfo?: string; appUrl?: string }
): Promise<SendEmailResult> {
  const baseUrl = details?.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` MFA disabled email would be sent to ${email}`);
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
      appUrl: baseUrl,
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
    appUrl?: string;
  }
): Promise<SendEmailResult> {
  const baseUrl = details.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Session revoked email would be sent to ${email}:`, details);
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
      appUrl: baseUrl,
    }),
    headers: {
      'List-Unsubscribe': `<${baseUrl}/settings/notifications>`,
    },
  });
}

/**
 * Send backup codes regenerated notification
 */
export async function sendBackupCodesRegeneratedEmail(
  email: string,
  firstName?: string,
  details?: { ipAddress?: string; deviceInfo?: string; appUrl?: string }
): Promise<SendEmailResult> {
  const baseUrl = details?.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Backup codes regenerated email would be sent to ${email}`);
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
      appUrl: baseUrl,
    }),
    headers: {
      'List-Unsubscribe': `<${baseUrl}/settings/notifications>`,
    },
  });
}

/**
 * Send MFA reminder email (ALWAYS_SEND - cannot be disabled)
 */
export async function sendMfaReminderEmail(
  email: string,
  options: {
    firstName?: string;
    daysRemaining: number;
    deadlineDate: string;
    isFinal: boolean;
    appUrl?: string;
  }
): Promise<SendEmailResult> {
  const baseUrl = options.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` MFA reminder email would be sent to ${email}:`, options);
    return { sent: true };
  }

  const subject = options.isFinal
    ? 'Action Required: Enable 2FA by tomorrow - Zygo'
    : 'Reminder: Enable two-factor authentication - Zygo';

  return sendEmail({
    to: email,
    subject,
    template: MfaReminder({
      firstName: options.firstName || 'there',
      daysRemaining: options.daysRemaining,
      deadlineDate: options.deadlineDate,
      isFinal: options.isFinal,
      appUrl: baseUrl,
    }),
  });
}

/**
 * Send phone verification reminder email (ALWAYS_SEND - cannot be disabled)
 */
export async function sendPhoneReminderEmail(
  email: string,
  options: {
    firstName?: string;
    daysRemaining: number;
    deadlineDate: string;
    isFinal: boolean;
    appUrl?: string;
  }
): Promise<SendEmailResult> {
  const baseUrl = options.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Phone reminder email would be sent to ${email}:`, options);
    return { sent: true };
  }

  const subject = options.isFinal
    ? 'Action Required: Verify your phone by tomorrow - Zygo'
    : 'Reminder: Verify your phone number - Zygo';

  return sendEmail({
    to: email,
    subject,
    template: PhoneReminder({
      firstName: options.firstName || 'there',
      daysRemaining: options.daysRemaining,
      deadlineDate: options.deadlineDate,
      isFinal: options.isFinal,
      appUrl: baseUrl,
    }),
  });
}

/**
 * Send trial expiration reminder email (ALLOW_DISABLE - user can unsubscribe)
 */
export async function sendTrialReminderEmail(
  email: string,
  options: {
    firstName?: string;
    tenantName?: string;
    daysRemaining: number;
    expirationDate: string;
    isFinal: boolean;
    appUrl?: string;
  }
): Promise<SendEmailResult> {
  const baseUrl = options.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Trial reminder email would be sent to ${email}:`, options);
    return { sent: true };
  }

  const subject = options.isFinal
    ? 'Your trial ends tomorrow - Zygo'
    : `Your trial ends in ${options.daysRemaining} days - Zygo`;

  return sendEmail({
    to: email,
    subject,
    template: TrialReminder({
      firstName: options.firstName || 'there',
      tenantName: options.tenantName,
      daysRemaining: options.daysRemaining,
      expirationDate: options.expirationDate,
      isFinal: options.isFinal,
      appUrl: baseUrl,
    }),
    headers: {
      'List-Unsubscribe': `<${baseUrl}/settings/notifications>`,
    },
  });
}

/**
 * Send billing email changed notification (ALWAYS_SEND - cannot be disabled)
 */
export async function sendBillingEmailChangedEmail(
  email: string,
  options: {
    tenantName?: string;
    newEmail?: string;
    changedBy?: string;
    isNewAddress?: boolean;
    appUrl?: string;
  }
): Promise<SendEmailResult> {
  const baseUrl = options.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Billing email changed notification would be sent to ${email}:`, options);
    return { sent: true };
  }

  const subject = options.isNewAddress
    ? 'You are now the billing contact - Zygo'
    : 'Billing email changed - Zygo';

  return sendEmail({
    to: email,
    subject,
    template: BillingEmailChanged({
      tenantName: options.tenantName,
      newEmail: options.newEmail,
      changedBy: options.changedBy,
      isNewAddress: options.isNewAddress,
      appUrl: baseUrl,
    }),
  });
}

/**
 * Send primary contact changed notification (ALWAYS_SEND - cannot be disabled)
 */
export async function sendPrimaryContactChangedEmail(
  email: string,
  options: {
    contactName?: string;
    action?: 'added' | 'updated' | 'removed';
    changedBy?: string;
    newEmail?: string;
    isNewAddress?: boolean;
    appUrl?: string;
  }
): Promise<SendEmailResult> {
  const baseUrl = options.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Primary contact changed notification would be sent to ${email}:`, options);
    return { sent: true };
  }

  let subject: string;
  if (options.isNewAddress) {
    subject = 'You are now the primary contact - Zygo';
  } else if (options.action === 'removed') {
    subject = 'Primary contact removed - Zygo';
  } else if (options.action === 'added') {
    subject = 'Primary contact added - Zygo';
  } else {
    subject = 'Primary contact updated - Zygo';
  }

  return sendEmail({
    to: email,
    subject,
    template: PrimaryContactChanged({
      contactName: options.contactName,
      action: options.action,
      changedBy: options.changedBy,
      newEmail: options.newEmail,
      isNewAddress: options.isNewAddress,
      appUrl: baseUrl,
    }),
  });
}

/**
 * Send tenant deletion requested notification (ALWAYS_SEND - cannot be disabled)
 */
export async function sendTenantDeletionRequestedEmail(
  email: string,
  options: {
    firstName?: string;
    tenantName?: string;
    deletionScheduledAt: Date;
    cancelableUntil: Date;
    requestedBy?: string;
    reason?: string;
    appUrl?: string;
  }
): Promise<SendEmailResult> {
  const baseUrl = options.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Tenant deletion requested notification would be sent to ${email}:`, options);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: `Workspace deletion scheduled - ${options.tenantName || 'Zygo'}`,
    template: TenantDeletionRequested({
      firstName: options.firstName,
      tenantName: options.tenantName,
      deletionScheduledAt: options.deletionScheduledAt,
      cancelableUntil: options.cancelableUntil,
      requestedBy: options.requestedBy,
      reason: options.reason,
      appUrl: baseUrl,
    }),
  });
}

/**
 * Send tenant deletion cancelled notification (ALWAYS_SEND - cannot be disabled)
 */
export async function sendTenantDeletionCancelledEmail(
  email: string,
  options: {
    firstName?: string;
    tenantName?: string;
    cancelledBy?: string;
    appUrl?: string;
  }
): Promise<SendEmailResult> {
  const baseUrl = options.appUrl || 'https://app.getzygo.com';

  if (!isSmtpConfigured()) {
    logger.dev(` Tenant deletion cancelled notification would be sent to ${email}:`, options);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: `Workspace deletion cancelled - ${options.tenantName || 'Zygo'}`,
    template: TenantDeletionCancelled({
      firstName: options.firstName,
      tenantName: options.tenantName,
      cancelledBy: options.cancelledBy,
      appUrl: baseUrl,
    }),
  });
}

/**
 * Send magic link email for passwordless sign-in
 */
export async function sendMagicLinkEmail(
  to: string,
  firstName: string | null,
  magicLinkUrl: string,
  expiresInMinutes: number = 15
): Promise<SendEmailResult> {
  return sendEmail({
    to,
    subject: 'Sign in to Zygo',
    template: MagicLink({
      firstName: firstName || 'there',
      magicLinkUrl,
      expiresInMinutes,
    }),
  });
}

/**
 * Send tenant email verification code
 * Used for verifying billing email and contact emails in tenant settings
 */
export async function sendTenantVerificationEmail(
  email: string,
  options: {
    code: string;
    tenantName?: string;
    fieldName: string;
    expiresInMinutes?: number;
  }
): Promise<{ sent: boolean; error?: string }> {
  if (!isSmtpConfigured()) {
    logger.dev(`Tenant verification code for ${email} (${options.fieldName}): ${options.code}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: `Verify your ${options.fieldName} - Zygo`,
    template: TenantEmailVerification({
      code: options.code,
      tenantName: options.tenantName,
      fieldName: options.fieldName,
      expiresInMinutes: options.expiresInMinutes || 15,
    }),
  });
}

/**
 * Send critical action verification email
 * Used for high-security actions like tenant deletion, account deletion, etc.
 */
export async function sendCriticalActionVerificationEmail(
  email: string,
  options: {
    firstName?: string;
    actionDescription: string;
    code: string;
    expiresInMinutes?: number;
  }
): Promise<{ sent: boolean; error?: string }> {
  if (!isSmtpConfigured()) {
    logger.dev(`Critical action verification code for ${email}: ${options.code}`);
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: 'Security verification required - Zygo',
    template: CriticalActionVerification({
      firstName: options.firstName,
      actionDescription: options.actionDescription,
      code: options.code,
      expiresInMinutes: options.expiresInMinutes || 10,
    }),
  });
}

/**
 * Send team invite email
 * Used when inviting a user to join a tenant/workspace.
 * Uses raw HTML (not React Email) for reliable Gmail rendering.
 */
export async function sendTeamInviteEmail(
  email: string,
  options: {
    inviteeName?: string;
    inviterName?: string;
    tenantName?: string;
    roleName?: string;
    message?: string;
    inviteToken: string;
    tenantSlug: string;
    expiresInDays?: number;
    magicLinkToken?: string;
    isExistingUser?: boolean;
  }
): Promise<SendEmailResult> {
  let acceptUrl: string;
  if (options.magicLinkToken) {
    acceptUrl = `https://api.zygo.tech/api/v1/invites/magic-accept?invite=${options.inviteToken}&ml=${options.magicLinkToken}`;
  } else {
    acceptUrl = `https://${options.tenantSlug}.zygo.tech/invite/${options.inviteToken}`;
  }

  const inviteeName = escapeHtml(options.inviteeName || 'there');
  const inviterName = escapeHtml(options.inviterName || 'Someone');
  const tenantName = escapeHtml(options.tenantName || 'a workspace');
  const roleName = escapeHtml(options.roleName || 'Member');
  const expiresInDays = options.expiresInDays || 7;
  const year = new Date().getFullYear();

  const expiryText = options.isExistingUser
    ? 'This link expires in 24 hours. After that, you can still accept by signing in to the workspace.'
    : `This invitation expires in ${expiresInDays} days.`;

  const messageBlock = options.message
    ? `<tr><td style="padding:0 40px 24px"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#f3f4f6;border-radius:8px;padding:16px 20px;font-size:14px;line-height:1.5;color:#6b7280;font-style:italic">&ldquo;${escapeHtml(options.message)}&rdquo;</td></tr></table></td></tr>`
    : '';

  const rawHtml = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Team Invitation</title>
  <!--[if mso]>
  <style type="text/css">
    table { border-collapse: collapse; }
    .button-link { padding: 12px 24px !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
  <!-- Preview text -->
  <div style="display:none;max-height:0;overflow:hidden">${inviterName} invited you to join ${tenantName} on Zygo</div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6">
    <tr>
      <td align="center" style="padding:40px 20px">

        <!-- Main container -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%">

          <!-- Logo header -->
          <tr>
            <td align="center" style="padding:32px 40px 24px;border-bottom:1px solid #e5e7eb">
              <img src="https://demo.zygo.tech/logo.png" alt="Zygo" width="48" height="48" style="display:block;border:0" />
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td align="center" style="padding:32px 40px 8px">
              <h1 style="margin:0;font-size:24px;font-weight:600;color:#111827">You&#39;re invited!</h1>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:16px 40px 0;font-size:15px;line-height:1.6;color:#374151">
              Hi ${inviteeName},
            </td>
          </tr>

          <!-- Invite details -->
          <tr>
            <td style="padding:8px 40px 24px;font-size:15px;line-height:1.6;color:#374151">
              <strong>${inviterName}</strong> has invited you to join <strong>${tenantName}</strong> on Zygo as a <strong>${roleName}</strong>.
            </td>
          </tr>

          ${messageBlock}

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding:8px 40px 24px">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${acceptUrl}" style="height:44px;v-text-anchor:middle;width:220px" arcsize="14%" fillcolor="#4f46e5" strokecolor="#4f46e5" strokeweight="0">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:600">Accept Invitation</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${acceptUrl}" target="_blank" style="display:inline-block;background-color:#4f46e5;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:6px;line-height:1.5">Accept Invitation</a>
              <!--<![endif]-->
            </td>
          </tr>

          <!-- Expiry note -->
          <tr>
            <td align="center" style="padding:0 40px 24px;font-size:13px;color:#6b7280">
              ${expiryText}
            </td>
          </tr>

          <!-- Safety note -->
          <tr>
            <td style="padding:0 40px 24px;font-size:14px;line-height:1.6;color:#374151">
              If you didn&#39;t expect this invitation, you can safely ignore this email or contact <a href="mailto:support@getzygo.com" style="color:#4f46e5;text-decoration:none">our support team</a>.
            </td>
          </tr>

          <!-- Signature -->
          <tr>
            <td style="padding:0 40px 32px;font-size:15px;line-height:1.6;color:#374151">
              Best,<br />The Zygo Team
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:0 40px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #e5e7eb;padding-top:24px"></td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 16px;font-size:13px;color:#6b7280">
              <a href="https://getzygo.com/privacy" style="color:#4f46e5;text-decoration:none">Privacy Policy</a>
              &nbsp;&bull;&nbsp;
              <a href="https://getzygo.com/terms" style="color:#4f46e5;text-decoration:none">Terms of Service</a>
              &nbsp;&bull;&nbsp;
              <a href="mailto:support@getzygo.com" style="color:#4f46e5;text-decoration:none">Contact Support</a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 8px;font-size:12px;line-height:1.5;color:#9ca3af">
              ZYGO AI Technologies<br />Budapest, Hungary
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 32px;font-size:12px;color:#9ca3af">
              &copy; ${year} Zygo. All rights reserved.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const rawText = `You're invited!

Hi ${options.inviteeName || 'there'},

${options.inviterName || 'Someone'} has invited you to join ${options.tenantName || 'a workspace'} on Zygo as a ${options.roleName || 'Member'}.

${options.message ? `"${options.message}"\n\n` : ''}Accept the invitation: ${acceptUrl}

${expiryText}

If you didn't expect this invitation, you can safely ignore this email.

Best,
The Zygo Team

---
Privacy Policy: https://getzygo.com/privacy
Terms of Service: https://getzygo.com/terms
Support: support@getzygo.com

ZYGO AI Technologies, Budapest, Hungary
© ${year} Zygo. All rights reserved.`;

  if (!isSmtpConfigured()) {
    logger.dev(` Team invite email would be sent to ${email}:`, {
      ...options,
      acceptUrl,
    });
    return { sent: true };
  }

  return sendEmail({
    to: email,
    subject: `${options.inviterName || 'Someone'} invited you to join ${options.tenantName || 'a workspace'} on Zygo`,
    rawHtml,
    rawText,
  });
}

/** Escape HTML special characters */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  sendMfaReminderEmail,
  sendPhoneReminderEmail,
  sendTrialReminderEmail,
  sendBillingEmailChangedEmail,
  sendPrimaryContactChangedEmail,
  sendTenantDeletionRequestedEmail,
  sendTenantDeletionCancelledEmail,
  sendMagicLinkEmail,
  sendTenantVerificationEmail,
  sendCriticalActionVerificationEmail,
  sendTeamInviteEmail,
};
