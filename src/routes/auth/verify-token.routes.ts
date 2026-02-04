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
import { setAuthCookies, getRefreshToken, clearAuthCookies } from '../../utils/cookies';
import { refreshSession } from '../../services/supabase.service';

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

  // Set HTTPOnly cookies for secure token storage (if we have Supabase tokens)
  if (payload.supabaseAccessToken && payload.supabaseRefreshToken) {
    setAuthCookies(
      c,
      payload.supabaseAccessToken,
      payload.supabaseRefreshToken,
      3600, // 1 hour for access token
      604800 // 7 days for refresh token
    );
  }

  // Calculate session expiration from JWT if available
  let sessionExpiresAt: number | null = null;
  if (payload.supabaseAccessToken) {
    try {
      // Decode JWT to get expiration (without verification - we already verified it)
      const [, payloadPart] = payload.supabaseAccessToken.split('.');
      const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
      if (decoded.exp) {
        sessionExpiresAt = decoded.exp; // Unix timestamp in seconds
      }
    } catch {
      // If JWT decode fails, estimate 1 hour from now (default Supabase TTL)
      sessionExpiresAt = Math.floor(Date.now() / 1000) + 3600;
    }
  }

  // Return verified user, tenant, role, permissions, session, and tenant memberships
  // Note: avatarUrl is not exposed - frontend fetches via /users/me/avatar/file
  return c.json({
    verified: true,
    user: {
      id: payload.userId,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      hasAvatar: !!payload.avatarUrl,
      avatarSource: payload.avatarSource || null,
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
    // Supabase session tokens for authenticated API calls
    // Note: Tokens are also stored in HTTPOnly cookies for security
    session: payload.supabaseAccessToken ? {
      access_token: payload.supabaseAccessToken,
      refresh_token: payload.supabaseRefreshToken || null,
      expires_at: sessionExpiresAt, // Unix timestamp for frontend to track expiration
    } : null,
    // Cached tenant memberships for tenant switcher UI (no API calls needed)
    tenantMemberships: payload.tenantMemberships || [],
  });
});

/**
 * POST /api/v1/auth/refresh
 * Refresh access token using refresh token from HTTPOnly cookie
 *
 * This endpoint:
 * 1. Reads refresh token from HTTPOnly cookie
 * 2. Exchanges it for new tokens with Supabase
 * 3. Sets new HTTPOnly cookies
 * 4. Returns new access token (for hybrid mode support)
 */
app.post('/refresh', async (c) => {
  // Get refresh token from HTTPOnly cookie
  const refreshToken = getRefreshToken(c);

  if (!refreshToken) {
    return c.json(
      {
        error: 'no_refresh_token',
        message: 'No refresh token found. Please sign in again.',
      },
      401
    );
  }

  // Refresh session with Supabase
  const result = await refreshSession(refreshToken);

  if (result.error || !result.session) {
    // Clear invalid cookies
    clearAuthCookies(c);

    return c.json(
      {
        error: 'refresh_failed',
        message: result.error || 'Failed to refresh session. Please sign in again.',
      },
      401
    );
  }

  // Set new HTTPOnly cookies
  setAuthCookies(
    c,
    result.session.access_token,
    result.session.refresh_token,
    3600, // 1 hour for access token
    604800 // 7 days for refresh token
  );

  return c.json({
    success: true,
    // Return new access token for hybrid mode (localStorage + cookies)
    // Frontend can use this to update in-memory token
    access_token: result.session.access_token,
    expires_at: result.session.expires_at,
  });
});

/**
 * GET /api/v1/auth/check
 * Check if user is authenticated via HTTPOnly cookie
 *
 * This endpoint allows the frontend to check auth status without
 * exposing tokens to JavaScript. Returns user info and session expiration
 * so the frontend can show a lock screen when session is about to expire.
 */
app.get('/check', async (c) => {
  const { getAccessToken } = await import('../../utils/cookies');
  const { getSession } = await import('../../services/supabase.service');

  const token = getAccessToken(c);

  if (!token) {
    return c.json({
      authenticated: false,
      reason: 'no_token',
    });
  }

  // Validate token with Supabase
  const sessionResult = await getSession(token);

  if (sessionResult.error || !sessionResult.user) {
    // Check if it's an expiration error
    const errorMsg = sessionResult.error?.toLowerCase() || '';
    const isExpired = errorMsg.includes('expired') ||
                      errorMsg.includes('jwt expired') ||
                      errorMsg.includes('"exp" claim');

    return c.json({
      authenticated: false,
      reason: isExpired ? 'session_expired' : 'invalid_token',
      message: isExpired ? 'Your session has expired. Please sign in again.' : undefined,
    });
  }

  // Decode JWT to get expiration time
  let sessionExpiresAt: number | null = null;
  try {
    const [, payloadPart] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
    if (decoded.exp) {
      sessionExpiresAt = decoded.exp; // Unix timestamp in seconds
    }
  } catch {
    // Ignore decode errors
  }

  return c.json({
    authenticated: true,
    user: {
      id: sessionResult.user.id,
      email: sessionResult.user.email,
    },
    session: {
      expires_at: sessionExpiresAt, // Unix timestamp for frontend to track
    },
  });
});

export default app;
