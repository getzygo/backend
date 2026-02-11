/**
 * Reminder Scheduler
 *
 * Sets up repeatable jobs for processing reminders.
 * Jobs run daily at specific times (UTC):
 * - MFA reminders: 9:00 AM
 * - Phone reminders: 9:15 AM
 * - Trial reminders: 9:30 AM
 */

import { getReminderQueue, JOB_TYPES } from './index';

/**
 * Schedule all reminder jobs
 */
export async function setupReminderSchedules(): Promise<void> {
  const queue = getReminderQueue();

  // Remove existing repeatable jobs to prevent duplicates on restart
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await queue.removeRepeatableByKey(job.key);
  }

  console.log('Setting up reminder schedules...');

  // MFA reminders - daily at 9:00 AM UTC
  await queue.add(
    JOB_TYPES.PROCESS_MFA_REMINDERS,
    { triggeredAt: new Date().toISOString() },
    {
      repeat: {
        pattern: '0 9 * * *', // Cron: minute 0, hour 9, every day
        tz: 'UTC',
      },
      jobId: 'mfa-reminders-daily',
    }
  );
  console.log('  - MFA reminders: daily at 9:00 AM UTC');

  // Phone reminders - daily at 9:15 AM UTC
  await queue.add(
    JOB_TYPES.PROCESS_PHONE_REMINDERS,
    { triggeredAt: new Date().toISOString() },
    {
      repeat: {
        pattern: '15 9 * * *', // Cron: minute 15, hour 9, every day
        tz: 'UTC',
      },
      jobId: 'phone-reminders-daily',
    }
  );
  console.log('  - Phone reminders: daily at 9:15 AM UTC');

  // Trial reminders - daily at 9:30 AM UTC
  await queue.add(
    JOB_TYPES.PROCESS_TRIAL_REMINDERS,
    { triggeredAt: new Date().toISOString() },
    {
      repeat: {
        pattern: '30 9 * * *', // Cron: minute 30, hour 9, every day
        tz: 'UTC',
      },
      jobId: 'trial-reminders-daily',
    }
  );
  console.log('  - Trial reminders: daily at 9:30 AM UTC');

  // Trial expirations - daily at 10:00 AM UTC (after reminders)
  await queue.add(
    JOB_TYPES.PROCESS_TRIAL_EXPIRATIONS,
    { triggeredAt: new Date().toISOString() },
    {
      repeat: {
        pattern: '0 10 * * *', // Cron: minute 0, hour 10, every day
        tz: 'UTC',
      },
      jobId: 'trial-expirations-daily',
    }
  );
  console.log('  - Trial expirations: daily at 10:00 AM UTC');

  // Tenant deletions - daily at 3:00 AM UTC (low traffic window)
  await queue.add(
    JOB_TYPES.PROCESS_TENANT_DELETIONS,
    { triggeredAt: new Date().toISOString() },
    {
      repeat: {
        pattern: '0 3 * * *', // Cron: minute 0, hour 3, every day
        tz: 'UTC',
      },
      jobId: 'tenant-deletions-daily',
    }
  );
  console.log('  - Tenant deletions: daily at 3:00 AM UTC');

  console.log('Reminder schedules configured successfully');
}

/**
 * Manually trigger a reminder process (for testing)
 */
export async function triggerReminderProcess(
  type: 'mfa' | 'phone' | 'trial' | 'trial_expiration' | 'tenant_deletion'
): Promise<string> {
  const queue = getReminderQueue();

  const jobTypeMap = {
    mfa: JOB_TYPES.PROCESS_MFA_REMINDERS,
    phone: JOB_TYPES.PROCESS_PHONE_REMINDERS,
    trial: JOB_TYPES.PROCESS_TRIAL_REMINDERS,
    trial_expiration: JOB_TYPES.PROCESS_TRIAL_EXPIRATIONS,
    tenant_deletion: JOB_TYPES.PROCESS_TENANT_DELETIONS,
  };

  const job = await queue.add(
    jobTypeMap[type],
    { triggeredAt: new Date().toISOString() },
    {
      jobId: `manual-${type}-${Date.now()}`,
    }
  );

  return job.id!;
}
