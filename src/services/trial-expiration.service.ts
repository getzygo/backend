/**
 * Trial Expiration Service
 *
 * Auto-downgrades tenants whose trial period has expired.
 * Runs daily via scheduled job to catch expired trials.
 */

import { eq, and, sql, lte } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  tenants,
  tenantMembers,
  users,
  auditLogs,
} from '../db/schema';
import { createNotification } from './notification.service';
import { sendTrialReminderEmail } from './email.service';

/**
 * Process all expired trials and downgrade them to Core plan.
 * Returns the count of tenants downgraded.
 */
export async function processExpiredTrials(): Promise<number> {
  const db = getDb();
  let downgradeCount = 0;

  console.log('Processing expired trials...');

  // Find tenants with expired trials
  const expiredTenants = await db
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
        sql`${tenants.trialExpiresAt} IS NOT NULL`,
        lte(tenants.trialExpiresAt, new Date())
      )
    );

  console.log(`Found ${expiredTenants.length} expired trials to process`);

  for (const tenant of expiredTenants) {
    try {
      // Downgrade to Core plan
      await db
        .update(tenants)
        .set({
          plan: 'core',
          subscriptionStatus: 'active',
          licenseCount: 1,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenant.tenantId));

      // Insert audit log
      await db.insert(auditLogs).values({
        userId: tenant.ownerId,
        tenantId: tenant.tenantId,
        action: 'trial_expired_downgrade',
        resourceType: 'tenant',
        resourceId: tenant.tenantId,
        details: {
          previousPlan: 'trialing',
          newPlan: 'core',
          trialExpiredAt: tenant.trialExpiresAt?.toISOString(),
        },
        status: 'success',
      });

      // Send notification to owner
      try {
        await createNotification({
          userId: tenant.ownerId,
          tenantId: tenant.tenantId,
          title: 'Trial expired — downgraded to Core',
          message: `Your free trial for ${tenant.tenantName} has ended. You've been moved to the Core plan. Upgrade anytime to restore team features.`,
          type: 'system',
          category: 'billing',
          priority: 'high',
        });
      } catch (notifErr) {
        console.error(`Failed to create notification for tenant ${tenant.tenantId}:`, notifErr);
      }

      downgradeCount++;
      console.log(`Downgraded tenant ${tenant.tenantId} (${tenant.tenantName}) to Core`);
    } catch (err) {
      console.error(`Failed to downgrade tenant ${tenant.tenantId}:`, err);
    }
  }

  console.log(`Trial expiration processing complete: ${downgradeCount} tenants downgraded`);
  return downgradeCount;
}
