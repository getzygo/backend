/**
 * Admin Panel Authentication Routes
 *
 * Phase 5: Enterprise - Admin Panel Auth
 *
 * POST /api/v1/admin/auth/signin - Admin signin (email + MFA required)
 * POST /api/v1/admin/auth/mfa/verify - Verify MFA code
 * POST /api/v1/admin/auth/signout - Admin signout
 * GET /api/v1/admin/auth/session - Get current admin session
 *
 * Per UNIFIED_AUTH_STRATEGY.md Section 14.
 * - Email/Password ONLY (no OAuth)
 * - MFA is MANDATORY
 * - Session: 4 hours
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getUserByEmail, verifyPassword } from '../../services/user.service';
import { mfaService } from '../../services/mfa.service';
import { getDb } from '../../db/client';
import { getRedis, REDIS_KEYS } from '../../db/redis';
import { users, auditLogs } from '../../db/schema';
import crypto from 'crypto';

const app = new Hono();

// Admin session TTL: 4 hours
const ADMIN_SESSION_TTL = 4 * 60 * 60; // seconds

// Admin role IDs (should be loaded from config or database)
// For now, we check if user has global admin flag in metadata
const ADMIN_METADATA_KEY = 'is_global_admin';

interface AdminSession {
  userId: string;
  email: string;
  mfaVerified: boolean;
  mfaVerifiedAt: number | null;
  createdAt: number;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Generate a secure session token
 */
function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Store admin session in Redis
 */
async function storeAdminSession(token: string, session: AdminSession): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.SESSION}admin:${token}`;
  await redis.setex(key, ADMIN_SESSION_TTL, JSON.stringify(session));
}

/**
 * Get admin session from Redis
 */
async function getAdminSession(token: string): Promise<AdminSession | null> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.SESSION}admin:${token}`;
  const data = await redis.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as AdminSession;
  } catch {
    return null;
  }
}

/**
 * Update admin session in Redis
 */
async function updateAdminSession(token: string, session: AdminSession): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.SESSION}admin:${token}`;
  const ttl = await redis.ttl(key);
  if (ttl > 0) {
    await redis.setex(key, ttl, JSON.stringify(session));
  }
}

/**
 * Delete admin session from Redis
 */
async function deleteAdminSession(token: string): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.SESSION}admin:${token}`;
  await redis.del(key);
}

/**
 * Check if user is a global admin
 */
function isGlobalAdmin(user: { metadata: unknown }): boolean {
  if (!user.metadata || typeof user.metadata !== 'object') {
    return false;
  }
  return (user.metadata as Record<string, unknown>)[ADMIN_METADATA_KEY] === true;
}

// Signin schema
const signinSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * POST /api/v1/admin/auth/signin
 * Admin signin - requires email/password, returns MFA challenge
 */
app.post('/signin', zValidator('json', signinSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();

  // Get user
  const user = await getUserByEmail(email);

  if (!user) {
    return c.json(
      {
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      },
      401
    );
  }

  // Check if user is a global admin
  if (!isGlobalAdmin(user)) {
    // Audit log failed admin access attempt
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'admin_signin_denied',
      resourceType: 'admin_panel',
      resourceId: 'global',
      details: { reason: 'not_admin' },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'failure',
    });

    return c.json(
      {
        error: 'access_denied',
        message: 'You do not have admin access.',
      },
      403
    );
  }

  // Check account status
  if (user.status !== 'active') {
    return c.json(
      {
        error: 'account_inactive',
        message: 'Your account is not active.',
      },
      403
    );
  }

  // Verify password
  const passwordValid = await verifyPassword(password, user.passwordHash);

  if (!passwordValid) {
    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'admin_signin_failed',
      resourceType: 'admin_panel',
      resourceId: 'global',
      details: { reason: 'invalid_password' },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'failure',
    });

    return c.json(
      {
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      },
      401
    );
  }

  // MFA is MANDATORY for admin panel
  if (!user.mfaEnabled) {
    return c.json(
      {
        error: 'mfa_required',
        message: 'MFA must be enabled to access admin panel. Please enable MFA first.',
        mfa_setup_required: true,
      },
      403
    );
  }

  // Create admin session (MFA not yet verified)
  const sessionToken = generateSessionToken();
  const session: AdminSession = {
    userId: user.id,
    email: user.email,
    mfaVerified: false,
    mfaVerifiedAt: null,
    createdAt: Date.now(),
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
  };

  await storeAdminSession(sessionToken, session);

  // Return MFA challenge
  return c.json({
    admin_session_token: sessionToken,
    require_mfa: true,
    message: 'Please enter your MFA code to continue.',
  });
});

