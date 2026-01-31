/**
 * Verification Status Service
 *
 * Handles verification deadline checking per UNIFIED_AUTH_STRATEGY.md Section 3.5.
 * Checks email, phone, and MFA verification status against tenant requirements.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';
import { tenantSecurityConfig, type TenantSecurityConfig } from '../db/schema';
import type { User } from '../db/schema';

export interface VerificationStatus {
  complete: boolean;
  missing: ('email' | 'phone' | 'mfa')[];
  deadlines: {
    phone?: number; // Days remaining
    mfa?: number; // Days remaining
  };
  nextRequiredStep: 'email' | 'phone' | 'mfa' | null;
}

export interface VerificationDetails {
  email: {
    verified: boolean;
    address: string;
  };
  phone: {
    verified: boolean;
    number: string | null;
    required: boolean;
    deadlineDaysRemaining: number | null;
  };
  mfa: {
    enabled: boolean;
    required: boolean;
    deadlineDaysRemaining: number | null;
  };
  nextRequiredStep: 'email' | 'phone' | 'mfa' | null;
}

/**
 * Calculate days since a date
 */
function daysSince(date: Date): number {
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get tenant security config with caching
 */
export async function getTenantSecurityConfig(
  tenantId: string
): Promise<TenantSecurityConfig | null> {
  const redis = getRedis();
  const cacheKey = `${REDIS_KEYS.TENANT_CONFIG}${tenantId}`;

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Fetch from database
  const db = getDb();
  const config = await db.query.tenantSecurityConfig.findFirst({
    where: eq(tenantSecurityConfig.tenantId, tenantId),
  });

  if (config) {
    // Cache the config
    await redis.setex(cacheKey, REDIS_TTL.TENANT_CONFIG, JSON.stringify(config));
  }

  return config || null;
}

/**
 * Invalidate tenant security config cache
 */
export async function invalidateTenantConfigCache(tenantId: string): Promise<void> {
  const redis = getRedis();
  const cacheKey = `${REDIS_KEYS.TENANT_CONFIG}${tenantId}`;
  await redis.del(cacheKey);
}

/**
 * Check verification status for a user in a tenant
 * Implements Section 3.5 exactly
 */
export async function checkVerificationStatus(
  user: User,
  tenantId: string
): Promise<VerificationStatus> {
  const config = await getTenantSecurityConfig(tenantId);

  // Default config if not found
  const requirePhoneVerification = config?.requirePhoneVerification ?? true;
  const requireMfa = config?.requireMfa ?? true;
  const phoneDeadlineDays = config?.phoneVerificationDeadlineDays ?? 3;
  const mfaDeadlineDays = config?.mfaDeadlineDays ?? 7;

  const accountAgeDays = daysSince(user.createdAt);

  const status: VerificationStatus = {
    complete: true,
    missing: [],
    deadlines: {},
    nextRequiredStep: null,
  };

  // Email - always required immediately
  if (!user.emailVerified) {
    status.complete = false;
    status.missing.push('email');
    status.nextRequiredStep = 'email';
  }

  // Phone - if tenant requires it
  if (requirePhoneVerification && !user.phoneVerified) {
    if (accountAgeDays > phoneDeadlineDays) {
      // Deadline passed - required now
      status.complete = false;
      status.missing.push('phone');
      if (!status.nextRequiredStep) {
        status.nextRequiredStep = 'phone';
      }
    } else {
      // Still within grace period
      status.deadlines.phone = phoneDeadlineDays - accountAgeDays;
    }
  }

  // MFA - always required after deadline (per spec, MFA is always required)
  if (!user.mfaEnabled) {
    if (accountAgeDays > mfaDeadlineDays) {
      // Deadline passed - required now
      status.complete = false;
      status.missing.push('mfa');
      if (!status.nextRequiredStep) {
        status.nextRequiredStep = 'mfa';
      }
    } else {
      // Still within grace period
      status.deadlines.mfa = mfaDeadlineDays - accountAgeDays;
    }
  }

  return status;
}

/**
 * Get detailed verification status for UI display
 * Implements Section 3.4 UI data
 */
export async function getVerificationDetails(
  user: User,
  tenantId: string
): Promise<VerificationDetails> {
  const config = await getTenantSecurityConfig(tenantId);

  const requirePhoneVerification = config?.requirePhoneVerification ?? true;
  const requireMfa = config?.requireMfa ?? true;
  const phoneDeadlineDays = config?.phoneVerificationDeadlineDays ?? 3;
  const mfaDeadlineDays = config?.mfaDeadlineDays ?? 7;

  const accountAgeDays = daysSince(user.createdAt);

  // Calculate remaining days (null if verified or deadline passed)
  let phoneDaysRemaining: number | null = null;
  if (requirePhoneVerification && !user.phoneVerified) {
    const remaining = phoneDeadlineDays - accountAgeDays;
    if (remaining > 0) {
      phoneDaysRemaining = remaining;
    }
  }

  let mfaDaysRemaining: number | null = null;
  if (!user.mfaEnabled) {
    const remaining = mfaDeadlineDays - accountAgeDays;
    if (remaining > 0) {
      mfaDaysRemaining = remaining;
    }
  }

  // Determine next required step
  let nextRequiredStep: 'email' | 'phone' | 'mfa' | null = null;

  if (!user.emailVerified) {
    nextRequiredStep = 'email';
  } else if (requirePhoneVerification && !user.phoneVerified && accountAgeDays > phoneDeadlineDays) {
    nextRequiredStep = 'phone';
  } else if (!user.mfaEnabled && accountAgeDays > mfaDeadlineDays) {
    nextRequiredStep = 'mfa';
  }

  return {
    email: {
      verified: user.emailVerified,
      address: user.email,
    },
    phone: {
      verified: user.phoneVerified,
      number: user.phone || null,
      required: requirePhoneVerification,
      deadlineDaysRemaining: phoneDaysRemaining,
    },
    mfa: {
      enabled: user.mfaEnabled,
      required: requireMfa,
      deadlineDaysRemaining: mfaDaysRemaining,
    },
    nextRequiredStep,
  };
}

/**
 * Check if user is blocked from accessing resources
 * Returns the first blocking reason, or null if access is allowed
 */
export async function getAccessBlockReason(
  user: User,
  tenantId: string
): Promise<{ blocked: boolean; reason: string | null; redirectUrl: string | null }> {
  // Check if user is administratively blocked
  if (user.blockedUntil && new Date(user.blockedUntil) > new Date()) {
    return {
      blocked: true,
      reason: user.blockReason || 'Account temporarily blocked',
      redirectUrl: null,
    };
  }

  // Check account status
  if (user.status === 'suspended') {
    return {
      blocked: true,
      reason: 'Account suspended. Please contact support.',
      redirectUrl: null,
    };
  }

  if (user.status === 'deleted') {
    return {
      blocked: true,
      reason: 'Account deleted.',
      redirectUrl: null,
    };
  }

  // Check verification status
  const verificationStatus = await checkVerificationStatus(user, tenantId);

  if (!verificationStatus.complete) {
    const missingStr = verificationStatus.missing.join(', ');
    return {
      blocked: true,
      reason: `Please complete verification: ${missingStr}`,
      redirectUrl: '/complete-profile',
    };
  }

  return { blocked: false, reason: null, redirectUrl: null };
}

export const verificationService = {
  getTenantSecurityConfig,
  invalidateTenantConfigCache,
  checkVerificationStatus,
  getVerificationDetails,
  getAccessBlockReason,
};
