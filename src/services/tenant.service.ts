/**
 * Tenant Service
 *
 * Handles tenant CRUD operations and security configuration.
 * Per UNIFIED_AUTH_STRATEGY.md Section 15.
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  tenants,
  tenantSecurityConfig,
  tenantMembers,
  roles,
  rolePermissions,
  permissions,
  type Tenant,
  type NewTenant,
  type TenantSecurityConfig,
  type NewTenantSecurityConfig,
  type Role,
  type TenantMember,
} from '../db/schema';
import { invalidateTenantConfigCache } from './verification.service';

// Trial period in days
const TRIAL_PERIOD_DAYS = 14;

/**
 * Validate tenant slug format
 */
export function isValidSlug(slug: string): boolean {
  // Lowercase alphanumeric with hyphens, 3-50 chars, can't start/end with hyphen
  const slugRegex = /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/;
  return slugRegex.test(slug);
}

/**
 * Check if a slug is reserved
 */
export function isReservedSlug(slug: string): boolean {
  const reserved = [
    'api',
    'app',
    'www',
    'admin',
    'help',
    'support',
    'blog',
    'docs',
    'status',
    'mail',
    'ftp',
    'ssh',
    'test',
    'dev',
    'staging',
    'prod',
    'production',
    'zygo',
    'auth',
    'login',
    'signup',
    'register',
    'account',
    'settings',
    'billing',
    'dashboard',
  ];

  return reserved.includes(slug.toLowerCase());
}

/**
 * Check if a slug is available
 */
export async function isSlugAvailable(slug: string): Promise<boolean> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) {
    return false;
  }

  const db = getDb();
  const existing = await db.query.tenants.findFirst({
    where: eq(tenants.slug, slug.toLowerCase()),
    columns: { id: true },
  });

  return !existing;
}

/**
 * Get tenant by slug
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const db = getDb();

  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.slug, slug.toLowerCase()), eq(tenants.status, 'active')),
  });

  return tenant || null;
}

/**
 * Get tenant by ID
 */
export async function getTenantById(id: string): Promise<Tenant | null> {
  const db = getDb();

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, id),
  });

  return tenant || null;
}

/**
 * Get all tenants a user belongs to
 */
export async function getUserTenants(userId: string): Promise<(TenantMember & { tenant: Tenant; role: Role })[]> {
  const db = getDb();

  const memberships = await db.query.tenantMembers.findMany({
    where: and(eq(tenantMembers.userId, userId), eq(tenantMembers.status, 'active')),
    with: {
      tenant: true,
      primaryRole: true,
    },
  });

  return memberships.map((m) => ({
    ...m,
    tenant: m.tenant as Tenant,
    role: m.primaryRole as Role,
  }));
}

/**
 * Get tenant security config
 */
export async function getTenantSecurityConfig(
  tenantId: string
): Promise<TenantSecurityConfig | null> {
  const db = getDb();

  const config = await db.query.tenantSecurityConfig.findFirst({
    where: eq(tenantSecurityConfig.tenantId, tenantId),
  });

  return config || null;
}

/**
 * Create a new tenant with default security config
 */
