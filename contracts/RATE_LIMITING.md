# Rate Limiting Strategy

**Version:** 1.0.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Rate Limit Categories](#rate-limit-categories)
3. [Limit Definitions](#limit-definitions)
4. [Implementation](#implementation)
5. [Response Headers](#response-headers)
6. [Error Responses](#error-responses)
7. [Bypass and Overrides](#bypass-and-overrides)
8. [Monitoring](#monitoring)

---

## Overview

This document defines the rate limiting strategy for all Zygo API endpoints to protect against abuse, ensure fair usage, and maintain system stability.

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| Defense in Depth | Multiple limit layers (IP, user, tenant) |
| Fair Usage | Limits based on plan tier |
| Graceful Degradation | Clear feedback when limits reached |
| Security First | Aggressive limits on auth endpoints |
| Transparency | Clear headers and documentation |

### Rate Limit Scopes

```
┌─────────────────────────────────────────────────────────────┐
│                    Rate Limit Hierarchy                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Level 1: Global (Platform-wide)                             │
│    └── Protects infrastructure from DDoS                     │
│                                                              │
│  Level 2: Per-IP                                             │
│    └── Protects against single-source attacks                │
│                                                              │
│  Level 3: Per-Tenant                                         │
│    └── Fair usage across organizations                       │
│                                                              │
│  Level 4: Per-User                                           │
│    └── Fair usage within organization                        │
│                                                              │
│  Level 5: Per-Endpoint                                       │
│    └── Sensitive operations (auth, export)                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Rate Limit Categories

### Authentication Endpoints

Aggressive limits to prevent brute-force attacks.

| Endpoint | Limit | Window | Scope | Lockout |
|----------|-------|--------|-------|---------|
| `POST /auth/login` | 5 | 15 min | IP | 30 min after 10 failures |
| `POST /auth/login` | 10 | 15 min | Email | 60 min after 15 failures |
| `POST /auth/mfa/verify` | 3 | 5 min | User | 15 min after 5 failures |
| `POST /auth/password/forgot` | 3 | 1 hour | Email | 24 hour cooldown |
| `POST /auth/password/reset` | 3 | 1 hour | Token | Token invalidated |
| `POST /auth/signup` | 5 | 1 hour | IP | 24 hour block |
| `POST /auth/verify-email` | 5 | 15 min | Email | Resend cooldown |

### API Endpoints (Authenticated)

Based on tenant plan tier.

| Plan | Requests/Minute | Requests/Hour | Requests/Day |
|------|-----------------|---------------|--------------|
| Free | 60 | 1,000 | 10,000 |
| Basic | 300 | 10,000 | 100,000 |
| Business | 1,000 | 50,000 | 500,000 |
| Enterprise | 5,000 | 200,000 | 2,000,000 |

### Sensitive Operations

Additional limits for resource-intensive operations.

| Operation | Limit | Window | Scope |
|-----------|-------|--------|-------|
| Workflow Execution | 100 | 1 min | Tenant |
| AI Generation | 60 | 1 min | Tenant |
| Bulk Operations | 10 | 1 min | Tenant |
| Data Export | 10 | 1 hour | User |
| Secret Export | 5 | 1 hour | User + MFA |
| Report Generation | 20 | 1 hour | Tenant |
| Webhook Creation | 20 | 1 hour | Tenant |
| Server Deployment | 50 | 1 hour | Tenant |

### WebSocket Connections

| Metric | Limit | Scope |
|--------|-------|-------|
| Concurrent Connections | 10 | User |
| Concurrent Connections | 100 | Tenant |
| Messages/Second | 10 | Connection |
| Connection Duration | 24 hours | Connection |

---

## Limit Definitions

### Authentication Limits

```typescript
interface AuthRateLimits {
  login: {
    perIP: { limit: 5, window: '15m', lockout: '30m', lockoutThreshold: 10 },
    perEmail: { limit: 10, window: '15m', lockout: '60m', lockoutThreshold: 15 }
  };
  mfa: {
    perUser: { limit: 3, window: '5m', lockout: '15m', lockoutThreshold: 5 }
  };
  passwordForgot: {
    perEmail: { limit: 3, window: '1h', cooldown: '24h' }
  };
  passwordReset: {
    perToken: { limit: 3, window: '1h', invalidateOnExhaust: true }
  };
  signup: {
    perIP: { limit: 5, window: '1h', block: '24h', blockThreshold: 10 }
  };
  verifyEmail: {
    perEmail: { limit: 5, window: '15m', resendCooldown: '60s' }
  };
}
```

### Tenant Plan Limits

```typescript
interface PlanRateLimits {
  free: {
    api: { perMinute: 60, perHour: 1000, perDay: 10000 },
    workflows: { perMinute: 10, concurrent: 2 },
    ai: { perMinute: 10, tokensPerDay: 10000 },
    storage: { uploadsPerHour: 20, maxFileSizeMB: 10 }
  };
  basic: {
    api: { perMinute: 300, perHour: 10000, perDay: 100000 },
    workflows: { perMinute: 50, concurrent: 10 },
    ai: { perMinute: 30, tokensPerDay: 100000 },
    storage: { uploadsPerHour: 100, maxFileSizeMB: 50 }
  };
  business: {
    api: { perMinute: 1000, perHour: 50000, perDay: 500000 },
    workflows: { perMinute: 100, concurrent: 50 },
    ai: { perMinute: 60, tokensPerDay: 500000 },
    storage: { uploadsPerHour: 500, maxFileSizeMB: 100 }
  };
  enterprise: {
    api: { perMinute: 5000, perHour: 200000, perDay: 2000000 },
    workflows: { perMinute: 500, concurrent: 200 },
    ai: { perMinute: 200, tokensPerDay: 2000000 },
    storage: { uploadsPerHour: 2000, maxFileSizeMB: 500 }
  };
}
```

### Endpoint-Specific Limits

```typescript
interface EndpointLimits {
  // Heavy operations
  '/api/v1/workflows/*/execute': { perMinute: 100, perTenant: true };
  '/api/v1/ai/generate': { perMinute: 60, perTenant: true };
  '/api/v1/exports/*': { perHour: 10, perUser: true };
  '/api/v1/secrets/export': { perHour: 5, perUser: true, requiresMfa: true };

  // Bulk operations
  '/api/v1/users/bulk': { perMinute: 10, perTenant: true };
  '/api/v1/roles/*/members/bulk': { perMinute: 10, perTenant: true };
  '/api/v1/servers/bulk': { perMinute: 10, perTenant: true };

  // Resource creation
  '/api/v1/servers': { perHour: 50, perTenant: true, method: 'POST' };
  '/api/v1/workflows': { perHour: 100, perTenant: true, method: 'POST' };
  '/api/v1/webhooks': { perHour: 20, perTenant: true, method: 'POST' };

  // Search/list operations (prevent scraping)
  '/api/v1/users': { perMinute: 30, perUser: true, method: 'GET' };
  '/api/v1/audit-logs': { perMinute: 20, perUser: true, method: 'GET' };
}
```

---

## Implementation

### Algorithm: Token Bucket

```typescript
interface TokenBucket {
  key: string;           // Identifier (IP, user, tenant)
  tokens: number;        // Current available tokens
  maxTokens: number;     // Bucket capacity
  refillRate: number;    // Tokens added per second
  lastRefill: number;    // Timestamp of last refill
}

function checkRateLimit(bucket: TokenBucket): RateLimitResult {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;

  // Refill tokens
  bucket.tokens = Math.min(
    bucket.maxTokens,
    bucket.tokens + (elapsed * bucket.refillRate)
  );
  bucket.lastRefill = now;

  // Check if request allowed
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      reset: calculateReset(bucket)
    };
  }

  return {
    allowed: false,
    remaining: 0,
    reset: calculateReset(bucket),
    retryAfter: Math.ceil((1 - bucket.tokens) / bucket.refillRate)
  };
}
```

### Algorithm: Sliding Window

For more precise limits on sensitive endpoints:

```typescript
interface SlidingWindow {
  key: string;
  windowMs: number;
  maxRequests: number;
  requests: number[];  // Timestamps of requests
}

function checkSlidingWindow(window: SlidingWindow): RateLimitResult {
  const now = Date.now();
  const windowStart = now - window.windowMs;

  // Remove old requests
  window.requests = window.requests.filter(ts => ts > windowStart);

  if (window.requests.length < window.maxRequests) {
    window.requests.push(now);
    return {
      allowed: true,
      remaining: window.maxRequests - window.requests.length,
      reset: window.requests[0] + window.windowMs
    };
  }

  return {
    allowed: false,
    remaining: 0,
    reset: window.requests[0] + window.windowMs,
    retryAfter: Math.ceil((window.requests[0] + window.windowMs - now) / 1000)
  };
}
```

### Redis Implementation

```typescript
// Rate limit check using Redis
async function checkRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const multi = redis.multi();

  // Increment counter
  multi.incr(key);

  // Set expiry on first request
  multi.expire(key, windowSeconds, 'NX');

  // Get TTL
  multi.ttl(key);

  const [count, _, ttl] = await multi.exec();

  const remaining = Math.max(0, limit - (count as number));
  const reset = Date.now() + (ttl as number) * 1000;

  if (count > limit) {
    return {
      allowed: false,
      remaining: 0,
      reset,
      retryAfter: ttl as number
    };
  }

  return {
    allowed: true,
    remaining,
    reset
  };
}
```

---

## Response Headers

All API responses include rate limit headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1706270400
X-RateLimit-Window: 60
X-RateLimit-Policy: tenant
```

### Header Definitions

| Header | Description | Example |
|--------|-------------|---------|
| `X-RateLimit-Limit` | Maximum requests in window | 1000 |
| `X-RateLimit-Remaining` | Remaining requests | 999 |
| `X-RateLimit-Reset` | Unix timestamp when limit resets | 1706270400 |
| `X-RateLimit-Window` | Window size in seconds | 60 |
| `X-RateLimit-Policy` | Which limit policy applies | tenant, user, ip |
| `Retry-After` | Seconds until retry (429 only) | 45 |

### Multiple Limits

When multiple limits apply, return the most restrictive:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 5
X-RateLimit-Reset: 1706270400
X-RateLimit-Policy: endpoint:/api/v1/ai/generate
```

---

## Error Responses

### 429 Too Many Requests

```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Please try again later.",
  "statusCode": 429,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123",
  "path": "/api/v1/workflows/execute",
  "details": {
    "limit": 100,
    "window": "1 minute",
    "policy": "workflow_execution",
    "retryAfter": 45,
    "resetAt": "2026-01-26T12:00:45.000Z"
  }
}
```

### Account Lockout (Authentication)

```json
{
  "error": "AUTH_ACCOUNT_LOCKED",
  "message": "Account temporarily locked due to too many failed attempts",
  "statusCode": 403,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123",
  "path": "/api/v1/auth/login",
  "details": {
    "reason": "excessive_failed_attempts",
    "failedAttempts": 10,
    "lockoutDuration": "30 minutes",
    "unlocksAt": "2026-01-26T12:30:00.000Z",
    "supportUrl": "https://support.zygo.io/account-locked"
  }
}
```

### IP Blocked

```json
{
  "error": "IP_BLOCKED",
  "message": "Your IP address has been temporarily blocked",
  "statusCode": 403,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123",
  "path": "/api/v1/auth/signup",
  "details": {
    "reason": "suspicious_activity",
    "blockedUntil": "2026-01-27T12:00:00.000Z",
    "appealUrl": "https://support.zygo.io/ip-blocked"
  }
}
```

---

## Bypass and Overrides

### Allowlisted IPs

For trusted services (monitoring, CI/CD):

```typescript
const allowlistedIPs = [
  '10.0.0.0/8',      // Internal services
  '192.168.1.100',   // Monitoring
  // CI/CD runners...
];
```

### API Key Tier Overrides

Enterprise customers can request higher limits:

```typescript
interface ApiKeyOverride {
  apiKeyId: string;
  tenantId: string;
  overrides: {
    api?: { perMinute: number };
    workflows?: { perMinute: number };
    ai?: { perMinute: number };
  };
  validUntil: string;
  approvedBy: string;
}
```

### Temporary Burst Allowance

For legitimate burst scenarios:

```typescript
interface BurstAllowance {
  tenantId: string;
  endpoint: string;
  multiplier: number;  // e.g., 2x normal limit
  duration: number;    // Duration in minutes
  reason: string;
  approvedBy: string;
}
```

---

## Monitoring

### Metrics to Track

| Metric | Description |
|--------|-------------|
| `rate_limit_hits_total` | Total rate limit checks |
| `rate_limit_exceeded_total` | Rate limit violations |
| `rate_limit_remaining_avg` | Average remaining quota |
| `auth_lockout_total` | Account lockouts |
| `ip_block_total` | IP blocks |

### Alert Thresholds

| Alert | Condition | Severity |
|-------|-----------|----------|
| High Rate Limit Hits | >50% requests hitting limits | Warning |
| Auth Brute Force | >100 login failures/min/IP | Critical |
| DDoS Detected | >10,000 requests/min from IP | Critical |
| Tenant Abuse | Tenant at 95% quota consistently | Warning |

### Dashboard Queries

```sql
-- Top rate-limited tenants (last hour)
SELECT
  tenant_id,
  COUNT(*) as limit_hits,
  COUNT(DISTINCT endpoint) as unique_endpoints
FROM rate_limit_log
WHERE timestamp > NOW() - INTERVAL '1 hour'
  AND exceeded = true
GROUP BY tenant_id
ORDER BY limit_hits DESC
LIMIT 10;

-- Potential abuse detection
SELECT
  ip_address,
  COUNT(*) as requests,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT tenant_id) as unique_tenants
FROM request_log
WHERE timestamp > NOW() - INTERVAL '15 minutes'
GROUP BY ip_address
HAVING COUNT(*) > 1000
   OR COUNT(DISTINCT tenant_id) > 5;
```

---

## Database Schema

### rate_limit_log Table

```sql
CREATE TABLE rate_limit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),

  -- Request info
  ip_address INET NOT NULL,
  endpoint TEXT NOT NULL,
  method VARCHAR(10) NOT NULL,

  -- Limit info
  policy TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  exceeded BOOLEAN NOT NULL DEFAULT FALSE,

  -- Metadata
  request_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partition by month for performance
CREATE INDEX idx_rate_limit_log_time ON rate_limit_log(created_at DESC);
CREATE INDEX idx_rate_limit_log_exceeded ON rate_limit_log(exceeded, created_at DESC)
  WHERE exceeded = true;

-- Auto-cleanup old records (retain 30 days)
CREATE OR REPLACE FUNCTION cleanup_rate_limit_log()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limit_log
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
```

### ip_blocks Table

```sql
CREATE TABLE ip_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address INET NOT NULL,
  reason TEXT NOT NULL,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ NOT NULL,
  auto_blocked BOOLEAN NOT NULL DEFAULT TRUE,
  blocked_by UUID REFERENCES users(id),

  UNIQUE(ip_address)
);

CREATE INDEX idx_ip_blocks_active ON ip_blocks(ip_address)
  WHERE blocked_until > NOW();
```

---

## Changelog

### v1.0.0 (January 26, 2026)
- Initial rate limiting specification
- Authentication endpoint limits
- Plan-based API limits
- Endpoint-specific limits
- Implementation algorithms
- Monitoring guidelines
