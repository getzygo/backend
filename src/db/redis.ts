/**
 * Redis Client
 *
 * Redis connection for caching, sessions, and OAuth pending signups.
 */

import Redis from 'ioredis';
import { getEnv } from '../config/env';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (redis) return redis;

  const env = getEnv();

  redis = new Redis(env.REDIS_URL, {
    password: env.REDIS_PASSWORD || undefined,
    tls: env.REDIS_TLS ? {} : undefined,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) {
        return null; // Stop retrying
      }
      return Math.min(times * 100, 3000);
    },
    lazyConnect: true,
  });

  redis.on('error', (err) => {
    console.error('Redis connection error:', err);
  });

  redis.on('connect', () => {
    console.log('Redis connected');
  });

  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/**
 * Redis key prefixes for different data types
 */
export const REDIS_KEYS = {
  /** Pending OAuth signup: oauth:pending:{token} */
  OAUTH_PENDING: 'oauth:pending:',

  /** User session: session:{sessionId} */
  SESSION: 'session:',

  /** Rate limit: ratelimit:{identifier}:{endpoint} */
  RATE_LIMIT: 'ratelimit:',

  /** Cache: cache:{key} */
  CACHE: 'cache:',

  /** Password reset token: pwreset:{token} */
  PASSWORD_RESET: 'pwreset:',

  /** Email verification code: email_code:{email} */
  EMAIL_CODE: 'email_code:',

  /** Email verification token: emailverify:{token} */
  EMAIL_VERIFY: 'emailverify:',

  /** Phone verification code: phone_code:{phone} */
  PHONE_CODE: 'phone_code:',

  /** MFA secret (temporary during setup): mfa_setup:{userId} */
  MFA_SETUP: 'mfa_setup:',

  /** RBAC permission cache: rbac:{userId}:{tenantId} */
  RBAC: 'rbac:',

  /** Tenant config cache: tenant_config:{tenantId} */
  TENANT_CONFIG: 'tenant_config:',
} as const;

/**
 * TTL values in seconds
 */
export const REDIS_TTL = {
  /** OAuth pending signup: 30 minutes */
  OAUTH_PENDING: 30 * 60,

  /** User session: 7 days */
  SESSION: 7 * 24 * 60 * 60,

  /** Password reset: 1 hour */
  PASSWORD_RESET: 60 * 60,

  /** Email verification: 24 hours */
  EMAIL_VERIFY: 24 * 60 * 60,

  /** Email verification code: 15 minutes */
  EMAIL_CODE: 15 * 60,

  /** Phone verification code: 10 minutes */
  PHONE_CODE: 10 * 60,

  /** MFA setup (temporary secret): 10 minutes */
  MFA_SETUP: 10 * 60,

  /** RBAC permission cache: 5 minutes */
  RBAC: 5 * 60,

  /** Tenant config cache: 5 minutes */
  TENANT_CONFIG: 5 * 60,

  /** Rate limit window: 15 minutes */
  RATE_LIMIT: 15 * 60,

  /** Cache default: 1 hour */
  CACHE_DEFAULT: 60 * 60,
} as const;
