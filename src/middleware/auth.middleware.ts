/**
 * Authentication Middleware
 *
 * Validates Supabase session and attaches user to context.
 * Supports both HTTPOnly cookies (preferred) and Authorization header (API clients).
 * Per UNIFIED_AUTH_STRATEGY.md.
 */

import { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users, type User } from '../db/schema';
import { getSession } from '../services/supabase.service';
import { getAccessToken } from '../utils/cookies';

// Extend Hono context with user
declare module 'hono' {
  interface ContextVariableMap {
    user: User;
    userId: string;
  }
}

/**
 * Auth middleware - validates Bearer token and attaches user to context
 * Reads token from HTTPOnly cookies first, falls back to Authorization header
 */
export async function authMiddleware(c: Context, next: Next) {
  // Get token from cookies (preferred) or Authorization header (API clients)
  const token = getAccessToken(c);

  if (!token) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'Missing access token',
      },
      401
    );
  }

  // Validate token with Supabase
  const sessionResult = await getSession(token);

  if (sessionResult.error || !sessionResult.user) {
    return c.json(
      {
        error: 'unauthorized',
        message: sessionResult.error || 'Invalid or expired token',
      },
      401
    );
  }

  // Get user from database
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, sessionResult.user.id),
  });

  if (!user) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'User not found',
      },
      401
    );
  }

  // Check if user is active
  if (user.status !== 'active') {
    return c.json(
      {
        error: 'forbidden',
        message: user.status === 'suspended'
          ? 'Your account has been suspended. Please contact support.'
          : 'Your account is not active.',
      },
      403
    );
  }

  // Check if user is blocked
  if (user.blockedUntil && new Date(user.blockedUntil) > new Date()) {
    return c.json(
      {
        error: 'forbidden',
        message: user.blockReason || 'Your account is temporarily blocked.',
        blocked_until: user.blockedUntil,
      },
      403
    );
  }

  // Attach user to context
  c.set('user', user);
  c.set('userId', user.id);

  await next();
}

/**
 * Optional auth middleware - attaches user if token present, but doesn't require it
 * Reads token from HTTPOnly cookies first, falls back to Authorization header
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  // Get token from cookies (preferred) or Authorization header (API clients)
  const token = getAccessToken(c);

  if (!token) {
    return next();
  }

  try {
    const sessionResult = await getSession(token);

    if (!sessionResult.error && sessionResult.user) {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.id, sessionResult.user.id),
      });

      if (user && user.status === 'active') {
        c.set('user', user);
        c.set('userId', user.id);
      }
    }
  } catch {
    // Silently ignore auth errors for optional auth
  }

  await next();
}

/**
 * Email verification required middleware
 * Use after authMiddleware to enforce email verification
 */
export async function requireEmailVerified(c: Context, next: Next) {
  const user = c.get('user');

  if (!user) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'Authentication required',
      },
      401
    );
  }

  if (!user.emailVerified) {
    return c.json(
      {
        error: 'email_not_verified',
        message: 'Please verify your email address',
        redirect_url: '/verify-email',
      },
      403
    );
  }

  await next();
}

export const authMiddlewareExports = {
  authMiddleware,
  optionalAuthMiddleware,
  requireEmailVerified,
};
