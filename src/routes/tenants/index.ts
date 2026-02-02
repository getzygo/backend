/**
 * Tenant Routes
 *
 * Phase 3: Multi-Tenant Management
 * Phase 5: Enterprise Features (SSO, Domain Claiming)
 *
 * GET /api/v1/tenants - List user's tenants (tenant picker)
 * POST /api/v1/tenants/switch - Switch to a different tenant
 * GET /api/v1/tenants/:tenantId - Get tenant details
 * GET /api/v1/tenants/:tenantId/security-config - Get security config
 * PATCH /api/v1/tenants/:tenantId/security-config - Update security config
 *
 * SSO Routes (Enterprise):
 * GET /api/v1/tenants/:tenantId/sso - Get SSO config
 * PUT /api/v1/tenants/:tenantId/sso - Configure SSO
 * DELETE /api/v1/tenants/:tenantId/sso - Disable SSO
 * POST /api/v1/tenants/:tenantId/sso/test - Test SSO config
 *
 * Domain Routes (Enterprise):
 * GET /api/v1/tenants/:tenantId/domains - List claimed domains
 * POST /api/v1/tenants/:tenantId/domains - Claim domain
 * DELETE /api/v1/tenants/:tenantId/domains/:domain - Release domain
 * POST /api/v1/tenants/:tenantId/domains/:domain/verify - Verify domain
 *
 * Per UNIFIED_AUTH_STRATEGY.md Sections 7, 11, 14.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { tenantMiddleware, requireTenantMembership } from '../../middleware/tenant.middleware';
import ssoRoutes from './sso.routes';
import domainsRoutes from './domains.routes';
import {
  getUserTenants,
  getTenantById,
  getTenantBySlug,
  getTenantSecurityConfig,
  updateTenantSecurityConfig,
  isTenantMember,
  getTenantMembership,
  checkBillingReadiness,
  updateTenantBilling,
} from '../../services/tenant.service';
import { checkVerificationStatus } from '../../services/verification.service';
import { hasPermission } from '../../services/permission.service';
import { getDb } from '../../db/client';
import { auditLogs } from '../../db/schema';
import type { User } from '../../db/schema';

const app = new Hono();

/**
 * GET /api/v1/tenants/:slugOrId/config
 * Public endpoint - Get tenant configuration by slug or ID
 * Used by tenant frontend apps to load tenant branding and settings
 * No authentication required
 */
app.get('/:slugOrId/config', async (c) => {
  const slugOrId = c.req.param('slugOrId');

  // Try to find tenant by slug first, then by ID
  let tenant = await getTenantBySlug(slugOrId);

  if (!tenant) {
    // Try by ID if not found by slug
    tenant = await getTenantById(slugOrId);
  }

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_not_found',
        message: 'Tenant not found. Please check the URL.',
      },
      404
    );
  }

  // Check tenant status
  if (tenant.status === 'suspended') {
    return c.json(
      {
        error: 'tenant_suspended',
        code: 'tenant_suspended',
        message: 'This workspace has been suspended. Please contact support.',
      },
      403
    );
  }

  if (tenant.status !== 'active') {
    return c.json(
      {
        error: 'tenant_inactive',
        message: 'This workspace is not active.',
      },
      403
    );
  }

  // Get security config for SSO/MFA settings
  const securityConfig = await getTenantSecurityConfig(tenant.id);

  // Return public tenant configuration
  return c.json({
    data: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      plan: {
        name: tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1),
        tier: tenant.plan,
        features: getPlanFeatures(tenant.plan),
      },
      branding: {
        logo: tenant.logoUrl || undefined,
        primaryColor: tenant.primaryColor || '#6366f1',
        customDomain: tenant.customDomain || undefined,
      },
      settings: {
        ssoEnabled: securityConfig?.ssoEnabled || false,
        mfaRequired: securityConfig?.requireMfa || false,
        ipWhitelist: securityConfig?.ipWhitelist || [],
      },
      limits: getPlanLimits(tenant.plan, tenant.licenseCount || 1),
      usage: {
        users: 0, // TODO: Calculate actual usage
        nodes: 0,
        executionsThisMonth: 0,
        storageUsed: 0,
      },
    },
  });
});

// Helper function to get plan features
function getPlanFeatures(plan: string): string[] {
  const features: Record<string, string[]> = {
    core: ['api_access', 'email_support'],
    flow: ['webhooks', 'api_access', 'email_support', 'advanced_analytics'],
    scale: ['webhooks', 'sso', 'advanced_analytics', 'custom_roles', 'api_access', 'priority_support'],
    enterprise: ['webhooks', 'sso', 'advanced_analytics', 'custom_roles', 'api_access', 'priority_support', 'dedicated_support', 'sla_guarantee', 'custom_integrations', 'audit_logs'],
  };
  return features[plan] || features.core;
}

