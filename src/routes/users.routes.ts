/**
 * Users Routes
 *
 * PATCH /api/v1/users/me - Update current user's profile (authenticated)
 * PATCH /api/v1/users/me/public - Update profile during onboarding (email-based)
 * GET /api/v1/users/me - Get current user's profile
 * GET /api/v1/users/me/avatar - Get signed URL for user's avatar
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware';
import { getDb } from '../db/client';
import { users, auditLogs } from '../db/schema';
import {
  getSignedAvatarUrl,
  extractStoragePath,
  isExternalAvatarUrl,
  downloadAndStoreAvatar,
  deleteOldAvatars,
} from '../services/avatar.service';

const app = new Hono();

// Update profile schema (authenticated)
const updateProfileSchema = z.object({
  title: z.enum(['Mr', 'Ms', 'Mx', 'Dr', 'Prof', '']).optional().nullable(),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  job_title: z.string().max(100).optional().nullable(),
  reporting_manager_id: z.string().uuid().optional().nullable(),
  avatar_url: z.string().url().optional().nullable(),
  // Phone fields
  phone: z.string().max(20).optional().nullable(),
  phone_country_code: z.string().max(5).optional().nullable(),
  // Address fields
  address_line_1: z.string().max(255).optional().nullable(),
  address_line_2: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  state_code: z.string().max(10).optional().nullable(),
  country: z.string().length(2).optional().nullable(), // ISO 3166-1 alpha-2
  postal_code: z.string().max(20).optional().nullable(),
});

// Update profile schema (public - during onboarding)
const updateProfilePublicSchema = z.object({
  email: z.string().email('Invalid email address'),
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
});

/**
 * GET /api/v1/users/me
 * Get current user's profile
 */
app.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDb();

  let avatarUrl: string | null = null;
  let currentAvatarPath = user.avatarUrl;
  let avatarSource = user.avatarSource;

  if (user.avatarUrl) {
    // Check if avatar is external (OAuth provider URL) and source is not 'upload'
    // User uploads always take priority - don't overwrite with OAuth avatar
    if (isExternalAvatarUrl(user.avatarUrl) && avatarSource !== 'upload') {
      // Download external avatar to our private storage
      console.log(`[Users] Downloading OAuth avatar for user ${user.id}`);
      const { path, error } = await downloadAndStoreAvatar(user.id, user.avatarUrl);

      if (path && !error) {
        // Update user record with new storage path, mark as oauth source
        await db
          .update(users)
          .set({ avatarUrl: path, avatarSource: 'oauth', updatedAt: new Date() })
          .where(eq(users.id, user.id));

        currentAvatarPath = path;
        avatarSource = 'oauth';
        console.log(`[Users] OAuth avatar downloaded and stored: ${path}`);
      } else {
        console.error(`[Users] Failed to download OAuth avatar: ${error}`);
      }
    }

    // Generate signed URL for the avatar
    const storagePath = extractStoragePath(currentAvatarPath || '');
    if (storagePath) {
      const { url } = await getSignedAvatarUrl(storagePath);
      avatarUrl = url || null;
    }
  }

  // Fetch reporting manager info if set
  let reportingManager = null;
  if (user.reportingManagerId) {
    const manager = await db.query.users.findFirst({
      where: eq(users.id, user.reportingManagerId),
      columns: { id: true, firstName: true, lastName: true, email: true },
    });
    if (manager) {
      reportingManager = {
        id: manager.id,
        first_name: manager.firstName,
        last_name: manager.lastName,
        email: manager.email,
      };
    }
  }

  return c.json({
    id: user.id,
    email: user.email,
    title: user.title,
    first_name: user.firstName,
    last_name: user.lastName,
    job_title: user.jobTitle,
    reporting_manager_id: user.reportingManagerId,
    reporting_manager: reportingManager,
    avatar_url: avatarUrl,
    avatar_source: avatarSource,
    has_avatar: !!currentAvatarPath,
    email_verified: user.emailVerified,
    email_verified_via: user.emailVerifiedVia,
    // Phone fields
    phone: user.phone,
    phone_country_code: user.phoneCountryCode,
    phone_verified: user.phoneVerified,
    mfa_enabled: user.mfaEnabled,
    // Address fields
    address_line_1: user.addressLine1,
    address_line_2: user.addressLine2,
    city: user.city,
    state: user.state,
    state_code: user.stateCode,
    country: user.country,
    postal_code: user.postalCode,
    created_at: user.createdAt,
  });
});

/**
 * GET /api/v1/users/me/avatar
 * Get a fresh signed URL for the user's avatar
 */
