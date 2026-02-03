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
import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware';
import { tenantMiddleware, optionalTenantMiddleware, requireTenantMembership } from '../middleware/tenant.middleware';
import { getDb } from '../db/client';
import { users, auditLogs, tenantMembers } from '../db/schema';
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
 *
 * Tenant-scoped fields (job_title, reporting_manager_id) require tenant context:
 * - Send X-Zygo-Tenant-Slug header to get tenant-specific values
 * - Without tenant context, these fields return null
 */
app.get('/me', authMiddleware, optionalTenantMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('tenantId'); // May be undefined if no tenant context
  const db = getDb();

  const currentAvatarPath = user.avatarUrl;
  const avatarSource = user.avatarSource;

  // Fetch tenant-scoped fields if tenant context is provided
  let jobTitle: string | null = null;
  let reportingManagerId: string | null = null;
  let reportingManager = null;

  if (tenantId) {
    // Get tenant membership with tenant-scoped profile fields
    const membership = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, user.id)
      ),
    });

    if (membership) {
      jobTitle = membership.jobTitle;
      reportingManagerId = membership.reportingManagerId;

      // Fetch reporting manager info if set
      if (reportingManagerId) {
        const manager = await db.query.users.findFirst({
          where: eq(users.id, reportingManagerId),
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
    }
  }

  return c.json({
    id: user.id,
    email: user.email,
    title: user.title,
    first_name: user.firstName,
    last_name: user.lastName,
    // Tenant-scoped fields
    job_title: jobTitle,
    reporting_manager_id: reportingManagerId,
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
    // Password status (for OAuth-only users who can't change password)
    has_password: !!user.passwordHash,
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
 *
 * Tenant-scoped fields (job_title, reporting_manager_id) require tenant context:
 * - Send X-Zygo-Tenant-Slug header to update tenant-specific values
 * - Without tenant context, these fields are ignored
 */
app.patch('/me', authMiddleware, optionalTenantMiddleware, zValidator('json', updateProfileSchema), async (c) => {
  const user = c.get('user');
  const tenantId = c.get('tenantId'); // May be undefined if no tenant context
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();

  // Build update object for user-level fields
  const userUpdates: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (body.title !== undefined) {
    userUpdates.title = body.title || null;
  }
  if (body.first_name !== undefined) {
    userUpdates.firstName = body.first_name;
  }
  if (body.last_name !== undefined) {
    userUpdates.lastName = body.last_name;
  }
  // Note: avatar_url updates are no longer accepted via PATCH
  // Use POST /users/me/avatar to upload avatars with tenant scoping
  // Phone fields
  if (body.phone !== undefined) {
    userUpdates.phone = body.phone;
    // Reset phone verification if phone number changes
    if (body.phone !== user.phone) {
      userUpdates.phoneVerified = false;
    }
  }
  if (body.phone_country_code !== undefined) {
    userUpdates.phoneCountryCode = body.phone_country_code;
  }
  // Address fields
  if (body.address_line_1 !== undefined) {
    userUpdates.addressLine1 = body.address_line_1;
  }
  if (body.address_line_2 !== undefined) {
    userUpdates.addressLine2 = body.address_line_2;
  }
  if (body.city !== undefined) {
    userUpdates.city = body.city;
  }
  if (body.state !== undefined) {
    userUpdates.state = body.state;
  }
  if (body.state_code !== undefined) {
    userUpdates.stateCode = body.state_code;
  }
  if (body.country !== undefined) {
    userUpdates.country = body.country;
  }
  if (body.postal_code !== undefined) {
    userUpdates.postalCode = body.postal_code;
  }

  // Update user-level fields
  const [updatedUser] = await db
    .update(users)
    .set(userUpdates)
    .where(eq(users.id, user.id))
    .returning();

  // Handle tenant-scoped fields (job_title, reporting_manager_id)
  let jobTitle: string | null = null;
  let reportingManagerId: string | null = null;
  const tenantUpdates: string[] = [];

  if (tenantId) {
    // Build tenant-scoped updates
    const memberUpdates: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (body.job_title !== undefined) {
      memberUpdates.jobTitle = body.job_title || null;
      tenantUpdates.push('job_title');
    }
    if (body.reporting_manager_id !== undefined) {
      const newManagerId = body.reporting_manager_id || null;

      // Validate: Can't set self as reporting manager
      if (newManagerId && newManagerId === user.id) {
        return c.json(
          {
            error: 'invalid_manager',
            message: 'You cannot set yourself as your own reporting manager',
          },
          400
        );
      }

      // Validate: Check for circular reporting chain
      // If newManagerId reports to current user (directly or indirectly), it creates a cycle
      if (newManagerId) {
        const visited = new Set<string>();
        let currentId: string | null = newManagerId;

        while (currentId) {
          if (currentId === user.id) {
            return c.json(
              {
                error: 'circular_manager',
                message: 'This would create a circular reporting relationship',
              },
              400
            );
          }
          if (visited.has(currentId)) {
            break; // Already checked this path
          }
          visited.add(currentId);

          // Get the manager's manager
          const managerMembership: { reportingManagerId: string | null } | undefined = await db.query.tenantMembers.findFirst({
            where: and(
              eq(tenantMembers.tenantId, tenantId),
              eq(tenantMembers.userId, currentId)
            ),
            columns: { reportingManagerId: true },
          });

          currentId = managerMembership?.reportingManagerId ?? null;
        }
      }

      memberUpdates.reportingManagerId = newManagerId;
      tenantUpdates.push('reporting_manager_id');
    }

    // Update tenant_members if there are tenant-scoped updates
    if (tenantUpdates.length > 0) {
      await db
        .update(tenantMembers)
        .set(memberUpdates)
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            eq(tenantMembers.userId, user.id)
          )
        );
    }

    // Fetch updated tenant membership
    const membership = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, user.id)
      ),
    });

    if (membership) {
      jobTitle = membership.jobTitle;
      reportingManagerId = membership.reportingManagerId;
    }
  }

  // Audit log
  const allUpdates = [
    ...Object.keys(userUpdates).filter(k => k !== 'updatedAt'),
    ...tenantUpdates,
  ];
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'profile_updated',
    resourceType: 'user',
    resourceId: user.id,
    details: { updates: allUpdates, tenant_id: tenantId || null },
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
    // Tenant-scoped fields
    job_title: jobTitle,
    reporting_manager_id: reportingManagerId,
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
 *
 * If tenant context is provided (X-Zygo-Tenant-Slug header):
 * - Only searches within tenant members
 * - Returns tenant-scoped job_title
 */