// Helper function to get plan limits
function getPlanLimits(plan: string, licenseCount: number): Record<string, number> {
  const baseLimits: Record<string, { users: number; nodes: number; executions: number; storage: number }> = {
    core: { users: 1, nodes: 50, executions: 10000, storage: 1 * 1024 * 1024 * 1024 },
    flow: { users: 50, nodes: 500, executions: 100000, storage: 10 * 1024 * 1024 * 1024 },
    scale: { users: 200, nodes: 5000, executions: 1000000, storage: 100 * 1024 * 1024 * 1024 },
    enterprise: { users: -1, nodes: -1, executions: -1, storage: -1 }, // Unlimited
  };

  const limits = baseLimits[plan] || baseLimits.core;

  return {
    maxUsers: limits.users === -1 ? -1 : Math.max(limits.users, licenseCount),
    maxNodes: limits.nodes,
    maxExecutionsPerMonth: limits.executions,
    maxStorage: limits.storage,
  };
}

// Apply auth middleware to remaining routes (after the public /config endpoint)
app.use('*', authMiddleware);

/**
 * GET /api/v1/tenants
 * List user's tenants with verification status (Tenant Picker)
 * Per Section 7.1
 */
app.get('/', async (c) => {
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
        logo_url: m.tenant.logoUrl,
        primary_color: m.tenant.primaryColor,
        role: {
          id: m.role.id,
          name: m.role.name,
          hierarchy_level: m.role.hierarchyLevel,
          is_protected: m.role.isProtected,
        },
        is_owner: m.isOwner,
        verification_status: {
          complete: status.complete,
          missing: status.missing,
          deadlines: status.deadlines,
        },
        trial_expires_at: m.tenant.trialExpiresAt,
        subscription_status: m.tenant.subscriptionStatus,
      };
    })
  );

  return c.json({
    tenants: tenantsWithStatus,
    count: tenantsWithStatus.length,
  });
});

// Switch tenant schema
const switchTenantSchema = z.object({
  tenant_id: z.string().uuid('Invalid tenant ID'),
});

/**
 * POST /api/v1/tenants/switch
 * Switch to a different tenant
 * Per Section 7.2
 */
app.post('/switch', zValidator('json', switchTenantSchema), async (c) => {
  const user = c.get('user') as User;
  const { tenant_id: targetTenantId } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();

  // Get target tenant
  const targetTenant = await getTenantById(targetTenantId);

  if (!targetTenant) {
    return c.json(
      {
        error: 'tenant_not_found',
        message: 'Workspace not found',
      },
      404
    );
  }

  // Verify membership
  const membership = await getTenantMembership(user.id, targetTenantId);

  if (!membership) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check verification status for target tenant
  const verificationStatus = await checkVerificationStatus(user, targetTenantId);

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'tenant_switch',
    resourceType: 'tenant',
    resourceId: targetTenantId,
    details: {
      tenant_slug: targetTenant.slug,
      verification_complete: verificationStatus.complete,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // If verification incomplete, redirect to complete-profile
  if (!verificationStatus.complete) {
    return c.json(
      {
        requires_verification: true,
        missing: verificationStatus.missing,
        deadlines: verificationStatus.deadlines,
        redirect_url: '/complete-profile',
        tenant: {
          id: targetTenant.id,
          name: targetTenant.name,
          slug: targetTenant.slug,
          type: targetTenant.type,
          plan: targetTenant.plan,
        },
      },
      403
    );
  }

  // Return tenant details for successful switch
  return c.json({
    tenant: {
      id: targetTenant.id,
      name: targetTenant.name,
      slug: targetTenant.slug,
      type: targetTenant.type,
      plan: targetTenant.plan,
      logo_url: targetTenant.logoUrl,
      primary_color: targetTenant.primaryColor,
      trial_expires_at: targetTenant.trialExpiresAt,
      subscription_status: targetTenant.subscriptionStatus,
    },
    role: {
      id: membership.primaryRoleId,
      is_owner: membership.isOwner,
    },
    redirect_url: `https://${targetTenant.slug}.zygo.tech`,
  });
});

/**
 * GET /api/v1/tenants/:tenantId
 * Get tenant details
 */
app.get('/:tenantId', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);

  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  const tenant = await getTenantById(tenantId);

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_not_found',
        message: 'Workspace not found',
      },
      404
    );
  }

  const membership = await getTenantMembership(user.id, tenantId);

  return c.json({
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    type: tenant.type,
    plan: tenant.plan,
    billing_cycle: tenant.billingCycle,
    license_count: tenant.licenseCount,
    logo_url: tenant.logoUrl,
    primary_color: tenant.primaryColor,
    custom_domain: tenant.customDomain,
    custom_domain_verified: tenant.customDomainVerified,
    industry: tenant.industry,
    company_size: tenant.companySize,
    compliance_requirements: tenant.complianceRequirements,
    trial_expires_at: tenant.trialExpiresAt,
    subscription_status: tenant.subscriptionStatus,
    status: tenant.status,
    created_at: tenant.createdAt,
    role: membership
      ? {
          id: membership.primaryRoleId,
          is_owner: membership.isOwner,
        }
      : null,
  });
});

