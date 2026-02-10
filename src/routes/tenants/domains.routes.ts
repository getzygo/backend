/**
 * Domain Claiming Routes
 *
 * Phase 5: Enterprise - Domain Claiming
 *
 * GET /api/v1/tenants/:tenantId/domains - List claimed domains
 * POST /api/v1/tenants/:tenantId/domains - Claim a domain
 * DELETE /api/v1/tenants/:tenantId/domains/:domain - Release a domain
 * POST /api/v1/tenants/:tenantId/domains/:domain/verify - Verify domain ownership
 *
 * Per UNIFIED_AUTH_STRATEGY.md Section 11.
 * Domain claiming is available only for Enterprise plan tenants.
 * Claimed domains show a warning to users signing up with that domain.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, or } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getTenantById, isTenantMember } from '../../services/tenant.service';
import { hasPermission } from '../../services/permission.service';
import { getDb } from '../../db/client';
import { auditLogs, tenants } from '../../db/schema';
import { getRedis, REDIS_KEYS } from '../../db/redis';
import crypto from 'crypto';
import type { User } from '../../db/schema';

const app = new Hono();

// Apply auth middleware
app.use('*', authMiddleware);

// Domain verification TTL: 7 days
const VERIFICATION_TTL = 7 * 24 * 60 * 60;

interface ClaimedDomain {
  domain: string;
  verified: boolean;
  verification_token?: string;
  verification_method?: 'dns' | 'meta';
  claimed_at: string;
  verified_at?: string;
}

/**
 * Get domain claims key for a tenant
 */
function getDomainsKey(tenantId: string): string {
  return `${REDIS_KEYS.TENANT_CONFIG}domains:${tenantId}`;
}

/**
 * Get claimed domains for a tenant
 */
async function getClaimedDomains(tenantId: string): Promise<ClaimedDomain[]> {
  const redis = getRedis();
  const key = getDomainsKey(tenantId);
  const data = await redis.get(key);
  if (!data) return [];
  try {
    return JSON.parse(data) as ClaimedDomain[];
  } catch {
    return [];
  }
}

/**
 * Save claimed domains for a tenant
 */
async function saveClaimedDomains(tenantId: string, domains: ClaimedDomain[]): Promise<void> {
  const redis = getRedis();
  const key = getDomainsKey(tenantId);
  // Store permanently (enterprise feature)
  await redis.set(key, JSON.stringify(domains));
}

/**
 * Generate a DNS verification token
 */
