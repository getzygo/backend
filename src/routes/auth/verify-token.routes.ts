/**
 * Token Verification Routes
 *
 * POST /api/v1/auth/verify-token - Verify and consume an auth token
 *
 * This endpoint is used by tenant apps to verify auth tokens received
 * during cross-domain redirects. Tokens are single-use and short-lived.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { verifyAuthToken } from '../../services/auth-token.service';
import { getTenantById } from '../../services/tenant.service';
import { resolvePermissions } from '../../services/permission.service';
import { getDb } from '../../db/client';
import { auditLogs } from '../../db/schema';

const app = new Hono();

// Verify token request schema
const verifyTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

/**
 * POST /api/v1/auth/verify-token
 * Verify and consume an auth token
 *
 * This endpoint:
 * 1. Validates the token exists in Redis
 * 2. Returns the user/tenant info
 * 3. Deletes the token (single-use)
 *
 * Security:
 * - No authentication required (token IS the authentication)
 * - Token can only be used once
 * - Token expires after 2 minutes
 */
app.post('/', zValidator('json', verifyTokenSchema), async (c) => {
  const { token } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  // Verify and consume the token
  const payload = await verifyAuthToken(token);

  if (!payload) {
    return c.json(
      {
        error: 'invalid_token',
        message: 'Token is invalid, expired, or already used',
      },
      401
    );
  }

  // Get tenant details
  const tenant = await getTenantById(payload.tenantId);

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_not_found',
        message: 'Tenant not found',
      },
      404
    );
  }

  // Check tenant status
  if (tenant.status !== 'active') {
    return c.json(
      {
        error: 'tenant_inactive',
        message: tenant.status === 'suspended'
          ? 'This workspace has been suspended. Please contact support.'
          : 'This workspace is not active.',
      },
      403
    );
  }

  const db = getDb();

  // Resolve user's permissions for this tenant
  const permissions = await resolvePermissions(payload.userId, payload.tenantId);

  // Audit log
  await db.insert(auditLogs).values({
    userId: payload.userId,
    action: 'token_verified',
    resourceType: 'auth_token',
    resourceId: payload.tenantId,
    details: {
      tenant_slug: tenant.slug,
      role_slug: payload.roleSlug,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Return verified user, tenant, role, and permissions
  return c.json({
    verified: true,
    user: {
      id: payload.userId,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      avatarUrl: payload.avatarUrl,
      emailVerified: payload.emailVerified,
      emailVerifiedVia: payload.emailVerifiedVia,
    },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      type: tenant.type,
      plan: tenant.plan,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
    },
    role: {
      id: payload.roleId,
      name: payload.roleName,
      slug: payload.roleSlug,
      isOwner: payload.isOwner,
    },
    permissions,
  });
});

export default app;
