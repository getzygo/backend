/**
 * Set Password Routes
 *
 * POST /api/v1/auth/set-password - Set initial password for users without one
 *
 * For users who joined via OAuth or magic invite link and don't have a password.
 * Different from change-password (which requires current password) and
 * reset-password (which requires email verification code).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getDb } from '../../db/client';
import { users, auditLogs, tenantMembers } from '../../db/schema';
import { hashPassword } from '../../services/user.service';
import { updateAuthUser } from '../../services/supabase.service';
import { notify } from '../../services/notification-hub.service';
import { NOTIFICATION_CONFIGS, EMAIL_TEMPLATES } from '../../services/notification-configs';
import { rateLimit, RATE_LIMITS } from '../../middleware/rate-limit.middleware';

const app = new Hono();

// Set password schema - same requirements as signup
const setPasswordSchema = z.object({
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
});

/**
 * POST /api/v1/auth/set-password
 * Set initial password for authenticated users who don't have one yet
 */
app.post('/', authMiddleware, rateLimit(RATE_LIMITS.SENSITIVE), zValidator('json', setPasswordSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();

  // Only allow if user has no password yet
  if (user.passwordHash) {
    return c.json(
      {
        error: 'password_exists',
        message: 'You already have a password. Use the change password flow instead.',
      },
      400
    );
  }

  // Hash the new password
  const passwordHash = await hashPassword(body.password);
  const now = new Date();

  // Update password in our database
  await db
    .update(users)
    .set({
      passwordHash,
      passwordChangedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  // Update password in Supabase Auth
  try {
    await updateAuthUser(user.id, { password: body.password });
  } catch (error) {
    console.error('Failed to update Supabase password:', error);
    // Continue - our DB is already updated
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'password_set',
    resourceType: 'user',
    resourceId: user.id,
    details: { via: 'onboarding' },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Get user's primary tenant for in-app notification
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, user.id),
      eq(tenantMembers.status, 'active')
    ),
    columns: { tenantId: true },
  });

  // Send password set notification
  const config = NOTIFICATION_CONFIGS.password_changed;
  notify({
    userId: user.id,
    tenantId: membership?.tenantId,
    category: config.category,
    type: config.type,
    title: 'Password Set',
    message: 'You have set a password for your account.',
    severity: config.severity,
    actionRoute: config.actionRoute,
    actionLabel: config.actionLabel,
    emailTemplate: EMAIL_TEMPLATES.passwordChanged({
      firstName: user.firstName || undefined,
      ipAddress: ipAddress || undefined,
    }),
    emailSubject: 'Password Set for Your Zygo Account',
  }).catch((err) => console.error('[SetPassword] Notification failed:', err));

  return c.json({
    success: true,
    message: 'Password set successfully.',
  });
});

export default app;
