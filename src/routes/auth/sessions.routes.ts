/**
 * Session Management Routes
 *
 * GET /api/v1/auth/sessions - List active sessions
 * POST /api/v1/auth/sessions/:id/revoke - Revoke specific session
 * POST /api/v1/auth/sessions/revoke-all - Revoke all except current
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  getUserSessions,
  revokeSession,
  revokeAllSessions,
} from '../../services/session.service';
import { notify } from '../../services/notification-hub.service';
import { NOTIFICATION_CONFIGS, EMAIL_TEMPLATES } from '../../services/notification-configs';
import { parseUserAgent } from '../../services/device-fingerprint.service';
import { getDb } from '../../db/client';
import { tenantMembers } from '../../db/schema';
import { eq, and } from 'drizzle-orm';

const app = new Hono();

/**
 * GET /api/v1/auth/sessions
 * List all active sessions for the current user.
 */
app.get('/', authMiddleware, async (c) => {
  const user = c.get('user');

  // Get refresh token from Authorization header or cookie to identify current session
  // In practice, we'd extract this from the request context
  const refreshToken = c.req.header('X-Refresh-Token'); // Optional header for identifying current session

  const sessions = await getUserSessions(user.id, refreshToken);

  return c.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      device_name: session.deviceName,
      browser: session.browser,
      os: session.os,
      ip_address: session.ipAddress,
      location: {
        city: session.locationCity,
        country: session.locationCountry,
      },
      is_current: session.isCurrent,
      last_active_at: session.lastActiveAt?.toISOString(),
      created_at: session.createdAt.toISOString(),
    })),
  });
});

/**
 * POST /api/v1/auth/sessions/:id/revoke
 * Revoke a specific session.
 * Note: The revoked session's JWT will remain valid until it expires (typically 1 hour).
 * For immediate invalidation of all sessions, use revoke-all.
 */
app.post('/:id/revoke', authMiddleware, async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const revokedSession = await revokeSession(sessionId, user.id, ipAddress, userAgent);

  if (!revokedSession) {
    return c.json(
      {
        error: 'session_not_found',
        message: 'Session not found or already revoked',
      },
      404
    );
  }

  // Send session revoked notification (email + in-app)
  const currentDevice = parseUserAgent(userAgent);
  const location = [revokedSession.locationCity, revokedSession.locationCountry]
    .filter(Boolean)
    .join(', ');

  // Get user's primary tenant for in-app notification
  const db = getDb();
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, user.id),
      eq(tenantMembers.status, 'active')
    ),
    columns: { tenantId: true },
  });

  // Fire and forget - don't block the response
  const config = NOTIFICATION_CONFIGS.session_revoked;
  const messageFunc = config.message as (details?: Record<string, unknown>) => string;
  notify({
    userId: user.id,
    tenantId: membership?.tenantId,
    category: config.category,
    type: config.type,
    title: config.title,
    message: messageFunc({ device: revokedSession.deviceName }),
    severity: config.severity,
    actionRoute: config.actionRoute,
    actionLabel: config.actionLabel,
    emailTemplate: EMAIL_TEMPLATES.sessionRevoked({
      firstName: user.firstName ?? undefined,
      revokedDevice: revokedSession.deviceName ?? undefined,
      revokedBrowser: revokedSession.browser ?? undefined,
      revokedLocation: location || undefined,
      revokedBy: 'user',
      revokerDevice: currentDevice.deviceName,
    }),
    emailSubject: config.emailSubject,
    metadata: { revokedSessionId: sessionId },
  }).catch((err) => console.error('[Session] Notification failed:', err));

  // Don't call signOutUser here - that would log out ALL sessions including the current one.
  // The revoked session's JWT will expire naturally (typically 1 hour).
  // This is the expected behavior for revoking a single session.

  return c.json({
    success: true,
    message: 'Session revoked successfully.',
  });
});

/**
 * POST /api/v1/auth/sessions/revoke-all
 * Revoke all sessions except the current one.
 * Note: Revoked sessions' JWTs will remain valid until they expire (typically 1 hour).
 */
app.post('/revoke-all', authMiddleware, async (c) => {
  const user = c.get('user');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  // Get current refresh token to exclude from revocation
  const currentRefreshToken = c.req.header('X-Refresh-Token');

  const revokedCount = await revokeAllSessions(
    user.id,
    currentRefreshToken,
    ipAddress,
    userAgent
  );

  // Don't call signOutUser here - that would log out the current session too.
  // Revoked sessions' JWTs will expire naturally (typically 1 hour).

  return c.json({
    success: true,
    message: `${revokedCount} session${revokedCount !== 1 ? 's' : ''} revoked.`,
    revoked_count: revokedCount,
  });
});

export default app;
