/**
 * Auth Token Service
 *
 * Generates and verifies opaque auth tokens for secure cross-domain authentication.
 * Tokens are stored in Redis with short TTL and are single-use.
 *
 * Security features:
 * - Cryptographically random tokens (not guessable)
 * - Short TTL (2 minutes)
 * - Single-use (deleted after verification)
 * - Server-side validation required
 */

import { randomBytes } from 'crypto';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';

/**
 * Auth token payload stored in Redis
 */
export interface AuthTokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  emailVerifiedVia?: string | null;
  // RBAC data
  roleId: string;
  roleName: string;
  roleSlug: string;
  isOwner: boolean;
  createdAt: number;
}

/**
 * Generate a cryptographically secure random token
 */
function generateSecureToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Create and store an auth token
 *
 * @param payload - User and tenant information to store
 * @returns The opaque token string
 */
export async function createAuthToken(payload: Omit<AuthTokenPayload, 'createdAt'>): Promise<string> {
  const redis = getRedis();
  const token = generateSecureToken();
  const key = `${REDIS_KEYS.AUTH_TOKEN}${token}`;

  const data: AuthTokenPayload = {
    ...payload,
    createdAt: Date.now(),
  };

  await redis.setex(key, REDIS_TTL.AUTH_TOKEN, JSON.stringify(data));

  return token;
}

/**
 * Verify and consume an auth token (single-use)
 *
 * @param token - The opaque token to verify
 * @returns The payload if valid, null if invalid or expired
 */
export async function verifyAuthToken(token: string): Promise<AuthTokenPayload | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const redis = getRedis();
  const key = `${REDIS_KEYS.AUTH_TOKEN}${token}`;

  // Get and delete atomically using a transaction
  const multi = redis.multi();
  multi.get(key);
  multi.del(key);

  const results = await multi.exec();

  if (!results || !results[0] || !results[0][1]) {
    return null;
  }

  const data = results[0][1] as string;

  try {
    const payload = JSON.parse(data) as AuthTokenPayload;

    // Double-check expiration (Redis TTL should handle this, but be safe)
    const age = Date.now() - payload.createdAt;
    if (age > REDIS_TTL.AUTH_TOKEN * 1000) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Invalidate an auth token (for logout or security events)
 *
 * @param token - The token to invalidate
 */
export async function invalidateAuthToken(token: string): Promise<void> {
  if (!token) return;

  const redis = getRedis();
  const key = `${REDIS_KEYS.AUTH_TOKEN}${token}`;
  await redis.del(key);
}

/**
 * Check if a token exists without consuming it (for debugging only)
 * DO NOT use this in production auth flows
 */
export async function tokenExists(token: string): Promise<boolean> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.AUTH_TOKEN}${token}`;
  const exists = await redis.exists(key);
  return exists === 1;
}

export const authTokenService = {
  createAuthToken,
  verifyAuthToken,
  invalidateAuthToken,
  tokenExists,
};
