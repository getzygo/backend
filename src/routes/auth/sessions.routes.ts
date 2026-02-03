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
 */
app.post('/:id/revoke', authMiddleware, async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const success = await revokeSession(sessionId, user.id, ipAddress, userAgent);

  if (!success) {
    return c.json(
      {
        error: 'session_not_found',
        message: 'Session not found or already revoked',
      },
      404
    );
  }

  return c.json({
    success: true,
    message: 'Session revoked successfully',
  });
});

/**
 * POST /api/v1/auth/sessions/revoke-all
 * Revoke all sessions except the current one.
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

  return c.json({
    success: true,
    message: `${revokedCount} session${revokedCount !== 1 ? 's' : ''} revoked`,
    revoked_count: revokedCount,
  });
});

export default app;
