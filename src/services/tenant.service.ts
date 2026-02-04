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
  users,
  type Tenant,
  type NewTenant,
  type TenantSecurityConfig,
  type NewTenantSecurityConfig,
  type Role,
  type TenantMember,
  type User,
} from '../db/schema';
import { invalidateTenantConfigCache } from './verification.service';
import { isValidSlug, isBlockedSlug } from '../utils/slug-validation';

// Re-export for backwards compatibility
export { isValidSlug, isBlockedSlug };

// Trial period in days
const TRIAL_PERIOD_DAYS = 14;

/**
 * Check if user has already used their trial period
 */
export async function hasUserUsedTrial(userId: string): Promise<boolean> {
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { hasUsedTrial: true },
  });

  return user?.hasUsedTrial ?? false;
}

/**
 * Check if user already has a Core plan tenant
 * Users are limited to 1 Core (free) subscription per email
 */
export async function userHasCorePlanTenant(userId: string): Promise<boolean> {
  const db = getDb();

  // Get all active tenant memberships where user is owner
  const memberships = await db.query.tenantMembers.findMany({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.isOwner, true),
      eq(tenantMembers.status, 'active')
    ),
    with: {
      tenant: {
        columns: { plan: true, status: true },
      },
    },
  });

  // Check if any owned tenant has Core plan
  return memberships.some((m) => {
    const tenant = Array.isArray(m.tenant) ? m.tenant[0] : m.tenant;
    return tenant?.plan === 'core' && tenant?.status === 'active';
  });
}

/**
 * Mark user as having used their trial
 */
