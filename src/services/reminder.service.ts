/**
 * Reminder Service
 *
 * Processes and sends automated reminder notifications for:
 * - MFA Enablement
 * - Phone Verification
 * - Free Trial Expiration
 */

import { eq, and, isNull, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  users,
  tenants,
  tenantSecurityConfig,
  tenantMembers,
  reminderLogs,
} from '../db/schema';
import type { ReminderType, ReminderStage } from '../db/schema/notifications';
import {
  getReminderQueue,
  JOB_TYPES,
  type SendReminderPayload,
} from '../queues';
import {
  sendMfaReminderEmail,
  sendPhoneReminderEmail,
  sendTrialReminderEmail,
} from './email.service';
import { createNotification, type NotificationCategory } from './notification.service';

// Default deadline days if tenant config not found
const DEFAULT_MFA_DEADLINE_DAYS = 7;
const DEFAULT_PHONE_DEADLINE_DAYS = 3;

// Reminder timing configuration
const REMINDER_CONFIG = {
  mfa_enablement: {
    firstReminderDays: 3, // 3 days before deadline
    finalReminderDays: 1, // 1 day before deadline
  },
  phone_verification: {
    firstReminderDays: 3, // 3 days before deadline
    finalReminderDays: 1, // 1 day before deadline
  },
  trial_expiration: {
    firstReminderDays: 3, // 3 days before expiry
    finalReminderDays: 1, // 1 day before expiry
  },
};

/**
 * Calculate deadline date for a user based on signup date and tenant config
 */
function calculateDeadline(createdAt: Date, deadlineDays: number): Date {
  const deadline = new Date(createdAt);
  deadline.setDate(deadline.getDate() + deadlineDays);
  return deadline;
}

/**
 * Calculate days remaining until a deadline
 */
function getDaysRemaining(deadline: Date): number {
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Format date for display in emails
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Check if a reminder has already been sent
 */
async function hasReminderBeenSent(
  userId: string | null,
  tenantId: string | null,
  reminderType: ReminderType,
  stage: ReminderStage
): Promise<boolean> {
  const db = getDb();

  const existing = await db.query.reminderLogs.findFirst({
    where: and(
      userId ? eq(reminderLogs.userId, userId) : isNull(reminderLogs.userId),
      tenantId ? eq(reminderLogs.tenantId, tenantId) : isNull(reminderLogs.tenantId),
      eq(reminderLogs.reminderType, reminderType),
      eq(reminderLogs.stage, stage)
    ),
  });

  return existing !== undefined;
}

/**
 * Log a reminder that was sent
 */
async function logReminder(
  options: {
    userId?: string;
    tenantId?: string;
    reminderType: ReminderType;
    stage: ReminderStage;
    emailSent: boolean;
    emailError?: string;
    inAppSent: boolean;
    deadlineAt?: Date;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const db = getDb();

  await db.insert(reminderLogs).values({
    userId: options.userId || null,
    tenantId: options.tenantId || null,
    reminderType: options.reminderType,
    stage: options.stage,
    emailSent: options.emailSent,
    emailSentAt: options.emailSent ? new Date() : null,
    emailError: options.emailError || null,
    inAppSent: options.inAppSent,
    inAppSentAt: options.inAppSent ? new Date() : null,
    deadlineAt: options.deadlineAt || null,
    metadata: options.metadata || {},
  });
}

// ============================================================================
// MFA Reminders
// ============================================================================

/**
 * Process MFA enablement reminders
 * Finds users who need to enable MFA and queues reminder jobs
 */
export async function processMfaReminders(): Promise<number> {
  const db = getDb();
  const queue = getReminderQueue();
  let queuedCount = 0;

  console.log('Processing MFA reminders...');

  // Find all users who:
  // 1. Have not enabled MFA
  // 2. Are active members of tenants that require MFA
  // 3. Are approaching their deadline
  const usersNeedingReminders = await db
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      userCreatedAt: users.createdAt,
      tenantId: tenants.id,
      tenantName: tenants.name,
      mfaDeadlineDays: tenantSecurityConfig.mfaDeadlineDays,
      requireMfa: tenantSecurityConfig.requireMfa,
    })
    .from(users)
    .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .leftJoin(tenantSecurityConfig, eq(tenantSecurityConfig.tenantId, tenants.id))
    .where(
      and(
        eq(users.mfaEnabled, false),
        eq(users.status, 'active'),
        eq(tenantMembers.status, 'active'),
        eq(tenants.status, 'active'),
        // Only include tenants that require MFA
        sql`(${tenantSecurityConfig.requireMfa} = true OR ${tenantSecurityConfig.requireMfa} IS NULL)`
      )
    );

  for (const user of usersNeedingReminders) {
    const deadlineDays = user.mfaDeadlineDays ?? DEFAULT_MFA_DEADLINE_DAYS;
    const deadline = calculateDeadline(user.userCreatedAt, deadlineDays);
    const daysRemaining = getDaysRemaining(deadline);

    // Skip if deadline has passed
    if (daysRemaining < 0) continue;

    // Determine which reminder to send
    let stage: ReminderStage | null = null;

    if (daysRemaining <= REMINDER_CONFIG.mfa_enablement.finalReminderDays) {
      stage = 'final';
    } else if (daysRemaining <= REMINDER_CONFIG.mfa_enablement.firstReminderDays) {
      stage = 'first';
    }

    if (!stage) continue;

    // Check if this reminder was already sent
    const alreadySent = await hasReminderBeenSent(
      user.userId,
      user.tenantId,
      'mfa_enablement',
      stage
    );

    if (alreadySent) continue;

    // Queue the reminder job
    const payload: SendReminderPayload = {
      type: 'mfa_enablement',
      stage,
      userId: user.userId,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName || undefined,
      deadlineAt: deadline.toISOString(),
      daysRemaining,
    };

    await queue.add(JOB_TYPES.SEND_REMINDER, payload, {
      jobId: `mfa-reminder-${user.userId}-${user.tenantId}-${stage}`,
    });

    queuedCount++;
  }

  console.log(`Queued ${queuedCount} MFA reminder(s)`);
  return queuedCount;
}

