/**
 * Reminder Worker
 *
 * Processes reminder jobs from the queue.
 * Handles both batch processing jobs and individual reminder sending.
 */

import { Worker, Job } from 'bullmq';
import {
  QUEUE_NAMES,
  JOB_TYPES,
  getRedisConnectionOptions,
  type SendReminderPayload,
  type ProcessRemindersPayload,
} from '../index';
import {
  processMfaReminders,
  processPhoneReminders,
  processTrialReminders,
  sendReminder,
} from '../../services/reminder.service';

let reminderWorker: Worker | null = null;

/**
 * Process a reminder job
 */
async function processJob(job: Job): Promise<void> {
  const startTime = Date.now();
  console.log(`Processing job ${job.name} (${job.id})`);

  try {
    switch (job.name) {
      case JOB_TYPES.PROCESS_MFA_REMINDERS: {
        const count = await processMfaReminders();
        console.log(`MFA reminders processed: ${count} queued`);
        break;
      }

      case JOB_TYPES.PROCESS_PHONE_REMINDERS: {
        const count = await processPhoneReminders();
        console.log(`Phone reminders processed: ${count} queued`);
        break;
      }

      case JOB_TYPES.PROCESS_TRIAL_REMINDERS: {
        const count = await processTrialReminders();
        console.log(`Trial reminders processed: ${count} queued`);
        break;
      }

      case JOB_TYPES.PROCESS_TENANT_DELETIONS: {
        const { processPendingTenantDeletions } = await import('../../services/tenant-deletion.service');
        const count = await processPendingTenantDeletions();
        console.log(`Tenant deletions processed: ${count} executed`);
        break;
      }

      case JOB_TYPES.SEND_REMINDER: {
        const payload = job.data as SendReminderPayload;
        await sendReminder(payload);
        break;
      }

      default:
        console.warn(`Unknown job type: ${job.name}`);
    }

    const duration = Date.now() - startTime;
    console.log(`Job ${job.name} (${job.id}) completed in ${duration}ms`);
  } catch (error) {
    console.error(`Job ${job.name} (${job.id}) failed:`, error);
    throw error;
  }
}

/**
 * Start the reminder worker
 */
export function startReminderWorker(): Worker {
  if (reminderWorker) {
    return reminderWorker;
  }

  console.log('Starting reminder worker...');

  reminderWorker = new Worker(QUEUE_NAMES.REMINDERS, processJob, {
    connection: getRedisConnectionOptions(),
    concurrency: 5, // Process up to 5 jobs concurrently
    limiter: {
      max: 100, // Max 100 jobs per minute to avoid overwhelming email service
      duration: 60000,
    },
  });

  // Event handlers
  reminderWorker.on('ready', () => {
    console.log('Reminder worker is ready');
  });

  reminderWorker.on('active', (job) => {
    console.log(`Job ${job.name} (${job.id}) is now active`);
  });

  reminderWorker.on('completed', (job) => {
    console.log(`Job ${job.name} (${job.id}) completed`);
  });

  reminderWorker.on('failed', (job, error) => {
    console.error(`Job ${job?.name} (${job?.id}) failed:`, error.message);
  });

  reminderWorker.on('error', (error) => {
    console.error('Worker error:', error);
  });

  reminderWorker.on('stalled', (jobId) => {
    console.warn(`Job ${jobId} has stalled`);
  });

  return reminderWorker;
}

/**
 * Stop the reminder worker gracefully
 */
export async function stopReminderWorker(): Promise<void> {
  if (reminderWorker) {
    console.log('Stopping reminder worker...');
    await reminderWorker.close();
    reminderWorker = null;
    console.log('Reminder worker stopped');
  }
}

/**
 * Get the current worker instance
 */
export function getReminderWorker(): Worker | null {
  return reminderWorker;
}
