/**
 * SSO Configuration Routes
 *
 * Phase 5: Enterprise - SAML/OIDC Configuration
 *
 * GET /api/v1/tenants/:tenantId/sso - Get SSO configuration
 * PUT /api/v1/tenants/:tenantId/sso - Configure SSO
 * DELETE /api/v1/tenants/:tenantId/sso - Disable SSO
 * POST /api/v1/tenants/:tenantId/sso/test - Test SSO configuration
 *
 * Per UNIFIED_AUTH_STRATEGY.md Section 14.
 * SSO is available only for Enterprise plan tenants.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getTenantById, getTenantSecurityConfig, isTenantMember } from '../../services/tenant.service';
import { hasPermission } from '../../services/permission.service';
import { getDb } from '../../db/client';
import { tenantSecurityConfig, auditLogs } from '../../db/schema';
import type { User } from '../../db/schema';

const app = new Hono();

// Apply auth middleware
app.use('*', authMiddleware);

// SAML configuration schema
const samlConfigSchema = z.object({
  entity_id: z.string().url('Entity ID must be a valid URL'),
  sso_url: z.string().url('SSO URL must be a valid URL'),
  certificate: z.string().min(1, 'Certificate is required'),
  sign_request: z.boolean().optional().default(false),
  want_assertions_signed: z.boolean().optional().default(true),
});

// OIDC configuration schema
const oidcConfigSchema = z.object({
  issuer: z.string().url('Issuer must be a valid URL'),
  client_id: z.string().min(1, 'Client ID is required'),
  client_secret: z.string().min(1, 'Client secret is required'),
  authorization_endpoint: z.string().url().optional(),
  token_endpoint: z.string().url().optional(),
  userinfo_endpoint: z.string().url().optional(),
  jwks_uri: z.string().url().optional(),
  scopes: z.array(z.string()).optional().default(['openid', 'profile', 'email']),
});

// SSO configuration schema
const ssoConfigSchema = z.object({
  provider: z.enum(['saml', 'oidc']),
  config: z.union([samlConfigSchema, oidcConfigSchema]),
  auto_provision_users: z.boolean().optional().default(false),
  default_role_id: z.string().uuid().optional(),
});

/**
 * GET /api/v1/tenants/:tenantId/sso
 * Get SSO configuration for tenant
 */
app.get('/:tenantId/sso', async (c) => {
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
        message: 'You do not have permission to view SSO settings',
      },
      403
    );
  }

  // Get tenant
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return c.json({ error: 'tenant_not_found', message: 'Workspace not found' }, 404);
  }

  // Check enterprise plan
  if (tenant.plan !== 'enterprise') {
    return c.json(
      {
        error: 'plan_required',
        message: 'SSO is only available on Enterprise plan',
        available_on: 'enterprise',
      },
      403
    );
  }

  // Get security config
  const config = await getTenantSecurityConfig(tenantId);
  if (!config) {
    return c.json({ error: 'config_not_found', message: 'Security configuration not found' }, 404);
  }

  // Mask sensitive data
  const ssoConfig = config.ssoConfig as Record<string, unknown> | null;
  let maskedConfig = null;

  if (ssoConfig) {
    maskedConfig = { ...ssoConfig };
    // Mask sensitive fields
    if ('client_secret' in maskedConfig) {
      maskedConfig.client_secret = '********';
    }
    if ('certificate' in maskedConfig) {
      maskedConfig.certificate = maskedConfig.certificate
        ? `${String(maskedConfig.certificate).slice(0, 50)}...`
        : null;
    }
  }

  return c.json({
    enabled: config.ssoEnabled,
    provider: config.ssoProvider,
    config: maskedConfig,
  });
});

/**
 * PUT /api/v1/tenants/:tenantId/sso
 * Configure SSO for tenant
 */