// ============================================================================
// Phone Verification Reminders
// ============================================================================

/**
 * Process phone verification reminders
 */
export async function processPhoneReminders(): Promise<number> {
  const db = getDb();
  const queue = getReminderQueue();
  let queuedCount = 0;

  console.log('Processing phone verification reminders...');

  // Find all users who:
  // 1. Have not verified their phone
  // 2. Are active members of tenants that require phone verification
  // 3. Are approaching their deadline
  const usersNeedingReminders = await db
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      userCreatedAt: users.createdAt,
      tenantId: tenants.id,
      tenantName: tenants.name,
      phoneDeadlineDays: tenantSecurityConfig.phoneVerificationDeadlineDays,
      requirePhone: tenantSecurityConfig.requirePhoneVerification,
    })
    .from(users)
    .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .leftJoin(tenantSecurityConfig, eq(tenantSecurityConfig.tenantId, tenants.id))
    .where(
      and(
        eq(users.phoneVerified, false),
        eq(users.status, 'active'),
        eq(tenantMembers.status, 'active'),
        eq(tenants.status, 'active'),
        // Only include tenants that require phone verification
        sql`(${tenantSecurityConfig.requirePhoneVerification} = true OR ${tenantSecurityConfig.requirePhoneVerification} IS NULL)`
      )
    );

  for (const user of usersNeedingReminders) {
    const deadlineDays = user.phoneDeadlineDays ?? DEFAULT_PHONE_DEADLINE_DAYS;
    const deadline = calculateDeadline(user.userCreatedAt, deadlineDays);
    const daysRemaining = getDaysRemaining(deadline);

    // Skip if deadline has passed
    if (daysRemaining < 0) continue;

    // Determine which reminder to send
    let stage: ReminderStage | null = null;

    if (daysRemaining <= REMINDER_CONFIG.phone_verification.finalReminderDays) {
      stage = 'final';
    } else if (daysRemaining <= REMINDER_CONFIG.phone_verification.firstReminderDays) {
      stage = 'first';
    }

    if (!stage) continue;

    // Check if this reminder was already sent
    const alreadySent = await hasReminderBeenSent(
      user.userId,
      user.tenantId,
      'phone_verification',
      stage
    );

    if (alreadySent) continue;

    // Queue the reminder job
    const payload: SendReminderPayload = {
      type: 'phone_verification',
      stage,
      userId: user.userId,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName || undefined,
      deadlineAt: deadline.toISOString(),
      daysRemaining,
    };

    await queue.add(JOB_TYPES.SEND_REMINDER, payload, {
      jobId: `phone-reminder-${user.userId}-${user.tenantId}-${stage}`,
    });

    queuedCount++;
  }

  console.log(`Queued ${queuedCount} phone verification reminder(s)`);
  return queuedCount;
}

