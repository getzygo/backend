/**
 * Tenant Context Middleware
 *
 * Extracts tenant from subdomain or header and validates membership.
 * Per UNIFIED_AUTH_STRATEGY.md URL structure.
 */

import { Context, Next } from 'hono';
import { getTenantBySlug, isTenantMember, getTenantMembership } from '../services/tenant.service';
import type { User, Tenant, TenantMember } from '../db/schema';

// Extend Hono context
declare module 'hono' {
  interface ContextVariableMap {
    tenant: Tenant;
    tenantId: string;
    membership: TenantMember;
  }
}

/**
 * Extract tenant slug from request
 * Checks in order: subdomain, X-Zygo-Tenant-Slug header, query param
 */
function extractTenantSlug(c: Context): string | null {
  // 1. Check header first (for API clients)
  const headerSlug = c.req.header('X-Zygo-Tenant-Slug');
  if (headerSlug) {
    return headerSlug.toLowerCase();
  }

  // 2. Check query param (for specific cases)
  const querySlug = c.req.query('tenant_slug');
  if (querySlug) {
    return querySlug.toLowerCase();
  }

  // 3. Extract from subdomain (e.g., demo.zygo.tech)
  const host = c.req.header('host') || '';

  // Match pattern: {slug}.zygo.tech or {slug}.localhost:3000
  const subdomainMatch = host.match(/^([a-z0-9][a-z0-9-]*[a-z0-9])\.(?:zygo\.tech|localhost(?::\d+)?)/i);
  if (subdomainMatch) {
    return subdomainMatch[1].toLowerCase();
  }

  return null;
}

/**
 * Tenant middleware - extracts and validates tenant from subdomain/header
 * Does NOT require authentication - use for public tenant pages
 */
export async function tenantMiddleware(c: Context, next: Next) {
  const slug = extractTenantSlug(c);

  if (!slug) {
    return c.json(
      {
        error: 'bad_request',
        message: 'Tenant not specified. Use subdomain or X-Zygo-Tenant-Slug header.',
      },
      400
    );
  }

  const tenant = await getTenantBySlug(slug);

  if (!tenant) {
    return c.json(
      {
        error: 'not_found',
        message: 'Workspace not found',
      },
      404
    );
  }

  if (tenant.status !== 'active') {
    return c.json(
      {
        error: 'forbidden',
        message: tenant.status === 'suspended'
          ? 'This workspace has been suspended'
          : 'This workspace is not available',
      },
      403
    );
  }

  c.set('tenant', tenant);
  c.set('tenantId', tenant.id);

  await next();
}

/**
 * Optional tenant middleware - sets tenant if found, but doesn't require it
 */
export async function optionalTenantMiddleware(c: Context, next: Next) {
  const slug = extractTenantSlug(c);

  if (slug) {
    const tenant = await getTenantBySlug(slug);
    if (tenant && tenant.status === 'active') {
      c.set('tenant', tenant);
      c.set('tenantId', tenant.id);
    }
  }

  await next();
}

/**
 * Tenant membership middleware
 * Requires user to be a member of the tenant
 * Use after authMiddleware and tenantMiddleware
 */
export async function requireTenantMembership(c: Context, next: Next) {
  const user = c.get('user') as User;
  const tenant = c.get('tenant') as Tenant;

  if (!user) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'Authentication required',
      },
      401
    );
  }

  if (!tenant) {
    return c.json(
      {
        error: 'bad_request',
        message: 'Tenant context required',
      },
      400
    );
  }

  const membership = await getTenantMembership(user.id, tenant.id);

  if (!membership) {
    return c.json(
      {
        error: 'forbidden',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  if (membership.status !== 'active') {
    return c.json(
      {
        error: 'forbidden',
        message: 'Your membership in this workspace is not active',
      },
      403
    );
  }

  c.set('membership', membership);

  await next();
}

/**
 * Tenant owner middleware
 * Requires user to be the owner of the tenant
 * Use after authMiddleware and tenantMiddleware
 */
export async function requireTenantOwner(c: Context, next: Next) {
  const user = c.get('user') as User;
  const tenant = c.get('tenant') as Tenant;

  if (!user) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'Authentication required',
      },
      401
    );
  }

  if (!tenant) {
    return c.json(
      {
        error: 'bad_request',
        message: 'Tenant context required',
      },
      400
    );
  }

  const membership = await getTenantMembership(user.id, tenant.id);

  if (!membership || !membership.isOwner) {
    return c.json(
      {
        error: 'forbidden',
        message: 'Owner access required',
      },
      403
    );
  }

  c.set('membership', membership);

  await next();
}

/**
 * Create tenant context from slug (for use in route handlers)
 */
export async function resolveTenantFromSlug(slug: string): Promise<Tenant | null> {
  return getTenantBySlug(slug);
}

export const tenantMiddlewareExports = {
  tenantMiddleware,
  optionalTenantMiddleware,
  requireTenantMembership,
  requireTenantOwner,
  resolveTenantFromSlug,
};