app.get('/me/avatar', authMiddleware, async (c) => {
  const user = c.get('user');

  if (!user.avatarUrl) {
    return c.json({ avatar_url: null, has_avatar: false });
  }

  const storagePath = extractStoragePath(user.avatarUrl);
  if (!storagePath) {
    return c.json({ avatar_url: null, has_avatar: false });
  }

  const { url, error } = await getSignedAvatarUrl(storagePath);

  if (error) {
    return c.json(
      { error: 'avatar_url_error', message: error },
      500
    );
  }

  return c.json({
    avatar_url: url,
    has_avatar: true,
    expires_in: 3600, // 1 hour
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

  if (body.title !== undefined) {
    updates.title = body.title || null;
  }
  if (body.first_name !== undefined) {
    updates.firstName = body.first_name;
  }
  if (body.last_name !== undefined) {
    updates.lastName = body.last_name;
  }
  if (body.job_title !== undefined) {
    updates.jobTitle = body.job_title || null;
  }
  if (body.reporting_manager_id !== undefined) {
    updates.reportingManagerId = body.reporting_manager_id || null;
  }
  if (body.avatar_url !== undefined) {
    // Store the storage path (extract from full URL if needed)
    const newPath = body.avatar_url ? extractStoragePath(body.avatar_url) || body.avatar_url : null;
    updates.avatarUrl = newPath;
    updates.avatarSource = newPath ? 'upload' : null; // User upload takes priority

    // Clean up old avatar files if uploading a new one
    if (newPath && user.avatarUrl) {
      const oldPath = extractStoragePath(user.avatarUrl);
      if (oldPath && oldPath !== newPath) {
        // Delete old avatar asynchronously (don't wait)
        deleteOldAvatars(user.id, newPath).catch(console.error);
      }
    }
  }
  // Phone fields
  if (body.phone !== undefined) {
    updates.phone = body.phone;
    // Reset phone verification if phone number changes
    if (body.phone !== user.phone) {
      updates.phoneVerified = false;
    }
  }
  if (body.phone_country_code !== undefined) {
    updates.phoneCountryCode = body.phone_country_code;
  }
  // Address fields
  if (body.address_line_1 !== undefined) {
    updates.addressLine1 = body.address_line_1;
  }
  if (body.address_line_2 !== undefined) {
    updates.addressLine2 = body.address_line_2;
  }
  if (body.city !== undefined) {
    updates.city = body.city;
  }
  if (body.state !== undefined) {
    updates.state = body.state;
  }
  if (body.state_code !== undefined) {
    updates.stateCode = body.state_code;
  }
  if (body.country !== undefined) {
    updates.country = body.country;
  }
  if (body.postal_code !== undefined) {
    updates.postalCode = body.postal_code;
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
    title: updatedUser.title,
    first_name: updatedUser.firstName,
    last_name: updatedUser.lastName,
    job_title: updatedUser.jobTitle,
    reporting_manager_id: updatedUser.reportingManagerId,
    avatar_url: updatedUser.avatarUrl,
    email_verified: updatedUser.emailVerified,
    // Phone fields
    phone: updatedUser.phone,
    phone_country_code: updatedUser.phoneCountryCode,
    phone_verified: updatedUser.phoneVerified,
    mfa_enabled: updatedUser.mfaEnabled,
    // Address fields
    address_line_1: updatedUser.addressLine1,
    address_line_2: updatedUser.addressLine2,
    city: updatedUser.city,
    state: updatedUser.state,
    state_code: updatedUser.stateCode,
    country: updatedUser.country,
    postal_code: updatedUser.postalCode,
    updated_at: updatedUser.updatedAt,
  });
});

/**
 * PATCH /api/v1/users/me/public
 * Update user profile during onboarding (no auth required)
 * Uses email as identifier - intended for use right after signup
 * when user doesn't have a session yet.
 */
app.patch('/me/public', zValidator('json', updateProfilePublicSchema), async (c) => {
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const normalizedEmail = body.email.toLowerCase().trim();

  // Find the user by email
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (!user) {
    return c.json(
      {
        error: 'user_not_found',
        message: 'No account found with this email',
      },
      404
    );
  }

  // Update user profile
  const [updatedUser] = await db
    .update(users)
    .set({
      firstName: body.first_name,
      lastName: body.last_name,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'profile_updated',
    resourceType: 'user',
    resourceId: user.id,
    details: { updates: ['firstName', 'lastName'], via: 'onboarding' },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    id: updatedUser.id,
    email: updatedUser.email,
    first_name: updatedUser.firstName,
    last_name: updatedUser.lastName,
    email_verified: updatedUser.emailVerified,
    updated_at: updatedUser.updatedAt,
  });
});

/**
 * GET /api/v1/users/search
 * Search users for reporting manager selection
 * Returns users matching the search query (by name or email)
 */
app.get('/search', authMiddleware, async (c) => {
  const user = c.get('user');
  const query = c.req.query('q') || '';
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);

  const db = getDb();

  // Search users by name or email (excluding current user)
  const searchResults = await db.query.users.findMany({
    where: (users, { and, or, ne, ilike }) =>
      and(
        ne(users.id, user.id), // Exclude current user
        ne(users.status, 'deleted'), // Exclude deleted users
        query
          ? or(
              ilike(users.firstName, `%${query}%`),
              ilike(users.lastName, `%${query}%`),
              ilike(users.email, `%${query}%`)
            )
          : undefined
      ),
    columns: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatarUrl: true,
      jobTitle: true,
    },
    limit,
    orderBy: (users, { asc }) => [asc(users.firstName), asc(users.lastName)],
  });

  return c.json({
    users: searchResults.map((u) => ({
      id: u.id,
      first_name: u.firstName,
      last_name: u.lastName,
      email: u.email,
      avatar_url: u.avatarUrl,
      job_title: u.jobTitle,
    })),
  });
});

export default app;
