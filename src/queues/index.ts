/**
 * Queue Configuration
 *
 * BullMQ queue setup for background job processing.
 */

import { Queue, QueueOptions } from 'bullmq';
import { getEnv } from '../config/env';

/**
 * Queue names
 */
export const QUEUE_NAMES = {
  REMINDERS: 'reminders',
} as const;

/**
 * Job types for the reminders queue
 */
export const JOB_TYPES = {
  // Batch processing jobs (scheduled daily)
  PROCESS_MFA_REMINDERS: 'process_mfa_reminders',
  PROCESS_PHONE_REMINDERS: 'process_phone_reminders',
  PROCESS_TRIAL_REMINDERS: 'process_trial_reminders',

  // Tenant deletion (scheduled daily)
  PROCESS_TENANT_DELETIONS: 'process_tenant_deletions',

  // Individual reminder job (queued by batch processors)
  SEND_REMINDER: 'send_reminder',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

/**
 * Reminder job payload types
 */
export interface SendReminderPayload {
  type: 'mfa_enablement' | 'phone_verification' | 'trial_expiration';
  stage: 'first' | 'final';
  userId: string;
  tenantId: string;
  email: string;
  firstName?: string;
  deadlineAt: string; // ISO date string
  daysRemaining: number;
  // Additional fields for trial reminders
  tenantName?: string;
}

export interface ProcessRemindersPayload {
  triggeredAt: string; // ISO date string
}

let reminderQueue: Queue | null = null;

/**
 * Get Redis connection options from environment
 */
function getRedisConnectionOptions() {
  const env = getEnv();

  // Parse Redis URL
  const url = new URL(env.REDIS_URL);

  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: env.REDIS_PASSWORD || url.password || undefined,
    tls: env.REDIS_TLS ? {} : undefined,
  };
}

/**
 * Get default queue options
 */
function getDefaultQueueOptions(): QueueOptions {
  return {
    connection: getRedisConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: {
        count: 1000, // Keep last 1000 completed jobs
        age: 24 * 60 * 60, // Remove jobs older than 24 hours
      },
      removeOnFail: {
        count: 5000, // Keep last 5000 failed jobs for debugging
        age: 7 * 24 * 60 * 60, // Remove failed jobs older than 7 days
      },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000, // 5 seconds initial delay
      },
    },
  };
}

/**
 * Get the reminder queue (lazy initialization)
 */
export function getReminderQueue(): Queue {
  if (reminderQueue) return reminderQueue;

  reminderQueue = new Queue(QUEUE_NAMES.REMINDERS, getDefaultQueueOptions());

  return reminderQueue;
}

/**
 * Close all queues gracefully
 */
export async function closeQueues(): Promise<void> {
  if (reminderQueue) {
    await reminderQueue.close();
    reminderQueue = null;
  }
}

/**
 * Export connection options for workers
 */
export { getRedisConnectionOptions };
