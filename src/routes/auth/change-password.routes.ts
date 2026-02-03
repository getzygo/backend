/**
 * Change Password Routes
 *
 * POST /api/v1/auth/change-password - Change password for authenticated user
 *
 * This is different from password reset (forgot-password flow):
 * - Requires authentication
 * - Requires current password verification
 * - For users already logged in who want to change their password
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';
import { verifyPassword, hashPassword } from '../../services/user.service';
import { updateAuthUser, signOut } from '../../services/supabase.service';
import { invalidateAuthToken } from '../../services/auth-token.service';
import { sendPasswordChangedEmail } from '../../services/email.service';

const app = new Hono();

// Change password schema - same requirements as signup
const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
});

/**
 * POST /api/v1/auth/change-password
 * Change password for authenticated user
 */
app.post('/', authMiddleware, zValidator('json', changePasswordSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();

  // Check if user has a password (might be OAuth-only user)
  if (!user.passwordHash) {
    return c.json(
      {
        error: 'no_password',
        message: 'Your account uses social login. Please set a password first via the forgot password flow.',
      },
      400
    );
  }

  // Verify current password
  const passwordValid = await verifyPassword(body.current_password, user.passwordHash);

  if (!passwordValid) {
    // Audit log failed attempt
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'password_change_failed',
      resourceType: 'user',
      resourceId: user.id,
      details: { reason: 'invalid_current_password' },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'failure',
    });

    return c.json(
      {
        error: 'invalid_password',
        message: 'Current password is incorrect',
      },
      401
    );
  }

  // Check if new password is same as current
  const samePassword = await verifyPassword(body.new_password, user.passwordHash);
  if (samePassword) {
    return c.json(
      {
        error: 'same_password',
        message: 'New password must be different from current password',
      },
      400
    );
  }

  // Hash the new password
  const passwordHash = await hashPassword(body.new_password);
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
    await updateAuthUser(user.id, { password: body.new_password });
  } catch (error) {
    console.error('Failed to update Supabase password:', error);
    // Continue - our DB is already updated
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'password_changed',
    resourceType: 'user',
    resourceId: user.id,
    details: {},
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Send password changed notification email (ALWAYS_SEND - cannot be disabled)
  sendPasswordChangedEmail(user.email, user.firstName || undefined, {
    ipAddress: ipAddress || undefined,
    deviceInfo: userAgent || undefined,
  }).catch((err) => {
    console.error('Failed to send password changed email:', err);
  });

  // Invalidate current session - user must re-login with new password
  // Get the auth token from the request header
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    // Invalidate the Zygo auth token
    await invalidateAuthToken(token).catch(console.error);
    // Sign out from Supabase
    await signOut(token).catch(console.error);
  }

  return c.json({
    success: true,
    message: 'Password changed successfully. Please sign in with your new password.',
    require_reauth: true,
  });
});

export default app;