/**
 * GET /api/v1/tenants/:tenantId/security-config
 * Get tenant security configuration
 * Requires canViewSecuritySettings permission
 */
app.get('/:tenantId/security-config', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);

  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canView = await hasPermission(user.id, tenantId, 'canViewSecuritySettings');

  if (!canView) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to view security settings',
      },
      403
    );
  }

  const config = await getTenantSecurityConfig(tenantId);

  if (!config) {
    return c.json(
      {
        error: 'config_not_found',
        message: 'Security configuration not found',
      },
      404
    );
  }

  return c.json({
    require_phone_verification: config.requirePhoneVerification,
    require_mfa: config.requireMfa,
    phone_verification_deadline_days: config.phoneVerificationDeadlineDays,
    mfa_deadline_days: config.mfaDeadlineDays,
    session_timeout_minutes: config.sessionTimeoutMinutes,
    max_concurrent_sessions: config.maxConcurrentSessions,
    password_min_length: config.passwordMinLength,
    password_require_uppercase: config.passwordRequireUppercase,
    password_require_lowercase: config.passwordRequireLowercase,
    password_require_numbers: config.passwordRequireNumbers,
    password_require_symbols: config.passwordRequireSymbols,
    password_expiry_days: config.passwordExpiryDays,
    ip_whitelist: config.ipWhitelist,
    sso_enabled: config.ssoEnabled,
    sso_provider: config.ssoProvider,
    updated_at: config.updatedAt,
  });
});

// Update security config schema
const updateSecurityConfigSchema = z.object({
  require_phone_verification: z.boolean().optional(),
  require_mfa: z.boolean().optional(),
  phone_verification_deadline_days: z.number().int().min(1).max(30).optional(),
  mfa_deadline_days: z.number().int().min(1).max(30).optional(),
  session_timeout_minutes: z.number().int().min(15).max(1440).optional(), // 15 min to 24 hours
  max_concurrent_sessions: z.number().int().min(1).max(100).optional(),
  password_min_length: z.number().int().min(8).max(128).optional(),
  password_require_uppercase: z.boolean().optional(),
  password_require_lowercase: z.boolean().optional(),
  password_require_numbers: z.boolean().optional(),
  password_require_symbols: z.boolean().optional(),
  password_expiry_days: z.number().int().min(0).max(365).nullable().optional(), // 0 or null = no expiry
});

/**
 * PATCH /api/v1/tenants/:tenantId/security-config
 * Update tenant security configuration
 * Requires canManageSecuritySettings permission
 */
app.patch(
  '/:tenantId/security-config',
  zValidator('json', updateSecurityConfigSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const updates = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);

    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageSecuritySettings');

    if (!canManage) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to manage security settings',
        },
        403
      );
    }

    // Convert snake_case to camelCase for the service
    const serviceUpdates: Parameters<typeof updateTenantSecurityConfig>[1] = {};

    if (updates.require_phone_verification !== undefined) {
      serviceUpdates.requirePhoneVerification = updates.require_phone_verification;
    }
    if (updates.require_mfa !== undefined) {
      serviceUpdates.requireMfa = updates.require_mfa;
    }
    if (updates.phone_verification_deadline_days !== undefined) {
      serviceUpdates.phoneVerificationDeadlineDays = updates.phone_verification_deadline_days;
    }
    if (updates.mfa_deadline_days !== undefined) {
      serviceUpdates.mfaDeadlineDays = updates.mfa_deadline_days;
    }
    if (updates.session_timeout_minutes !== undefined) {
      serviceUpdates.sessionTimeoutMinutes = updates.session_timeout_minutes;
    }
    if (updates.max_concurrent_sessions !== undefined) {
      serviceUpdates.maxConcurrentSessions = updates.max_concurrent_sessions;
    }

    // Update the config
    const updatedConfig = await updateTenantSecurityConfig(tenantId, serviceUpdates);

    if (!updatedConfig) {
      return c.json(
        {
          error: 'update_failed',
          message: 'Failed to update security configuration',
        },
        500
      );
    }

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'security_config_updated',
      resourceType: 'tenant_security_config',
      resourceId: tenantId,
      details: {
        updates: Object.keys(updates),
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      require_phone_verification: updatedConfig.requirePhoneVerification,
      require_mfa: updatedConfig.requireMfa,
      phone_verification_deadline_days: updatedConfig.phoneVerificationDeadlineDays,
      mfa_deadline_days: updatedConfig.mfaDeadlineDays,
      session_timeout_minutes: updatedConfig.sessionTimeoutMinutes,
      max_concurrent_sessions: updatedConfig.maxConcurrentSessions,
      password_min_length: updatedConfig.passwordMinLength,
      password_require_uppercase: updatedConfig.passwordRequireUppercase,
      password_require_lowercase: updatedConfig.passwordRequireLowercase,
      password_require_numbers: updatedConfig.passwordRequireNumbers,
      password_require_symbols: updatedConfig.passwordRequireSymbols,
      password_expiry_days: updatedConfig.passwordExpiryDays,
      ip_whitelist: updatedConfig.ipWhitelist,
      sso_enabled: updatedConfig.ssoEnabled,
      sso_provider: updatedConfig.ssoProvider,
      updated_at: updatedConfig.updatedAt,
    });
  }
);