export async function createTenant(params: {
  name: string;
  slug: string;
  type: 'personal' | 'organization';
  ownerUserId: string;
}): Promise<{
  tenant: Tenant;
  securityConfig: TenantSecurityConfig;
  ownerRole: Role;
  membership: TenantMember;
} | null> {
  const { name, slug, type, ownerUserId } = params;

  // Validate slug
  if (!isValidSlug(slug)) {
    throw new Error('Invalid slug format');
  }

  if (isReservedSlug(slug)) {
    throw new Error('This slug is reserved');
  }

  const db = getDb();

  // Check if slug is available
  const existing = await getTenantBySlug(slug);
  if (existing) {
    throw new Error('Slug already taken');
  }

  // Calculate trial expiration
  const trialExpiresAt = new Date();
  trialExpiresAt.setDate(trialExpiresAt.getDate() + TRIAL_PERIOD_DAYS);

  // Create tenant
  const newTenant: NewTenant = {
    name,
    slug: slug.toLowerCase(),
    type,
    plan: 'free',
    trialExpiresAt,
    subscriptionStatus: 'trialing',
    status: 'active',
  };

  const [tenant] = await db.insert(tenants).values(newTenant).returning();

  // Create default security config
  const newConfig: NewTenantSecurityConfig = {
    tenantId: tenant.id,
    requirePhoneVerification: true,
    requireMfa: true,
    phoneVerificationDeadlineDays: 3,
    mfaDeadlineDays: 7,
  };

  const [securityConfig] = await db
    .insert(tenantSecurityConfig)
    .values(newConfig)
    .returning();

  // Create Owner role (protected)
  const [ownerRole] = await db
    .insert(roles)
    .values({
      tenantId: tenant.id,
      name: 'Owner',
      slug: 'owner',
      description: 'Full access to all tenant features',
      hierarchyLevel: 1,
      isSystem: true,
      isProtected: true,
      createdBy: ownerUserId,
    })
    .returning();

  // Grant all permissions to Owner role
  const allPermissions = await db.select().from(permissions);

  if (allPermissions.length > 0) {
    const rolePermissionValues = allPermissions.map((permission) => ({
      roleId: ownerRole.id,
      permissionId: permission.id,
      tenantId: tenant.id,
      grantedBy: ownerUserId,
    }));

    await db.insert(rolePermissions).values(rolePermissionValues);
  }

  // Create tenant membership for owner
  const [membership] = await db
    .insert(tenantMembers)
    .values({
      tenantId: tenant.id,
      userId: ownerUserId,
      primaryRoleId: ownerRole.id,
      isOwner: true,
      status: 'active',
      joinedAt: new Date(),
    })
    .returning();

  return {
    tenant,
    securityConfig,
    ownerRole,
    membership,
  };
}

/**
 * Update tenant details
 */
export async function updateTenant(
  tenantId: string,
  updates: Partial<Pick<Tenant, 'name' | 'logoUrl' | 'primaryColor'>>
): Promise<Tenant | null> {
  const db = getDb();

  const [updated] = await db
    .update(tenants)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId))
    .returning();

  return updated || null;
}

/**
 * Update tenant security config
 */
export async function updateTenantSecurityConfig(
  tenantId: string,
  updates: Partial<
    Pick<
      TenantSecurityConfig,
      | 'requirePhoneVerification'
      | 'requireMfa'
      | 'phoneVerificationDeadlineDays'
      | 'mfaDeadlineDays'
      | 'sessionTimeoutMinutes'
      | 'maxConcurrentSessions'
    >
  >
): Promise<TenantSecurityConfig | null> {
  const db = getDb();

  const [updated] = await db
    .update(tenantSecurityConfig)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(tenantSecurityConfig.tenantId, tenantId))
    .returning();

  // Invalidate cache
  await invalidateTenantConfigCache(tenantId);

  return updated || null;
}

/**
 * Check if user is a member of a tenant
 */
export async function isTenantMember(
  userId: string,
  tenantId: string
): Promise<boolean> {
  const db = getDb();

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.status, 'active')
    ),
    columns: { id: true },
  });

  return !!membership;
}

/**
 * Check if user is the owner of a tenant
 */
export async function isTenantOwner(
  userId: string,
  tenantId: string
): Promise<boolean> {
  const db = getDb();

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.isOwner, true),
      eq(tenantMembers.status, 'active')
    ),
    columns: { id: true },
  });

  return !!membership;
}

/**
 * Get tenant membership for a user
 */
export async function getTenantMembership(
  userId: string,
  tenantId: string
): Promise<TenantMember | null> {
  const db = getDb();

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.status, 'active')
    ),
  });

  return membership || null;
}

export const tenantService = {
  isValidSlug,
  isReservedSlug,
  isSlugAvailable,
  getTenantBySlug,
  getTenantById,
  getUserTenants,
  getTenantSecurityConfig,
  createTenant,
  updateTenant,
  updateTenantSecurityConfig,
  isTenantMember,
  isTenantOwner,
  getTenantMembership,
};