async function markTrialUsed(userId: string): Promise<void> {
  const db = getDb();

  await db
    .update(users)
    .set({
      hasUsedTrial: true,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Check if a slug is available
 */
export async function isSlugAvailable(slug: string): Promise<boolean> {
  if (!isValidSlug(slug) || isBlockedSlug(slug)) {
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
 *
 * Limitations enforced:
 * 1. Only 1 trial period per email (first signup counts)
 * 2. Only 1 Core subscription per email address
 */
export async function createTenant(params: {
  name: string;
  slug: string;
  type: 'personal' | 'organization';
  ownerUserId: string;
  plan?: 'core' | 'flow' | 'scale' | 'enterprise';
}): Promise<{
  tenant: Tenant;
  securityConfig: TenantSecurityConfig;
  ownerRole: Role;
  membership: TenantMember;
} | null> {
  const { name, slug, type, ownerUserId, plan = 'core' } = params;

  // Validate slug
  if (!isValidSlug(slug)) {
    throw new Error('Invalid slug format');
  }

  if (isBlockedSlug(slug)) {
    throw new Error('This slug is reserved');
  }

  const db = getDb();

  // Check if slug is available
  const existing = await getTenantBySlug(slug);
  if (existing) {
    throw new Error('Slug already taken');
  }

  // LIMITATION: Only 1 Core subscription per email
  if (plan === 'core') {
    const hasCore = await userHasCorePlanTenant(ownerUserId);
    if (hasCore) {
      throw new Error('You can only have one Core (free) workspace. Please upgrade to create additional workspaces.');
    }
  }

  // LIMITATION: Only 1 trial period per email
  const usedTrial = await hasUserUsedTrial(ownerUserId);
  let trialExpiresAt: Date | null = null;
  let subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' = 'active';

  if (!usedTrial) {
    // First time user - grant trial period
    trialExpiresAt = new Date();
    trialExpiresAt.setDate(trialExpiresAt.getDate() + TRIAL_PERIOD_DAYS);
    subscriptionStatus = 'trialing';
  }
  // If user has already used trial, they start with 'active' status and no trial

  // Create tenant
  const newTenant: NewTenant = {
    name,
    slug: slug.toLowerCase(),
    type,
    plan,
    trialExpiresAt,
    subscriptionStatus,
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

  // Mark user as having used their trial (if this was their first tenant)
  if (!usedTrial && subscriptionStatus === 'trialing') {
    await markTrialUsed(ownerUserId);
  }

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

/**
 * Get tenant membership with role details
 */
export async function getTenantMembershipWithRole(
  userId: string,
  tenantId: string
): Promise<(TenantMember & { role: Role }) | null> {
  const db = getDb();

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.status, 'active')
    ),
    with: {
      primaryRole: true,
    },
  });

  if (!membership || !membership.primaryRole) {
    return null;
  }

  const role = Array.isArray(membership.primaryRole) ? membership.primaryRole[0] : membership.primaryRole;
  if (!role) {
    return null;
  }

  return {
    ...membership,
    role,
  };
}

/**
 * Billing readiness status
 */
export interface BillingReadiness {
  ready: boolean;
  missing: ('billing_address' | 'billing_country' | 'company_legal_name' | 'tax_id')[];
  billing: {
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
  company: {
    legalName: string | null;
    taxId: string | null;
  };
}

/**
 * Check if tenant has complete billing information for paid subscription
 * Required before upgrading from Core to any paid plan
 */
export async function checkBillingReadiness(tenantId: string): Promise<BillingReadiness> {
  const tenant = await getTenantById(tenantId);

  if (!tenant) {
    return {
      ready: false,
      missing: ['billing_address', 'billing_country', 'company_legal_name', 'tax_id'],
      billing: {
        email: null,
        address: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
      },
      company: {
        legalName: null,
        taxId: null,
      },
    };
  }

  const missing: BillingReadiness['missing'] = [];

  // Check billing address (address + country required)
  if (!tenant.billingAddress || !tenant.billingAddress.trim()) {
    missing.push('billing_address');
  }
  if (!tenant.billingCountry || !tenant.billingCountry.trim()) {
    missing.push('billing_country');
  }

  // Check company tax info
  if (!tenant.companyLegalName || !tenant.companyLegalName.trim()) {
    missing.push('company_legal_name');
  }
  if (!tenant.taxId || !tenant.taxId.trim()) {
    missing.push('tax_id');
  }

  return {
    ready: missing.length === 0,
    missing,
    billing: {
      email: tenant.billingEmail || null,
      address: tenant.billingAddress || null,
      city: tenant.billingCity || null,
      state: tenant.billingState || null,
      postalCode: tenant.billingPostalCode || null,
      country: tenant.billingCountry || null,
    },
    company: {
      legalName: tenant.companyLegalName || null,
      taxId: tenant.taxId || null,
    },
  };
}

/**
 * Update tenant billing information
 */
export async function updateTenantBilling(
  tenantId: string,
  updates: {
    billingEmail?: string;
    billingAddress?: string;
    billingCity?: string;
    billingState?: string;
    billingPostalCode?: string;
    billingCountry?: string;
    companyLegalName?: string;
    taxId?: string;
  }
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
 * Tenant Settings - structured format for settings page
 */
export interface TenantSettings {
  general: {
    name: string;
    slug: string;
    type: string;
    industry: string | null;
    companySize: string | null;
    website: string | null;
    phone: string | null;
    phoneCountryCode: string | null;
    phoneVerified: boolean;
    logoUrl: string | null;
    primaryColor: string | null;
    address: {
      line1: string | null;
      line2: string | null;
      city: string | null;
      stateProvince: string | null;
      stateCode: string | null;
      postalCode: string | null;
      country: string | null;
    };
  };
  legal: {
    companyLegalName: string | null;
    businessType: string | null;
    incorporationDate: Date | null;
    countryOfIncorporation: string | null;
    registrationNumber: string | null;
    taxId: string | null;
    taxIdVerified: boolean;
    vatNumber: string | null;
    vatVerified: boolean;
  };
  billing: {
    email: string | null;
    emailVerified: boolean;
    useDifferentAddress: boolean;
    address: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    phone: string | null;
    phoneCountryCode: string | null;
    phoneVerified: boolean;
  };
  subscription: {
    plan: string;
    billingCycle: string | null;
    licenseCount: number | null;
    subscriptionStatus: string | null;
    trialExpiresAt: Date | null;
  };
  deletion: {
    status: 'none' | 'pending' | 'deleted';
    deletionRequestedAt: Date | null;
    deletionScheduledAt: Date | null;
    deletionCancelableUntil: Date | null;
    canCancel: boolean;
    daysUntilDeletion: number | null;
    daysUntilCancelExpires: number | null;
  };
}

/**
 * Get all tenant settings in structured format
 */
export async function getTenantSettings(tenantId: string): Promise<TenantSettings | null> {
  const tenant = await getTenantById(tenantId);

  if (!tenant) {
    return null;
  }

  return {
    general: {
      name: tenant.name,
      slug: tenant.slug,
      type: tenant.type,
      industry: tenant.industry,
      companySize: tenant.companySize,
      website: tenant.website,
      phone: tenant.phone,
      phoneCountryCode: tenant.phoneCountryCode,
      phoneVerified: tenant.phoneVerified ?? false,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      address: {
        line1: tenant.addressLine1,
        line2: tenant.addressLine2,
        city: tenant.city,
        stateProvince: tenant.stateProvince,
        stateCode: tenant.stateCode,
        postalCode: tenant.postalCode,
        country: tenant.country,
      },
    },
    legal: {
      companyLegalName: tenant.companyLegalName,
      businessType: tenant.businessType,
      incorporationDate: tenant.incorporationDate,
      countryOfIncorporation: tenant.countryOfIncorporation,
      registrationNumber: tenant.registrationNumber,
      taxId: tenant.taxId,
      taxIdVerified: tenant.taxIdVerified ?? false,
      vatNumber: tenant.vatNumber,
      vatVerified: tenant.vatVerified ?? false,
    },
    billing: {
      email: tenant.billingEmail,
      emailVerified: tenant.billingEmailVerified ?? false,
      useDifferentAddress: tenant.useDifferentBillingAddress ?? false,
      address: tenant.billingAddress,
      addressLine2: tenant.billingAddressLine2,
      city: tenant.billingCity,
      state: tenant.billingState,
      postalCode: tenant.billingPostalCode,
      country: tenant.billingCountry,
      phone: tenant.billingPhone,
      phoneCountryCode: tenant.billingPhoneCountryCode,
      phoneVerified: tenant.billingPhoneVerified ?? false,
    },
    subscription: {
      plan: tenant.plan,
      billingCycle: tenant.billingCycle,
      licenseCount: tenant.licenseCount,
      subscriptionStatus: tenant.subscriptionStatus,
      trialExpiresAt: tenant.trialExpiresAt,
    },
    deletion: (() => {
      const now = new Date();
      const isPendingDeletion = tenant.status === 'pending_deletion' && tenant.deletionScheduledAt;
      const canCancel = isPendingDeletion && tenant.deletionCancelableUntil
        ? now < tenant.deletionCancelableUntil
        : false;
      const daysUntilDeletion = isPendingDeletion && tenant.deletionScheduledAt
        ? Math.max(0, Math.ceil((tenant.deletionScheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : null;
      const daysUntilCancelExpires = isPendingDeletion && tenant.deletionCancelableUntil
        ? Math.max(0, Math.ceil((tenant.deletionCancelableUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : null;

      return {
        status: tenant.status === 'pending_deletion' ? 'pending' as const
          : tenant.status === 'deleted' ? 'deleted' as const
          : 'none' as const,
        deletionRequestedAt: tenant.deletionRequestedAt,
        deletionScheduledAt: tenant.deletionScheduledAt,
        deletionCancelableUntil: tenant.deletionCancelableUntil,
        canCancel,
        daysUntilDeletion,
        daysUntilCancelExpires,
      };
    })(),
  };
}

/**
 * Update tenant general settings (General Tab)
 */
export async function updateTenantGeneralSettings(
  tenantId: string,
  updates: {
    name?: string;
    industry?: string;
    companySize?: string;
    website?: string;
    phone?: string;
    phoneCountryCode?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    stateProvince?: string;
    stateCode?: string;
    postalCode?: string;
    country?: string;
    primaryColor?: string;
  }
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
 * Update tenant legal settings (Legal Tab)
 */
export async function updateTenantLegalSettings(
  tenantId: string,
  updates: {
    companyLegalName?: string;
    businessType?: string;
    incorporationDate?: Date;
    countryOfIncorporation?: string;
    registrationNumber?: string;
    taxId?: string;
    vatNumber?: string;
  }
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
 * Update tenant billing settings (Billing Tab)
 * Extended version with all billing fields
 */
export async function updateTenantBillingSettings(
  tenantId: string,
  updates: {
    billingEmail?: string;
    useDifferentBillingAddress?: boolean;
    billingAddress?: string;
    billingAddressLine2?: string;
    billingCity?: string;
    billingState?: string;
    billingPostalCode?: string;
    billingCountry?: string;
    billingPhone?: string;
    billingPhoneCountryCode?: string;
  }
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

export const tenantService = {
  isValidSlug,
  isBlockedSlug,
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
  getTenantMembershipWithRole,
  hasUserUsedTrial,
  userHasCorePlanTenant,
  checkBillingReadiness,
  updateTenantBilling,
  getTenantSettings,
  updateTenantGeneralSettings,
  updateTenantLegalSettings,
  updateTenantBillingSettings,
};
