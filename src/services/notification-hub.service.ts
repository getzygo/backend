/**
 * Notification Hub Service
 *
 * Unified interface for sending notifications across all channels (email + in-app).
 * Respects user preferences and ALERT_POLICIES.
 *
 * Benefits:
 * - Single function for all notifications
 * - Preference-aware (respects user settings and ALWAYS_SEND policies)
 * - Resilient (email failure triggers in-app fallback)
 * - Consistent pattern everywhere
 * - Auditable (all notifications logged with delivery status)
 */

import type { ReactElement } from 'react';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { sendEmail } from './email.service';
import {
  createNotification,
  isCategoryEnabled,
  ALERT_POLICIES,
  type NotificationCategory,
  type NotificationType,
  type NotificationSeverity,
} from './notification.service';

interface NotifyOptions {
  // Target
  userId: string;
  tenantId?: string; // Optional for account-level notifications

  // Notification content
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  message: string;
  severity?: NotificationSeverity;
  actionRoute?: string;
  actionLabel?: string;

  // Email (optional - if not provided, in-app only)
  emailTemplate?: ReactElement;
  rawEmailHtml?: string; // Pre-rendered HTML (preferred over emailTemplate for Gmail compatibility)
  emailSubject?: string;

  // Metadata
  metadata?: Record<string, unknown>;
}

interface NotifyResult {
  emailSent: boolean;
  emailError?: string;
  inAppSent: boolean;
  inAppError?: string;
}

/**
 * Send a unified notification across email and in-app channels.
 *
 * This function:
 * 1. Checks ALERT_POLICIES to determine if notification is ALWAYS_SEND
 * 2. Checks user preferences (if not ALWAYS_SEND)
 * 3. Sends email if enabled and template provided
 * 4. Creates in-app notification if enabled OR if email failed (fallback)
 * 5. Logs results for auditing
 */
export async function notify(options: NotifyOptions): Promise<NotifyResult> {
  const result: NotifyResult = {
    emailSent: false,
    inAppSent: false,
  };

  // Get user email
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, options.userId),
    columns: { email: true, firstName: true },
  });

  if (!user) {
    console.error(`[NotificationHub] User not found: ${options.userId}`);
    return result;
  }

  // Check if this is an ALWAYS_SEND category
  const policy = ALERT_POLICIES[options.category as keyof typeof ALERT_POLICIES];
  const isAlwaysSend = policy === 'ALWAYS_SEND';

  // Check preferences (only if not ALWAYS_SEND)
  let shouldSendEmail = isAlwaysSend;
  let shouldSendInApp = isAlwaysSend;

  if (!isAlwaysSend && options.tenantId) {
    shouldSendEmail = await isCategoryEnabled(options.userId, options.tenantId, options.category, 'email');
    shouldSendInApp = await isCategoryEnabled(options.userId, options.tenantId, options.category, 'inApp');
  } else if (!isAlwaysSend) {
    // No tenant context - default to enabled
    shouldSendEmail = true;
    shouldSendInApp = true;
  }

  // 1. Send email if enabled and template/html provided
  if (shouldSendEmail && (options.emailTemplate || options.rawEmailHtml) && options.emailSubject) {
    try {
      const emailResult = await sendEmail({
        to: user.email,
        subject: options.emailSubject,
        ...(options.rawEmailHtml ? { rawHtml: options.rawEmailHtml } : { template: options.emailTemplate }),
      });
      result.emailSent = emailResult.sent;
      result.emailError = emailResult.error;
    } catch (error) {
      result.emailError = error instanceof Error ? error.message : 'Email send failed';
      console.error(`[NotificationHub] Email failed for ${options.category}:`, error);
    }
  }

  // 2. Create in-app notification if enabled OR if email failed (fallback)
  const shouldCreateInApp = shouldSendInApp || (shouldSendEmail && !result.emailSent);

  if (shouldCreateInApp && options.tenantId) {
    try {
      await createNotification({
        userId: options.userId,
        tenantId: options.tenantId,
        type: options.type,
        category: options.category,
        title: options.title,
        message: options.message,
        severity: options.severity || 'info',
        actionRoute: options.actionRoute,
        actionLabel: options.actionLabel,
        metadata: {
          ...options.metadata,
          emailSent: result.emailSent,
          emailError: result.emailError,
        },
      });
      result.inAppSent = true;
    } catch (error) {
      result.inAppError = error instanceof Error ? error.message : 'In-app notification failed';
      console.error(`[NotificationHub] In-app notification failed for ${options.category}:`, error);
    }
  }

  // Log result
  console.log(`[NotificationHub] ${options.category}: email=${result.emailSent}, inApp=${result.inAppSent}`);

  return result;
}

// Export convenience alias
export { notify as sendNotification };

// Re-export for easier imports
export { sendEmail } from './email.service';