/**
 * GET /api/v1/tenants/:tenantId/billing
 * Get tenant billing readiness status
 * Required for paid subscription upgrade
 */
app.get('/:tenantId/billing', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);

  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission (billing management)
  const canManage = await hasPermission(user.id, tenantId, 'canManageBilling');

  if (!canManage) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to view billing information',
      },
      403
    );
  }

  const billingStatus = await checkBillingReadiness(tenantId);

  return c.json({
    ready: billingStatus.ready,
    missing: billingStatus.missing,
    billing: {
      email: billingStatus.billing.email,
      address: billingStatus.billing.address,
      city: billingStatus.billing.city,
      state: billingStatus.billing.state,
      postal_code: billingStatus.billing.postalCode,
      country: billingStatus.billing.country,
    },
    company: {
      legal_name: billingStatus.company.legalName,
      tax_id: billingStatus.company.taxId,
    },
  });
});

// Update billing info schema
const updateBillingSchema = z.object({
  billing_email: z.string().email().optional(),
  billing_address: z.string().min(5).max(255).optional(),
  billing_city: z.string().min(1).max(100).optional(),
  billing_state: z.string().max(100).optional(),
  billing_postal_code: z.string().max(20).optional(),
  billing_country: z.string().length(2).optional(), // ISO 3166-1 alpha-2
  company_legal_name: z.string().min(2).max(200).optional(),
  tax_id: z.string().min(5).max(50).optional(),
});

/**
 * PATCH /api/v1/tenants/:tenantId/billing
 * Update tenant billing information
 * Required before upgrading to paid subscription
 */
app.patch(
  '/:tenantId/billing',
  zValidator('json', updateBillingSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const updates = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);

    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageBilling');

    if (!canManage) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to manage billing information',
        },
        403
      );
    }

    // Convert snake_case to camelCase
    const billingUpdates: Parameters<typeof updateTenantBilling>[1] = {};
    if (updates.billing_email !== undefined) billingUpdates.billingEmail = updates.billing_email;
    if (updates.billing_address !== undefined) billingUpdates.billingAddress = updates.billing_address;
    if (updates.billing_city !== undefined) billingUpdates.billingCity = updates.billing_city;
    if (updates.billing_state !== undefined) billingUpdates.billingState = updates.billing_state;
    if (updates.billing_postal_code !== undefined) billingUpdates.billingPostalCode = updates.billing_postal_code;
    if (updates.billing_country !== undefined) billingUpdates.billingCountry = updates.billing_country;
    if (updates.company_legal_name !== undefined) billingUpdates.companyLegalName = updates.company_legal_name;
    if (updates.tax_id !== undefined) billingUpdates.taxId = updates.tax_id;

    const updated = await updateTenantBilling(tenantId, billingUpdates);

    if (!updated) {
      return c.json(
        {
          error: 'update_failed',
          message: 'Failed to update billing information',
        },
        500
      );
    }

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'billing_info_updated',
      resourceType: 'tenant',
      resourceId: tenantId,
      details: {
        fields_updated: Object.keys(updates),
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    // Return updated billing readiness
    const billingStatus = await checkBillingReadiness(tenantId);

    return c.json({
      ready: billingStatus.ready,
      missing: billingStatus.missing,
      billing: {
        email: billingStatus.billing.email,
        address: billingStatus.billing.address,
        city: billingStatus.billing.city,
        state: billingStatus.billing.state,
        postal_code: billingStatus.billing.postalCode,
        country: billingStatus.billing.country,
      },
      company: {
        legal_name: billingStatus.company.legalName,
        tax_id: billingStatus.company.taxId,
      },
    });
  }
);

// Mount SSO routes (Enterprise)
app.route('/', ssoRoutes);

// Mount Domain routes (Enterprise)
app.route('/', domainsRoutes);

export default app;
