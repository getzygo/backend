/**
 * Users Routes
 *
 * PATCH /api/v1/users/me - Update current user's profile
 * GET /api/v1/users/me - Get current user's profile
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware';
import { getDb } from '../db/client';
import { users, auditLogs } from '../db/schema';

const app = new Hono();

// Update profile schema
const updateProfileSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().optional().nullable(),
});

/**
 * GET /api/v1/users/me
 * Get current user's profile
 */
app.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');

  return c.json({
    id: user.id,
    email: user.email,
    first_name: user.firstName,
    last_name: user.lastName,
    avatar_url: user.avatarUrl,
    email_verified: user.emailVerified,
    phone_verified: user.phoneVerified,
    mfa_enabled: user.mfaEnabled,
    created_at: user.createdAt,
  });
});

/**
 * PATCH /api/v1/users/me
 * Update current user's profile
 */
app.patch('/me', authMiddleware, zValidator('json', updateProfileSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  // Build update object
  const updates: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (body.first_name !== undefined) {
    updates.firstName = body.first_name;
  }
  if (body.last_name !== undefined) {
    updates.lastName = body.last_name;
  }
  if (body.avatar_url !== undefined) {
    updates.avatarUrl = body.avatar_url;
  }

  // Update user
  const db = getDb();
  const [updatedUser] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, user.id))
    .returning();

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'profile_updated',
    resourceType: 'user',
    resourceId: user.id,
    details: { updates: Object.keys(updates).filter(k => k !== 'updatedAt') },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    id: updatedUser.id,
    email: updatedUser.email,
    first_name: updatedUser.firstName,
    last_name: updatedUser.lastName,
    avatar_url: updatedUser.avatarUrl,
    email_verified: updatedUser.emailVerified,
    phone_verified: updatedUser.phoneVerified,
    mfa_enabled: updatedUser.mfaEnabled,
    updated_at: updatedUser.updatedAt,
  });
});

export default app;
