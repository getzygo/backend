/**
 * Rate Limit Middleware
 *
 * Redis-based rate limiting for API endpoints.
 * Uses sliding window algorithm for accurate rate limiting.
 */

import { Context, Next, MiddlewareHandler } from 'hono';
import { getRedis, REDIS_KEYS } from '../db/redis';

// ============================================================================
// Types
// ============================================================================

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  max: number;
  /** Window size in seconds */
  windowSeconds: number;
  /** Custom key generator (default: user ID or IP) */
  keyGenerator?: (c: Context) => string;
  /** Custom error message */
  message?: string;
  /** Skip rate limiting for certain conditions */
  skip?: (c: Context) => boolean;
}

export interface RateLimitInfo {
  /** Total requests allowed in window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** Unix timestamp when the window resets */
  reset: number;
}

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Rate limit presets for common use cases
 */
export const RATE_LIMITS = {
  /** Standard API endpoint: 60 requests per minute */
  STANDARD: {
    max: 60,
    windowSeconds: 60,
  },

  /** Polling endpoint: 60 requests per minute */
  POLLING: {
    max: 60,
    windowSeconds: 60,
  },

  /** Bulk operations: 10 requests per minute */
  BULK: {
    max: 10,
    windowSeconds: 60,
  },

  /** Write operations: 30 requests per minute */
  WRITE: {
    max: 30,
    windowSeconds: 60,
  },

  /** Sensitive operations: 5 requests per minute */
  SENSITIVE: {
    max: 5,
    windowSeconds: 60,
  },

  /** Authentication: 10 requests per 15 minutes */
  AUTH: {
    max: 10,
    windowSeconds: 15 * 60,
  },

  /** Very strict: 3 requests per minute */
  STRICT: {
    max: 3,
    windowSeconds: 60,
  },
} as const;

// ============================================================================
// Rate Limit Middleware
// ============================================================================

/**
 * Generate default rate limit key
 * Uses user ID if authenticated, otherwise IP address
 */
function defaultKeyGenerator(c: Context): string {
  const user = c.get('user');
  if (user?.id) {
    return `user:${user.id}`;
  }

  // Fall back to IP address
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';
  return `ip:${ip}`;
}

/**
 * Create a rate limit middleware
 *
 * Usage:
 *   // Basic usage
 *   app.use('*', rateLimit({ max: 60, windowSeconds: 60 }));
 *
 *   // Using presets
 *   app.use('/api/v1/notifications', rateLimit(RATE_LIMITS.STANDARD));
 *   app.post('/api/v1/notifications/read-all', rateLimit(RATE_LIMITS.BULK));
 *
 *   // Custom key generator
 *   app.use('*', rateLimit({
 *     max: 100,
 *     windowSeconds: 60,
 *     keyGenerator: (c) => c.get('tenant')?.id || 'global',
 *   }));
 */
export function rateLimit(config: RateLimitConfig): MiddlewareHandler {
  const {
    max,
    windowSeconds,
    keyGenerator = defaultKeyGenerator,
    message = 'Too many requests. Please try again later.',
    skip,
  } = config;

  return async (c: Context, next: Next) => {
    // Check if rate limiting should be skipped
    if (skip?.(c)) {
      await next();
      return;
    }

    const redis = getRedis();
    const identifier = keyGenerator(c);
    const endpoint = `${c.req.method}:${c.req.path}`;
    const key = `${REDIS_KEYS.RATE_LIMIT}${identifier}:${endpoint}`;

    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - windowSeconds;

    try {
      // Use Redis transaction for atomic operations
      const pipeline = redis.pipeline();

      // Remove old entries outside the window
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count requests in current window
      pipeline.zcard(key);

      // Add current request
      pipeline.zadd(key, now, `${now}:${Math.random()}`);

      // Set expiry on the key
      pipeline.expire(key, windowSeconds);

      const results = await pipeline.exec();

      if (!results) {
        // Redis error - allow request but log
        console.warn('Rate limit check failed - allowing request');
        await next();
        return;
      }

      // Get current count (before adding new request)
      const currentCount = results[1]?.[1] as number || 0;

      // Calculate rate limit info
      const remaining = Math.max(0, max - currentCount - 1);
      const reset = now + windowSeconds;

      // Set rate limit headers
      c.header('X-RateLimit-Limit', max.toString());
      c.header('X-RateLimit-Remaining', remaining.toString());
      c.header('X-RateLimit-Reset', reset.toString());

      // Check if rate limit exceeded
      if (currentCount >= max) {
        c.header('Retry-After', windowSeconds.toString());

        return c.json(
          {
            error: 'rate_limit_exceeded',
            message,
            retry_after: windowSeconds,
            limit: max,
            remaining: 0,
            reset,
          },
          429
        );
      }

      await next();
    } catch (error) {
      // On Redis error, allow the request but log the error
      console.error('Rate limit middleware error:', error);
      await next();
    }
  };
}

/**
 * Get current rate limit status for a request
 */
export async function getRateLimitStatus(
  identifier: string,
  endpoint: string,
  config: Pick<RateLimitConfig, 'max' | 'windowSeconds'>
): Promise<RateLimitInfo> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.RATE_LIMIT}${identifier}:${endpoint}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - config.windowSeconds;

  // Clean old entries and get count
  await redis.zremrangebyscore(key, 0, windowStart);
  const count = await redis.zcard(key);

  return {
    limit: config.max,
    remaining: Math.max(0, config.max - count),
    reset: now + config.windowSeconds,
  };
}

/**
 * Clear rate limit for a specific identifier and endpoint
 * Useful for testing or manual reset
 */
export async function clearRateLimit(identifier: string, endpoint: string): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.RATE_LIMIT}${identifier}:${endpoint}`;
  await redis.del(key);
}

/**
 * Create endpoint-specific rate limiter
 * Convenience function for applying different limits to different endpoints
 */
export function createEndpointRateLimiter(endpointConfigs: Record<string, RateLimitConfig>) {
  return async (c: Context, next: Next) => {
    const path = c.req.path;
    const method = c.req.method;

    // Find matching config
    for (const [pattern, config] of Object.entries(endpointConfigs)) {
      // Simple pattern matching (supports * wildcard)
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\//g, '\\/') + '$'
      );

      if (regex.test(path) || regex.test(`${method}:${path}`)) {
        return rateLimit(config)(c, next);
      }
    }

    // Default to standard rate limit if no match
    return rateLimit(RATE_LIMITS.STANDARD)(c, next);
  };
}