app.get('/search', authMiddleware, optionalTenantMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('tenantId'); // May be undefined if no tenant context
  const query = c.req.query('q') || '';
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);

  const db = getDb();

  if (tenantId) {
    // Search within tenant members only
    const memberships = await db.query.tenantMembers.findMany({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.status, 'active')
      ),
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });

    // Filter by search query and exclude current user
    const filtered = memberships
      .filter((m) => {
        if (!m.user || m.user.id === user.id || m.user.status === 'deleted') return false;
        if (!query) return true;
        const lowerQuery = query.toLowerCase();
        return (
          m.user.firstName?.toLowerCase().includes(lowerQuery) ||
          m.user.lastName?.toLowerCase().includes(lowerQuery) ||
          m.user.email.toLowerCase().includes(lowerQuery)
        );
      })
      .slice(0, limit);

    return c.json({
      users: filtered.map((m) => ({
        id: m.user!.id,
        first_name: m.user!.firstName,
        last_name: m.user!.lastName,
        email: m.user!.email,
        has_avatar: !!m.user!.avatarUrl,
        job_title: m.jobTitle, // Tenant-scoped job title
      })),
    });
  }

  // Fallback: search all users (no tenant context)
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
      has_avatar: !!u.avatarUrl,
      job_title: null, // No tenant context, no job_title
    })),
  });
});

/**
 * GET /api/v1/users/me/activity
 * Get current user's activity log (paginated)
 * Returns: login, logout, password_change, mfa_enable, mfa_disable, profile_update, session_revoke
 */
app.get('/me/activity', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20')));
  const actionFilter = c.req.query('action'); // Optional filter by action type

  const db = getDb();
  const offset = (page - 1) * limit;

  // Allowed actions for activity log
  const allowedActions = [
    'login',
    'logout',
    'password_change',
    'password_changed',
    'mfa_enable',
    'mfa_enabled',
    'mfa_disable',
    'mfa_disabled',
    'profile_update',
    'profile_updated',
    'session_revoke',
    'session_revoked',
    'avatar_uploaded',
    'passkey_register',
    'passkey_remove',
    'device_trust',
    'suspicious_login',
  ];

  // Build filter conditions
  const conditions = [eq(auditLogs.userId, user.id)];

  // Filter by specific action if provided
  if (actionFilter && allowedActions.includes(actionFilter)) {
    // Map normalized actions to all variations
    const actionMap: Record<string, string[]> = {
      login: ['login'],
      logout: ['logout'],
      password_change: ['password_change', 'password_changed'],
      mfa_enable: ['mfa_enable', 'mfa_enabled'],
      mfa_disable: ['mfa_disable', 'mfa_disabled'],
      profile_update: ['profile_update', 'profile_updated', 'avatar_uploaded'],
      session_revoke: ['session_revoke', 'session_revoked'],
      passkey_register: ['passkey_register'],
      passkey_remove: ['passkey_remove'],
      device_trust: ['device_trust'],
      suspicious_login: ['suspicious_login'],
    };
    const actionsToFilter = actionMap[actionFilter] || [actionFilter];
    conditions.push(inArray(auditLogs.action, actionsToFilter));
  } else {
    // Default: show all allowed actions
    conditions.push(inArray(auditLogs.action, allowedActions));
  }

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(...conditions));
  const totalCount = countResult[0]?.count || 0;
  const totalPages = Math.ceil(totalCount / limit);

  // Get paginated activities
  const activities = await db.query.auditLogs.findMany({
    where: and(...conditions),
    orderBy: desc(auditLogs.createdAt),
    limit,
    offset,
  });

  // Transform to API response format
  const transformedActivities = activities.map((log) => {
    // Normalize action names for frontend
    let normalizedAction = log.action;
    if (log.action === 'password_changed') normalizedAction = 'password_change';
    if (log.action === 'mfa_enabled') normalizedAction = 'mfa_enable';
    if (log.action === 'mfa_disabled') normalizedAction = 'mfa_disable';
    if (log.action === 'profile_updated' || log.action === 'avatar_uploaded') normalizedAction = 'profile_update';
    if (log.action === 'session_revoked') normalizedAction = 'session_revoke';

    // Extract device info from details
    const details = (log.details || {}) as Record<string, any>;
    let device = undefined;
    if (details.browser || details.os || details.device_name) {
      device = {
        name: details.device_name,
        browser: details.browser,
        os: details.os,
      };
    }

    // Extract location from details
    let location = undefined;
    if (details.city || details.country) {
      location = {
        city: details.city,
        country: details.country,
      };
    }

    return {
      id: log.id,
      action: normalizedAction,
      timestamp: log.createdAt.toISOString(),
      ip_address: log.ipAddress,
      location,
      device,
      details: details,
      status: log.status as 'success' | 'failure',
    };
  });

  return c.json({
    activities: transformedActivities,
    page,
    limit,
    total_count: totalCount,
    total_pages: totalPages,
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