function generateVerificationToken(): string {
  return `zygo-verify-${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Check if domain is already claimed by any tenant
 */
async function isDomainClaimed(domain: string, excludeTenantId?: string): Promise<boolean> {
  // In a real implementation, this would check all tenants
  // For now, we use a global index
  const redis = getRedis();
  const indexKey = `${REDIS_KEYS.TENANT_CONFIG}domain-index:${domain.toLowerCase()}`;
  const claimedBy = await redis.get(indexKey);
  if (!claimedBy) return false;
  if (excludeTenantId && claimedBy === excludeTenantId) return false;
  return true;
}

/**
 * Update domain index
 */
async function updateDomainIndex(domain: string, tenantId: string | null): Promise<void> {
  const redis = getRedis();
  const indexKey = `${REDIS_KEYS.TENANT_CONFIG}domain-index:${domain.toLowerCase()}`;
  if (tenantId) {
    await redis.set(indexKey, tenantId);
  } else {
    await redis.del(indexKey);
  }
}

// Validate domain format
const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// Claim domain schema
const claimDomainSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .regex(domainRegex, 'Invalid domain format')
    .transform((d) => d.toLowerCase()),
});

/**
 * GET /api/v1/tenants/:tenantId/domains
 * List claimed domains for tenant
 */
app.get('/:tenantId/domains', async (c) => {
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
  const canView = await hasPermission(user.id, tenantId, 'canViewTenantSettings');
  if (!canView) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to view domain settings',
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
        message: 'Domain claiming is only available on Enterprise plan',
        available_on: 'enterprise',
      },
      403
    );
  }

  const domains = await getClaimedDomains(tenantId);

  // Mask verification tokens for response
  const response = domains.map((d) => ({
    ...d,
    verification_token: d.verified ? undefined : d.verification_token,
  }));

  return c.json({
    domains: response,
    count: domains.length,
  });
});

/**
 * POST /api/v1/tenants/:tenantId/domains
 * Claim a domain
 */
app.post('/:tenantId/domains', zValidator('json', claimDomainSchema), async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const { domain } = c.req.valid('json');
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
  const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
  if (!canManage) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to manage domain settings',
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
        message: 'Domain claiming is only available on Enterprise plan',
        available_on: 'enterprise',
      },
      403
    );
  }

  // Check if domain is already claimed
  const alreadyClaimed = await isDomainClaimed(domain, tenantId);
  if (alreadyClaimed) {
    return c.json(
      {
        error: 'domain_already_claimed',
        message: 'This domain is already claimed by another organization',
      },
      409
    );
  }

  // Get current domains
  const domains = await getClaimedDomains(tenantId);

  // Check if already claimed by this tenant
  if (domains.some((d) => d.domain === domain)) {
    return c.json(
      {
        error: 'domain_exists',
        message: 'This domain is already claimed by your organization',
      },
      409
    );
  }

  // Generate verification token
  const verificationToken = generateVerificationToken();

  // Add new domain
  const newDomain: ClaimedDomain = {
    domain,
    verified: false,
    verification_token: verificationToken,
    verification_method: 'dns',
    claimed_at: new Date().toISOString(),
  };

  domains.push(newDomain);
  await saveClaimedDomains(tenantId, domains);
  await updateDomainIndex(domain, tenantId);

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    tenantId,
    action: 'domain_claimed',
    resourceType: 'tenant',
    resourceId: tenantId,
    details: { domain },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    domain,
    verified: false,
    verification_token: verificationToken,
    verification_method: 'dns',
    verification_instructions: {
      type: 'TXT',
      name: `_zygo-verify.${domain}`,
      value: verificationToken,
      ttl: 3600,
    },
    message: 'Domain claimed. Please add the DNS TXT record to verify ownership.',
  });
});

/**
 * POST /api/v1/tenants/:tenantId/domains/:domain/verify
 * Verify domain ownership
 */
app.post('/:tenantId/domains/:domain/verify', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const domain = c.req.param('domain').toLowerCase();
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
  const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
  if (!canManage) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to manage domain settings',
      },
      403
    );
  }

  // Get domains
  const domains = await getClaimedDomains(tenantId);
  const domainRecord = domains.find((d) => d.domain === domain);

  if (!domainRecord) {
    return c.json(
      {
        error: 'domain_not_found',
        message: 'Domain not found in claimed domains',
      },
      404
    );
  }

  if (domainRecord.verified) {
    return c.json({
      domain,
      verified: true,
      message: 'Domain is already verified',
    });
  }

  // In a real implementation, we would check DNS TXT record
  // For now, we simulate the check
  // TODO: Actually query DNS for TXT record
  const dnsVerified = await checkDnsTxtRecord(domain, domainRecord.verification_token!);

  if (!dnsVerified) {
    return c.json(
      {
        error: 'verification_failed',
        message: 'DNS TXT record not found or does not match',
        expected_record: {
          type: 'TXT',
          name: `_zygo-verify.${domain}`,
          value: domainRecord.verification_token,
        },
      },
      400
    );
  }

  // Mark as verified
  domainRecord.verified = true;
  domainRecord.verified_at = new Date().toISOString();
  delete domainRecord.verification_token;

  await saveClaimedDomains(tenantId, domains);

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    tenantId,
    action: 'domain_verified',
    resourceType: 'tenant',
    resourceId: tenantId,
    details: { domain },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    domain,
    verified: true,
    verified_at: domainRecord.verified_at,
    message: 'Domain ownership verified successfully',
  });
});

/**
 * DELETE /api/v1/tenants/:tenantId/domains/:domain
 * Release a claimed domain
 */
app.delete('/:tenantId/domains/:domain', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const domain = c.req.param('domain').toLowerCase();
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
  const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
  if (!canManage) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to manage domain settings',
      },
      403
    );
  }

  // Get domains
  const domains = await getClaimedDomains(tenantId);
  const domainIndex = domains.findIndex((d) => d.domain === domain);

  if (domainIndex === -1) {
    return c.json(
      {
        error: 'domain_not_found',
        message: 'Domain not found in claimed domains',
      },
      404
    );
  }

  // Remove domain
  domains.splice(domainIndex, 1);
  await saveClaimedDomains(tenantId, domains);
  await updateDomainIndex(domain, null);

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    tenantId,
    action: 'domain_released',
    resourceType: 'tenant',
    resourceId: tenantId,
    details: { domain },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    success: true,
    message: 'Domain released successfully',
  });
});

/**
 * Check DNS TXT record (placeholder implementation)
 * In production, use a DNS library like dns.promises.resolve
 */
async function checkDnsTxtRecord(domain: string, expectedValue: string): Promise<boolean> {
  try {
    // In production:
    // const dns = await import('dns/promises');
    // const records = await dns.resolveTxt(`_zygo-verify.${domain}`);
    // return records.flat().some(r => r === expectedValue);

    // For now, return false (manual verification required)
    // The admin can mark it as verified through a separate admin endpoint
    console.log(`DNS check for _zygo-verify.${domain}: expecting ${expectedValue}`);
    return false;
  } catch (error) {
    console.error('DNS lookup failed:', error);
    return false;
  }
}

/**
 * Check if an email domain is claimed (public endpoint)
 */
export async function checkDomainClaimed(
  emailDomain: string
): Promise<{ claimed: boolean; tenantId?: string; tenantName?: string }> {
  const redis = getRedis();
  const indexKey = `${REDIS_KEYS.TENANT_CONFIG}domain-index:${emailDomain.toLowerCase()}`;
  const tenantId = await redis.get(indexKey);

  if (!tenantId) {
    return { claimed: false };
  }

  const db = getDb();
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { id: true, name: true },
  });

  if (!tenant) {
    return { claimed: false };
  }

  return {
    claimed: true,
    tenantId: tenant.id,
    tenantName: tenant.name,
  };
}

export default app;