// ============================================================================
// Trial Expiration Reminders
// ============================================================================

/**
 * Process trial expiration reminders
 * Sends to tenant owners only
 */
export async function processTrialReminders(): Promise<number> {
  const db = getDb();
  const queue = getReminderQueue();
  let queuedCount = 0;

  console.log('Processing trial expiration reminders...');

  // Find all tenants with:
  // 1. subscriptionStatus = 'trialing'
  // 2. trialExpiresAt approaching
  const trialingTenants = await db
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      trialExpiresAt: tenants.trialExpiresAt,
      ownerId: tenantMembers.userId,
      ownerEmail: users.email,
      ownerFirstName: users.firstName,
    })
    .from(tenants)
    .innerJoin(
      tenantMembers,
      and(eq(tenantMembers.tenantId, tenants.id), eq(tenantMembers.isOwner, true))
    )
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(
      and(
        eq(tenants.subscriptionStatus, 'trialing'),
        eq(tenants.status, 'active'),
        eq(users.status, 'active'),
        sql`${tenants.trialExpiresAt} IS NOT NULL`
      )
    );

  for (const tenant of trialingTenants) {
    if (!tenant.trialExpiresAt) continue;

    const daysRemaining = getDaysRemaining(tenant.trialExpiresAt);

    // Skip if trial has already expired
    if (daysRemaining < 0) continue;

    // Determine which reminder to send
    let stage: ReminderStage | null = null;

    if (daysRemaining <= REMINDER_CONFIG.trial_expiration.finalReminderDays) {
      stage = 'final';
    } else if (daysRemaining <= REMINDER_CONFIG.trial_expiration.firstReminderDays) {
      stage = 'first';
    }

    if (!stage) continue;

    // Check if this reminder was already sent
    const alreadySent = await hasReminderBeenSent(
      tenant.ownerId,
      tenant.tenantId,
      'trial_expiration',
      stage
    );

    if (alreadySent) continue;

    // Queue the reminder job
    const payload: SendReminderPayload = {
      type: 'trial_expiration',
      stage,
      userId: tenant.ownerId,
      tenantId: tenant.tenantId,
      email: tenant.ownerEmail,
      firstName: tenant.ownerFirstName || undefined,
      deadlineAt: tenant.trialExpiresAt.toISOString(),
      daysRemaining,
      tenantName: tenant.tenantName,
    };

    await queue.add(JOB_TYPES.SEND_REMINDER, payload, {
      jobId: `trial-reminder-${tenant.tenantId}-${stage}`,
    });

    queuedCount++;
  }

  console.log(`Queued ${queuedCount} trial expiration reminder(s)`);
  return queuedCount;
}

// ============================================================================
// Send Reminder (called by worker)
// ============================================================================

/**
 * Send a reminder notification (email + in-app)
 */
