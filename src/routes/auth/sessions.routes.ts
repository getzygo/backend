/**
 * Session Management Routes
 *
 * GET /api/v1/auth/sessions - List active sessions (tenant-scoped)
 * POST /api/v1/auth/sessions/:id/revoke - Revoke specific session (tenant-scoped)
 * POST /api/v1/auth/sessions/revoke-all - Revoke all except current (tenant-scoped)
 *
 * TENANT ISOLATION: All session operations are scoped to the current tenant.
 * A user's sessions in Tenant A are completely isolated from Tenant B.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import {
  getUserSessions,
  revokeSession,
  revokeAllSessions,
} from '../../services/session.service';
import { notify } from '../../services/notification-hub.service';
import { NOTIFICATION_CONFIGS, EMAIL_TEMPLATES } from '../../services/notification-configs';
import { parseUserAgent } from '../../services/device-fingerprint.service';

const app = new Hono();

/**
 * GET /api/v1/auth/sessions
 * List all active sessions for the current user in the current tenant.
 */
app.get('/', authMiddleware, tenantMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('tenantId');

  // Get refresh token from header to identify current session
  const refreshToken = c.req.header('X-Refresh-Token');

  const sessions = await getUserSessions(user.id, tenantId, refreshToken);

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
 * Revoke a specific session within the current tenant.
 */
app.post('/:id/revoke', authMiddleware, tenantMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const sessionId = c.req.param('id');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const revokedSession = await revokeSession(sessionId, user.id, tenantId, ipAddress, userAgent);

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

  // Fire and forget - don't block the response
  const config = NOTIFICATION_CONFIGS.session_revoked;
  const messageFunc = config.message as (details?: Record<string, unknown>) => string;
  notify({
    userId: user.id,
    tenantId,
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

  return c.json({
    success: true,
    message: 'Session revoked successfully.',
  });
});

/**
 * POST /api/v1/auth/sessions/revoke-all
 * Revoke all sessions except the current one, within the current tenant only.
 */
app.post('/revoke-all', authMiddleware, tenantMiddleware, async (c) => {
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  // Get current refresh token to exclude from revocation
  const currentRefreshToken = c.req.header('X-Refresh-Token');

  const revokedCount = await revokeAllSessions(
    user.id,
    tenantId,
    currentRefreshToken,
    ipAddress,
    userAgent
  );

  return c.json({
    success: true,
    message: `${revokedCount} session${revokedCount !== 1 ? 's' : ''} revoked.`,
    revoked_count: revokedCount,
  });
});

export default app;
