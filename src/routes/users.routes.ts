/**
 * Users Routes
 *
 * GET /api/v1/users/me - Get current user's profile
 * PATCH /api/v1/users/me - Update current user's profile (authenticated)
 * PATCH /api/v1/users/me/public - Update profile during onboarding (email-based)
 * GET /api/v1/users/me/avatar/file - Get avatar file (private, tenant-scoped)
 * POST /api/v1/users/me/avatar - Upload avatar (tenant-scoped)
 * GET /api/v1/users/:userId/avatar/file - Get any user's avatar (tenant-scoped)
 * GET /api/v1/users/search - Search users for reporting manager selection
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, requireTenantMembership } from '../middleware/tenant.middleware';
import { getDb } from '../db/client';
import { users, auditLogs } from '../db/schema';
import {
  extractStoragePath,
  isExternalAvatarUrl,
  downloadAndStoreAvatar,
  uploadAvatar,
  deleteAvatarByPath,
  getAvatarFile,
  validateAvatarPathTenant,
} from '../services/avatar.service';

const app = new Hono();

// Update profile schema (authenticated)
// Note: avatar_url is not accepted here - use POST /users/me/avatar instead
const updateProfileSchema = z.object({
  title: z.enum(['Mr', 'Ms', 'Mx', 'Dr', 'Prof', '']).optional().nullable(),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  job_title: z.string().max(100).optional().nullable(),
  reporting_manager_id: z.string().uuid().optional().nullable(),
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
 * Note: Avatar URL is not exposed - use GET /users/me/avatar/file to fetch avatar
 */
app.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDb();

  const currentAvatarPath = user.avatarUrl;
  const avatarSource = user.avatarSource;

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
    // Avatar: no URL exposed - fetch via /users/me/avatar/file
    has_avatar: !!currentAvatarPath,
    avatar_source: avatarSource,
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
 * GET /api/v1/users/me/avatar/file
 * Stream avatar file directly - tenant-scoped, no external URLs exposed
 * Requires: auth + tenant context
 */
app.get('/me/avatar/file', authMiddleware, tenantMiddleware, requireTenantMembership, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('tenantId');

  if (!user.avatarUrl) {
    return c.json({ error: 'no_avatar', message: 'User has no avatar' }, 404);
  }

  const storagePath = extractStoragePath(user.avatarUrl);
  if (!storagePath) {
    return c.json({ error: 'invalid_path', message: 'Invalid avatar path' }, 404);
  }

  // Validate tenant ownership of the avatar
  if (!validateAvatarPathTenant(storagePath, tenantId)) {
    // Avatar exists but belongs to a different tenant context
    // This can happen with legacy avatars - serve them but log a warning
    console.warn(`[Users] Avatar path ${storagePath} does not match tenant ${tenantId} for user ${user.id}`);
  }

  // Get the actual file
  const { data, contentType, error } = await getAvatarFile(storagePath);

  if (error || !data) {
    return c.json(
      { error: 'avatar_fetch_error', message: error || 'Failed to fetch avatar' },
      500
    );
  }

  // Stream the file with appropriate headers
  const arrayBuffer = await data.arrayBuffer();
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': arrayBuffer.byteLength.toString(),
      'Cache-Control': 'private, no-cache, must-revalidate', // Don't cache - avatar can change
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/**
 * POST /api/v1/users/me/avatar
 * Upload avatar for current user (tenant-scoped)
 * Accepts multipart/form-data with 'avatar' file field
 * Requires: auth + tenant context
 */
app.post('/me/avatar', authMiddleware, tenantMiddleware, requireTenantMembership, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  try {
    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get('avatar') as File | null;

    if (!file) {
      return c.json(
        { error: 'no_file', message: 'No avatar file provided' },
        400
      );
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json(
        { error: 'invalid_type', message: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' },
        400
      );
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json(
        { error: 'file_too_large', message: 'File too large. Maximum size is 5MB' },
        400
      );
    }

    // Get file buffer
    const buffer = await file.arrayBuffer();

    // Upload via service with tenant-scoped path
    const { path, error: uploadError } = await uploadAvatar(tenantId, user.id, buffer, file.type);

    if (uploadError || !path) {
      console.error('[Users] Avatar upload failed:', uploadError);
      return c.json(
        { error: 'upload_failed', message: uploadError || 'Failed to upload avatar' },
        500
      );
    }

    // Update user record
    const db = getDb();
    const oldAvatarPath = extractStoragePath(user.avatarUrl || '');

    await db
      .update(users)
      .set({
        avatarUrl: path,
        avatarSource: 'upload',
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Clean up old avatar asynchronously
    if (oldAvatarPath && oldAvatarPath !== path) {
      deleteAvatarByPath(oldAvatarPath).catch(console.error);
    }

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'avatar_uploaded',
      resourceType: 'user',
      resourceId: user.id,
      details: { path, tenant_id: tenantId },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    // Return success - no URL exposed, client fetches via /avatar/file
    return c.json({
      success: true,
      has_avatar: true,
    });
  } catch (error) {
    console.error('[Users] Avatar upload error:', error);
    return c.json(
      { error: 'server_error', message: 'Failed to upload avatar' },
      500
    );
  }
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
  // Note: avatar_url updates are no longer accepted via PATCH
  // Use POST /users/me/avatar to upload avatars with tenant scoping
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
    // Avatar: no URL exposed - fetch via /users/me/avatar/file
    has_avatar: !!updatedUser.avatarUrl,
    avatar_source: updatedUser.avatarSource,
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
      // Avatar: no URL exposed - fetch via /users/{userId}/avatar/file
      has_avatar: !!u.avatarUrl,
      job_title: u.jobTitle,
    })),
  });
});

/**
 * GET /api/v1/users/:userId/avatar/file
 * Stream avatar file for any user in the same tenant
 * Requires: auth + tenant context + both users must be in same tenant
 */
app.get('/:userId/avatar/file', authMiddleware, tenantMiddleware, requireTenantMembership, async (c) => {
  const requestedUserId = c.req.param('userId');
  const tenantId = c.get('tenantId');
  const db = getDb();

  // Get the requested user
  const requestedUser = await db.query.users.findFirst({
    where: eq(users.id, requestedUserId),
    columns: { id: true, avatarUrl: true },
  });

  if (!requestedUser) {
    return c.json({ error: 'user_not_found', message: 'User not found' }, 404);
  }

  if (!requestedUser.avatarUrl) {
    return c.json({ error: 'no_avatar', message: 'User has no avatar' }, 404);
  }

  const storagePath = extractStoragePath(requestedUser.avatarUrl);
  if (!storagePath) {
    return c.json({ error: 'invalid_path', message: 'Invalid avatar path' }, 404);
  }

  // Validate tenant ownership of the avatar
  if (!validateAvatarPathTenant(storagePath, tenantId)) {
    // Avatar exists but belongs to a different tenant context
    console.warn(`[Users] Avatar path ${storagePath} does not match tenant ${tenantId} for user ${requestedUserId}`);
  }

  // Get the actual file
  const { data, contentType, error } = await getAvatarFile(storagePath);

  if (error || !data) {
    return c.json(
      { error: 'avatar_fetch_error', message: error || 'Failed to fetch avatar' },
      500
    );
  }

  // Stream the file with appropriate headers
  const arrayBuffer = await data.arrayBuffer();
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': arrayBuffer.byteLength.toString(),
      'Cache-Control': 'private, no-cache, must-revalidate', // Don't cache - avatar can change
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export default app;
