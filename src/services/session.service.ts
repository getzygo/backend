/**
 * Session Management Service
 *
 * Handles user session tracking, revocation, and management.
 */

import crypto from 'crypto';
import { eq, and, isNull, desc, lt, or, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { userSessions, auditLogs } from '../db/schema';
import type { UserSession, NewUserSession } from '../db/schema/security';

// Session expiration time (7 days by default)
const SESSION_EXPIRY_DAYS = 7;

interface CreateSessionOptions {
  userId: string;
  tenantId?: string;
  refreshToken: string;
  deviceName?: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  locationCity?: string;
  locationCountry?: string;
}

interface SessionInfo {
  id: string;
  deviceName?: string | null;
  browser?: string | null;
  os?: string | null;
  ipAddress?: string | null;
  locationCity?: string | null;
  locationCountry?: string | null;
  isCurrent: boolean;
  lastActiveAt?: Date | null;
  createdAt: Date;
}

/**
 * Hash a token for secure storage.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new session for a user.
 */
export async function createSession(options: CreateSessionOptions): Promise<UserSession> {
  const db = getDb();
  const tokenHash = hashToken(options.refreshToken);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  const [session] = await db
    .insert(userSessions)
    .values({
      userId: options.userId,
      tenantId: options.tenantId || null,
      tokenHash,
      deviceName: options.deviceName,
      browser: options.browser,
      os: options.os,
      ipAddress: options.ipAddress,
      locationCity: options.locationCity,
      locationCountry: options.locationCountry,
      isCurrent: false,
      lastActiveAt: new Date(),
      expiresAt,
    })
    .returning();

  return session;
}

/**
 * Update session's last active time and optionally mark as current.
 */
export async function updateSessionActivity(
  refreshToken: string,
  markAsCurrent: boolean = false
): Promise<void> {
  const db = getDb();
  const tokenHash = hashToken(refreshToken);

  await db
    .update(userSessions)
    .set({
      lastActiveAt: new Date(),
      isCurrent: markAsCurrent,
    })
    .where(
      and(eq(userSessions.tokenHash, tokenHash), isNull(userSessions.revokedAt))
    );
}

/**
 * Find session by refresh token.
 */
export async function findSessionByToken(refreshToken: string): Promise<UserSession | null> {
  const db = getDb();
  const tokenHash = hashToken(refreshToken);

  const session = await db.query.userSessions.findFirst({
    where: and(
      eq(userSessions.tokenHash, tokenHash),
      isNull(userSessions.revokedAt)
    ),
  });

  return session || null;
}

/**
 * Get all active sessions for a user, scoped to a specific tenant.
 * Also includes legacy sessions (tenantId = null) so they remain visible
 * until they expire naturally. New sessions are always created with tenantId.
 */
export async function getUserSessions(
  userId: string,
  tenantId: string,
  currentRefreshToken?: string
): Promise<SessionInfo[]> {
  const db = getDb();
  const currentTokenHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;

  const sessions = await db.query.userSessions.findMany({
    where: and(
      eq(userSessions.userId, userId),
      or(
        eq(userSessions.tenantId, tenantId),
        isNull(userSessions.tenantId) // Include legacy sessions
      ),
      isNull(userSessions.revokedAt)
    ),
    orderBy: desc(userSessions.lastActiveAt),
  });

  // If no current token provided, mark the most recent session as current
  const mostRecentId = sessions.length > 0 ? sessions[0].id : null;

  return sessions.map((session) => ({
    id: session.id,
    deviceName: session.deviceName,
    browser: session.browser,
    os: session.os,
    ipAddress: session.ipAddress,
    locationCity: session.locationCity,
    locationCountry: session.locationCountry,
    isCurrent: currentTokenHash
      ? session.tokenHash === currentTokenHash
      : session.id === mostRecentId, // Fall back to most recent session
    lastActiveAt: session.lastActiveAt,
    createdAt: session.createdAt,
  }));
}

/**
 * Revoke a specific session, scoped to a specific tenant.
 * Returns the revoked session details for email notification, or null if not found.
 */
export async function revokeSession(
  sessionId: string,
  userId: string,
  tenantId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ deviceName?: string | null; browser?: string | null; os?: string | null; locationCity?: string | null; locationCountry?: string | null } | null> {
  const db = getDb();

  // Verify the session belongs to the user AND tenant (or is a legacy null-tenant session)
  const session = await db.query.userSessions.findFirst({
    where: and(
      eq(userSessions.id, sessionId),
      eq(userSessions.userId, userId),
      or(
        eq(userSessions.tenantId, tenantId),
        isNull(userSessions.tenantId)
      ),
      isNull(userSessions.revokedAt)
    ),
  });

  if (!session) {
    return null;
  }

  // Revoke the session
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.id, sessionId));

  // Audit log
  await db.insert(auditLogs).values({
    userId,
    tenantId,
    action: 'session_revoked',
    resourceType: 'session',
    resourceId: sessionId,
    details: {
      device_name: session.deviceName,
      browser: session.browser,
      os: session.os,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Return session details for email notification
  return {
    deviceName: session.deviceName,
    browser: session.browser,
    os: session.os,
    locationCity: session.locationCity,
    locationCountry: session.locationCountry,
  };
}

/**
 * Revoke all sessions for a user in a specific tenant, except the current one.
 */
export async function revokeAllSessions(
  userId: string,
  tenantId: string,
  currentRefreshToken?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<number> {
  const db = getDb();
  const currentTokenHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;

  // Get sessions to revoke, scoped to this tenant (excluding current if provided)
  const sessionsToRevoke = await db.query.userSessions.findMany({
    where: and(
      eq(userSessions.userId, userId),
      eq(userSessions.tenantId, tenantId),
      isNull(userSessions.revokedAt)
    ),
  });

  const filteredSessions = currentTokenHash
    ? sessionsToRevoke.filter((s) => s.tokenHash !== currentTokenHash)
    : sessionsToRevoke;

  if (filteredSessions.length === 0) {
    return 0;
  }

  // Revoke all filtered sessions by ID
  for (const session of filteredSessions) {
    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.id, session.id));
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId,
    tenantId,
    action: 'sessions_revoked_all',
    resourceType: 'session',
    details: { count: filteredSessions.length, excluded_current: !!currentTokenHash },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return filteredSessions.length;
}

/**
 * Clean up expired sessions (for scheduled cleanup).
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = getDb();
  const now = new Date();

  const result = await db
    .update(userSessions)
    .set({ revokedAt: now })
    .where(
      and(lt(userSessions.expiresAt, now), isNull(userSessions.revokedAt))
    );

  return 0; // Drizzle doesn't return affected rows count easily
}

/**
 * Invalidate session by token hash (for token rotation).
 */
export async function invalidateSessionByTokenHash(tokenHash: string): Promise<void> {
  const db = getDb();

  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.tokenHash, tokenHash));
}

export default {
  createSession,
  updateSessionActivity,
  findSessionByToken,
  getUserSessions,
  revokeSession,
  revokeAllSessions,
  cleanupExpiredSessions,
  invalidateSessionByTokenHash,
};