app.put('/:tenantId/sso', zValidator('json', ssoConfigSchema), async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const body = c.req.valid('json');
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
        message: 'You do not have permission to manage SSO settings',
      },
      403
    );
  }

  // Get tenant
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return c.json({ error: 'tenant_not_found', message: 'Workspace not found' }, 404);
  }

  // Check enterprise plan
  if (tenant.plan !== 'enterprise') {
    return c.json(
      {
        error: 'plan_required',
        message: 'SSO is only available on Enterprise plan',
        available_on: 'enterprise',
      },
      403
    );
  }

  // Update security config
  const [updated] = await db
    .update(tenantSecurityConfig)
    .set({
      ssoEnabled: true,
      ssoProvider: body.provider,
      ssoConfig: body.config,
      updatedAt: new Date(),
    })
    .where(eq(tenantSecurityConfig.tenantId, tenantId))
    .returning();

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'sso_configured',
    resourceType: 'tenant_security_config',
    resourceId: tenantId,
    details: {
      provider: body.provider,
      auto_provision: body.auto_provision_users,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    success: true,
    enabled: updated.ssoEnabled,
    provider: updated.ssoProvider,
    message: `SSO configured with ${body.provider.toUpperCase()}`,
  });
});

/**
 * DELETE /api/v1/tenants/:tenantId/sso
 * Disable SSO for tenant
 */
app.delete('/:tenantId/sso', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
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
        message: 'You do not have permission to manage SSO settings',
      },
      403
    );
  }

  // Disable SSO
  await db
    .update(tenantSecurityConfig)
    .set({
      ssoEnabled: false,
      ssoProvider: null,
      ssoConfig: {},
      updatedAt: new Date(),
    })
    .where(eq(tenantSecurityConfig.tenantId, tenantId));

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'sso_disabled',
    resourceType: 'tenant_security_config',
    resourceId: tenantId,
    details: {},
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    success: true,
    message: 'SSO has been disabled',
  });
});

/**
 * POST /api/v1/tenants/:tenantId/sso/test
 * Test SSO configuration
 */
app.post('/:tenantId/sso/test', async (c) => {
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
  const canManage = await hasPermission(user.id, tenantId, 'canManageSecuritySettings');
  if (!canManage) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to test SSO settings',
      },
      403
    );
  }

  // Get security config
  const config = await getTenantSecurityConfig(tenantId);
  if (!config || !config.ssoEnabled) {
    return c.json(
      {
        error: 'sso_not_configured',
        message: 'SSO is not configured for this workspace',
      },
      400
    );
  }

  const ssoConfig = config.ssoConfig as Record<string, unknown>;

  // Basic validation of SSO configuration
  if (config.ssoProvider === 'saml') {
    if (!ssoConfig.entity_id || !ssoConfig.sso_url || !ssoConfig.certificate) {
      return c.json({
        success: false,
        error: 'incomplete_config',
        message: 'SAML configuration is incomplete',
        missing: ['entity_id', 'sso_url', 'certificate'].filter(
          (k) => !ssoConfig[k]
        ),
      });
    }

    // TODO: Actually test SAML endpoint connectivity
    return c.json({
      success: true,
      provider: 'saml',
      message: 'SAML configuration appears valid',
      checks: {
        entity_id: true,
        sso_url: true,
        certificate: true,
      },
    });
  }

  if (config.ssoProvider === 'oidc') {
    if (!ssoConfig.issuer || !ssoConfig.client_id || !ssoConfig.client_secret) {
      return c.json({
        success: false,
        error: 'incomplete_config',
        message: 'OIDC configuration is incomplete',
        missing: ['issuer', 'client_id', 'client_secret'].filter(
          (k) => !ssoConfig[k]
        ),
      });
    }

    // TODO: Actually test OIDC discovery endpoint
    return c.json({
      success: true,
      provider: 'oidc',
      message: 'OIDC configuration appears valid',
      checks: {
        issuer: true,
        client_id: true,
        client_secret: true,
      },
    });
  }

  return c.json({
    success: false,
    error: 'unknown_provider',
    message: `Unknown SSO provider: ${config.ssoProvider}`,
  });
});

export default app;