// MFA verify schema
const mfaVerifySchema = z.object({
  admin_session_token: z.string().min(1, 'Session token required'),
  mfa_code: z.string().length(6, 'MFA code must be 6 digits'),
});

/**
 * POST /api/v1/admin/auth/mfa/verify
 * Verify MFA code and complete admin signin
 */
app.post('/mfa/verify', zValidator('json', mfaVerifySchema), async (c) => {
  const { admin_session_token, mfa_code } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();

  // Get admin session
  const session = await getAdminSession(admin_session_token);

  if (!session) {
    return c.json(
      {
        error: 'session_expired',
        message: 'Admin session expired. Please sign in again.',
      },
      401
    );
  }

  // Verify MFA code
  const mfaResult = await mfaService.verifyMfaCode(session.userId, mfa_code);

  if (!mfaResult.verified) {
    // Audit log
    await db.insert(auditLogs).values({
      userId: session.userId,
      action: 'admin_mfa_failed',
      resourceType: 'admin_panel',
      resourceId: 'global',
      details: { error: mfaResult.error },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'failure',
    });

    return c.json(
      {
        error: 'mfa_invalid',
        message: mfaResult.error || 'Invalid MFA code',
      },
      401
    );
  }

  // Update session with MFA verified
  session.mfaVerified = true;
  session.mfaVerifiedAt = Date.now();
  await updateAdminSession(admin_session_token, session);

  // Update user last login
  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress || undefined,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.userId));

  // Audit log
  await db.insert(auditLogs).values({
    userId: session.userId,
    action: 'admin_signin_success',
    resourceType: 'admin_panel',
    resourceId: 'global',
    details: {},
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Get user for response
  const user = await getUserByEmail(session.email);

  return c.json({
    success: true,
    admin_session_token,
    user: user
      ? {
          id: user.id,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
        }
      : null,
    expires_in: ADMIN_SESSION_TTL,
  });
});

/**
 * POST /api/v1/admin/auth/signout
 * Sign out from admin panel
 */
app.post('/signout', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: true });
  }

  const token = authHeader.slice(7);

  // Get session for audit log
  const session = await getAdminSession(token);

  if (session) {
    const db = getDb();
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    // Audit log
    await db.insert(auditLogs).values({
      userId: session.userId,
      action: 'admin_signout',
      resourceType: 'admin_panel',
      resourceId: 'global',
      details: {},
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });
  }

  // Delete the session
  await deleteAdminSession(token);

  return c.json({ success: true });
});

/**
 * GET /api/v1/admin/auth/session
 * Get current admin session info
 */
app.get('/session', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'No admin session token provided',
      },
      401
    );
  }

  const token = authHeader.slice(7);
  const session = await getAdminSession(token);

  if (!session) {
    return c.json(
      {
        error: 'session_expired',
        message: 'Admin session expired. Please sign in again.',
      },
      401
    );
  }

  if (!session.mfaVerified) {
    return c.json(
      {
        error: 'mfa_required',
        message: 'MFA verification required',
        mfa_pending: true,
      },
      403
    );
  }

  // Get user
  const user = await getUserByEmail(session.email);

  if (!user || !isGlobalAdmin(user)) {
    await deleteAdminSession(token);
    return c.json(
      {
        error: 'access_revoked',
        message: 'Admin access has been revoked',
      },
      403
    );
  }

  // Calculate remaining TTL
  const redis = getRedis();
  const key = `${REDIS_KEYS.SESSION}admin:${token}`;
  const ttl = await redis.ttl(key);

  return c.json({
    valid: true,
    user: {
      id: user.id,
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
    },
    session: {
      created_at: new Date(session.createdAt).toISOString(),
      mfa_verified_at: session.mfaVerifiedAt
        ? new Date(session.mfaVerifiedAt).toISOString()
        : null,
      expires_in: ttl > 0 ? ttl : 0,
    },
  });
});

export default app;
