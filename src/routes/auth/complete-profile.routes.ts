/**
 * Complete Profile Routes
 *
 * GET /api/v1/auth/verification-status - Get verification status for UI
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth.middleware';
import { optionalTenantMiddleware } from '../../middleware/tenant.middleware';
import { getVerificationDetails, checkVerificationStatus } from '../../services/verification.service';
import { getUserTenants } from '../../services/tenant.service';
import type { User } from '../../db/schema';

const app = new Hono();

/**
 * GET /api/v1/auth/verification-status
 * Get detailed verification status for complete profile page
 * Per Section 3.4 UI data
 */
app.get('/verification-status', authMiddleware, optionalTenantMiddleware, async (c) => {
  const user = c.get('user') as User;
  const tenant = c.get('tenant');

  // If no tenant in context, get user's first tenant
  let tenantId = tenant?.id;

  if (!tenantId) {
    const userTenants = await getUserTenants(user.id);
    if (userTenants.length > 0) {
      tenantId = userTenants[0].tenant.id;
    }
  }

  if (!tenantId) {
    // User has no tenants - return basic status
    return c.json({
      email: {
        verified: user.emailVerified,
        address: user.email,
      },
      phone: {
        verified: user.phoneVerified,
        number: user.phone || null,
        required: true,
        deadline_days_remaining: null,
      },
      mfa: {
        enabled: user.mfaEnabled,
        required: true,
        deadline_days_remaining: null,
      },
      next_required_step: !user.emailVerified ? 'email' : null,
    });
  }

  const details = await getVerificationDetails(user, tenantId);

  return c.json({
    email: {
      verified: details.email.verified,
      address: details.email.address,
    },
    phone: {
      verified: details.phone.verified,
      number: details.phone.number,
      required: details.phone.required,
      deadline_days_remaining: details.phone.deadlineDaysRemaining,
    },
    mfa: {
      enabled: details.mfa.enabled,
      required: details.mfa.required,
      deadline_days_remaining: details.mfa.deadlineDaysRemaining,
    },
    next_required_step: details.nextRequiredStep,
  });
});

/**
 * GET /api/v1/auth/profile
 * Get current user profile
 */
app.get('/profile', authMiddleware, async (c) => {
  const user = c.get('user') as User;

  return c.json({
    id: user.id,
    email: user.email,
    first_name: user.firstName,
    last_name: user.lastName,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    phone: user.phone,
    email_verified: user.emailVerified,
    phone_verified: user.phoneVerified,
    mfa_enabled: user.mfaEnabled,
    status: user.status,
    created_at: user.createdAt,
    last_login_at: user.lastLoginAt,
  });
});

/**
 * GET /api/v1/auth/tenants
 * Get user's tenants
 */
app.get('/tenants', authMiddleware, async (c) => {
  const user = c.get('user') as User;

  const userTenants = await getUserTenants(user.id);

  const tenantsWithStatus = await Promise.all(
    userTenants.map(async (m) => {
      const status = await checkVerificationStatus(user, m.tenant.id);

      return {
        id: m.tenant.id,
        name: m.tenant.name,
        slug: m.tenant.slug,
        type: m.tenant.type,
        plan: m.tenant.plan,
        role: {
          id: m.role.id,
          name: m.role.name,
          hierarchy_level: m.role.hierarchyLevel,
        },
        is_owner: m.isOwner,
        verification_status: {
          complete: status.complete,
          missing: status.missing,
          deadlines: status.deadlines,
        },
      };
    })
  );

  return c.json({
    tenants: tenantsWithStatus,
  });
});

export default app;