export async function sendReminder(payload: SendReminderPayload): Promise<void> {
  const deadlineDate = formatDate(new Date(payload.deadlineAt));
  const isFinal = payload.stage === 'final';
  const appUrl = process.env.FRONTEND_URL || 'https://app.getzygo.com';

  let emailSent = false;
  let emailError: string | undefined;
  let inAppSent = false;

  // Send email based on reminder type
  try {
    let emailResult;

    switch (payload.type) {
      case 'mfa_enablement':
        emailResult = await sendMfaReminderEmail(payload.email, {
          firstName: payload.firstName,
          daysRemaining: payload.daysRemaining,
          deadlineDate,
          isFinal,
          appUrl,
        });
        break;

      case 'phone_verification':
        emailResult = await sendPhoneReminderEmail(payload.email, {
          firstName: payload.firstName,
          daysRemaining: payload.daysRemaining,
          deadlineDate,
          isFinal,
          appUrl,
        });
        break;

      case 'trial_expiration':
        emailResult = await sendTrialReminderEmail(payload.email, {
          firstName: payload.firstName,
          tenantName: payload.tenantName,
          daysRemaining: payload.daysRemaining,
          expirationDate: deadlineDate,
          isFinal,
          appUrl,
        });
        break;
    }

    emailSent = emailResult?.sent || false;
    emailError = emailResult?.error;
  } catch (error) {
    emailError = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to send ${payload.type} email:`, error);
  }

  // Create in-app notification
  try {
    const notificationConfig = getNotificationConfig(payload.type, payload.stage, isFinal);

    await createNotification({
      userId: payload.userId,
      tenantId: payload.tenantId,
      type: notificationConfig.type,
      category: notificationConfig.category,
      title: notificationConfig.title,
      message: notificationConfig.message(payload.daysRemaining, deadlineDate),
      actionRoute: notificationConfig.actionRoute,
      actionLabel: notificationConfig.actionLabel,
      severity: isFinal ? 'warning' : 'info',
      metadata: {
        reminderType: payload.type,
        stage: payload.stage,
        deadlineAt: payload.deadlineAt,
      },
    });

    inAppSent = true;
  } catch (error) {
    console.error(`Failed to create ${payload.type} in-app notification:`, error);
  }

  // Log the reminder
  await logReminder({
    userId: payload.userId,
    tenantId: payload.tenantId,
    reminderType: payload.type,
    stage: payload.stage,
    emailSent,
    emailError,
    inAppSent,
    deadlineAt: new Date(payload.deadlineAt),
    metadata: {
      daysRemaining: payload.daysRemaining,
    },
  });

  console.log(
    `Sent ${payload.type} ${payload.stage} reminder to ${payload.email} ` +
      `(email: ${emailSent}, in-app: ${inAppSent})`
  );
}

/**
 * Get notification configuration for a reminder type
 */
function getNotificationConfig(
  type: ReminderType,
  stage: ReminderStage,
  isFinal: boolean
): {
  type: 'security' | 'system';
  category: NotificationCategory;
  title: string;
  message: (daysRemaining: number, deadlineDate: string) => string;
  actionRoute: string;
  actionLabel: string;
} {
  const configs = {
    mfa_enablement: {
      type: 'security' as const,
      category: (isFinal ? 'mfa_enablement_final' : 'mfa_enablement_first') as NotificationCategory,
      title: isFinal
        ? 'Action Required: Enable 2FA Tomorrow'
        : 'Reminder: Enable Two-Factor Authentication',
      message: (days: number, date: string) =>
        isFinal
          ? `Your organization requires 2FA to be enabled by ${date}. Please enable it today.`
          : `You have ${days} days to enable two-factor authentication on your account.`,
      actionRoute: '/settings/security',
      actionLabel: 'Enable 2FA',
    },
    phone_verification: {
      type: 'security' as const,
      category: (isFinal
        ? 'phone_verification_final'
        : 'phone_verification_first') as NotificationCategory,
      title: isFinal
        ? 'Action Required: Verify Phone Tomorrow'
        : 'Reminder: Verify Your Phone Number',
      message: (days: number, date: string) =>
        isFinal
          ? `Your organization requires phone verification by ${date}. Please verify today.`
          : `You have ${days} days to verify your phone number.`,
      actionRoute: '/settings/security',
      actionLabel: 'Verify Phone',
    },
    trial_expiration: {
      type: 'system' as const,
      category: (isFinal
        ? 'trial_expiration_final'
        : 'trial_expiration_first') as NotificationCategory,
      title: isFinal ? 'Your Trial Ends Tomorrow' : 'Trial Ending Soon',
      message: (days: number, date: string) =>
        isFinal
          ? `Your free trial ends ${date}. Upgrade now to keep your data.`
          : `Your free trial ends in ${days} days. Upgrade to continue using all features.`,
      actionRoute: '/settings/billing',
      actionLabel: 'Upgrade Now',
    },
  };

  return configs[type];
}

export const reminderService = {
  processMfaReminders,
  processPhoneReminders,
  processTrialReminders,
  sendReminder,
};

export default reminderService;
