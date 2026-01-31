/**
 * Verification Enforcement Middleware
 *
 * Enforces verification requirements per UNIFIED_AUTH_STRATEGY.md Section 3.5.
 * Checks email, phone, and MFA status against tenant deadlines.
 */

import { Context, Next } from 'hono';
import { checkVerificationStatus, getTenantSecurityConfig } from '../services/verification.service';
import type { User, Tenant } from '../db/schema';

// Extend Hono context
declare module 'hono' {
  interface ContextVariableMap {
    tenant: Tenant;
    tenantId: string;
  }
}

/**
 * Full verification enforcement middleware
 * Checks all verification requirements (email, phone, MFA)
 * Use after authMiddleware and tenantMiddleware
 */
export async function enforceVerification(c: Context, next: Next) {
  const user = c.get('user') as User;
  const tenant = c.get('tenant') as Tenant;

  if (!user || !tenant) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'Authentication and tenant context required',
      },
      401
    );
  }

  const config = await getTenantSecurityConfig(tenant.id);
  const accountAgeDays = daysSince(user.createdAt);

  const missing: string[] = [];
  const deadlines: Record<string, number> = {};

  // Email - always required immediately
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

  // Phone - if required by tenant and deadline passed
  if (config?.requirePhoneVerification) {
    const phoneDeadlineDays = config.phoneVerificationDeadlineDays ?? 3;

    if (!user.phoneVerified) {
      if (accountAgeDays > phoneDeadlineDays) {
        missing.push('phone');
      } else {
        deadlines.phone = phoneDeadlineDays - accountAgeDays;
      }
    }
  }

  // MFA - deadline passed
  const mfaDeadlineDays = config?.mfaDeadlineDays ?? 7;
  if (!user.mfaEnabled) {
    if (accountAgeDays > mfaDeadlineDays) {
      missing.push('mfa');
    } else {
      deadlines.mfa = mfaDeadlineDays - accountAgeDays;
    }
  }

  if (missing.length > 0) {
    return c.json(
      {
        error: 'verification_required',
        message: `Please complete verification: ${missing.join(', ')}`,
        missing,
        deadlines,
        redirect_url: '/complete-profile',
      },
      403
    );
  }

  // Add upcoming deadlines to response headers for frontend awareness
  if (Object.keys(deadlines).length > 0) {
    c.header('X-Verification-Deadlines', JSON.stringify(deadlines));
  }

  await next();
}

/**
 * Soft verification check - allows access but adds warnings
 * Use for non-critical routes where you want to remind users
 */
export async function softVerificationCheck(c: Context, next: Next) {
  const user = c.get('user') as User;
  const tenant = c.get('tenant') as Tenant;

  if (!user || !tenant) {
    return next();
  }

  const status = await checkVerificationStatus(user, tenant.id);

  // Add verification status to response headers
  if (!status.complete || Object.keys(status.deadlines).length > 0) {
    c.header('X-Verification-Status', JSON.stringify({
      complete: status.complete,
      missing: status.missing,
      deadlines: status.deadlines,
    }));
  }

  await next();
}

/**
 * Require specific verification step
 * Factory function to create middleware for specific verification requirements
 */
export function requireVerification(step: 'email' | 'phone' | 'mfa') {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as User;

    if (!user) {
      return c.json(
        {
          error: 'unauthorized',
          message: 'Authentication required',
        },
        401
      );
    }

    switch (step) {
      case 'email':
        if (!user.emailVerified) {
          return c.json(
            {
              error: 'email_not_verified',
              message: 'Email verification required',
              redirect_url: '/verify-email',
            },
            403
          );
        }
        break;

      case 'phone':
        if (!user.phoneVerified) {
          return c.json(
            {
              error: 'phone_not_verified',
              message: 'Phone verification required',
              redirect_url: '/complete-profile',
            },
            403
          );
        }
        break;

      case 'mfa':
        if (!user.mfaEnabled) {
          return c.json(
            {
              error: 'mfa_not_enabled',
              message: 'MFA setup required',
              redirect_url: '/complete-profile',
            },
            403
          );
        }
        break;
    }

    await next();
  };
}

/**
 * MFA verification middleware
 * Requires MFA code verification for sensitive operations
 * The code should be provided in X-MFA-Code header
 */
export async function requireMfaVerification(c: Context, next: Next) {
  const user = c.get('user') as User;

  if (!user) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'Authentication required',
      },
      401
    );
  }

  // If MFA is not enabled, skip verification
  if (!user.mfaEnabled) {
    return next();
  }

  const mfaCode = c.req.header('X-MFA-Code');

  if (!mfaCode) {
    return c.json(
      {
        error: 'mfa_required',
        message: 'MFA verification required for this action',
        require_mfa_code: true,
      },
      403
    );
  }

  // Verify MFA code
  const { mfaService } = await import('../services/mfa.service');
  const verification = await mfaService.verifyMfaCode(user.id, mfaCode);

  if (!verification.verified) {
    return c.json(
      {
        error: 'mfa_invalid',
        message: verification.error || 'Invalid MFA code',
      },
      403
    );
  }

  await next();
}

/**
 * Calculate days since a date
 */
function daysSince(date: Date): number {
  const now = new Date();
  const diffTime = now.getTime() - new Date(date).getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

export const verificationMiddleware = {
  enforceVerification,
  softVerificationCheck,
  requireVerification,
  requireMfaVerification,
};
