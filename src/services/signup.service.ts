/**
 * Signup Orchestration Service
 *
 * Handles the complete onboarding wizard signup flow.
 * Per UNIFIED_AUTH_STRATEGY.md Section 5.1.
 *
 * Onboarding Steps:
 * 1. Plan Selection (plan, billing_cycle, license_count)
 * 2. User Details (name, phone, country, city)
 * 3. Company Details (company_name, industry, company_size) - skippable for Core plan
 * 4. Workspace Setup (subdomain, compliance_requirements)
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  users,
  tenants,
  tenantSecurityConfig,
  roles,
  permissions,
  rolePermissions,
  tenantMembers,
  auditLogs,
  type User,
  type Tenant,
  type Role,
} from '../db/schema';
import { hashPassword, getUserByEmail } from './user.service';
import { sendVerificationEmail } from './email.service';
import { cachePermissions } from './permission.service';
import { isValidSlug, isBlockedSlug } from '../utils/slug-validation';

// Trial period in days
const TRIAL_PERIOD_DAYS = 14;

// Plan types
export type PlanType = 'core' | 'flow' | 'scale' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type IndustryType = 'technology' | 'finance' | 'healthcare' | 'manufacturing' | 'retail' | 'other';
export type CompanySizeType = '1-10' | '11-50' | '51-200' | '201-500' | '500+';
export type ComplianceType = 'GDPR' | 'HIPAA' | 'SOC2' | 'PCI-DSS' | 'ISO27001' | 'CCPA' | 'CPRA' | 'APPI';

/**
 * Complete onboarding signup parameters
 */
export interface SignupParams {
  // Step 1: Plan Selection
  plan: PlanType;
  billingCycle: BillingCycle;
  licenseCount?: number; // Required for non-core plans

  // Step 2: User Details
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  phoneCountryCode: string;
  country: string; // ISO 3166-1 alpha-2
  city: string;

  // Step 3: Company Details (optional for Core plan)
  companyName?: string;
  industry?: IndustryType;
  companySize?: CompanySizeType;

  // Step 4: Workspace Setup
  workspaceName: string;
  workspaceSubdomain: string;
  complianceRequirements?: ComplianceType[];

  // Legal & Meta
  termsAccepted: boolean;
  termsVersion?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SignupResult {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
    mfaEnabled: boolean;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    type: string;
    plan: string;
    billingCycle: string | null;
    licenseCount: number | null;
    trialExpiresAt: Date | null;
  };
  role: {
    id: string;
    name: string;
    hierarchyLevel: number;
    isProtected: boolean;
  };
  requiresEmailVerification: boolean;
  verificationEmailSent: boolean;
  redirectUrl: string;
}

// Slug validation imported from ../utils/slug-validation

/**
 * Validate compliance requirements
 */
function isValidCompliance(compliance: string[]): boolean {
  const valid: ComplianceType[] = ['GDPR', 'HIPAA', 'SOC2', 'PCI-DSS', 'ISO27001'];
  return compliance.every((c) => valid.includes(c as ComplianceType));
}

/**
 * Determine tenant type based on plan
 * Core plan = personal (single user)
 * All other plans = organization
 */
function getTenantType(plan: PlanType): 'personal' | 'organization' {
  return plan === 'core' ? 'personal' : 'organization';
}

/**
 * Get default license count based on plan
 */
function getDefaultLicenseCount(plan: PlanType): number {
  switch (plan) {
    case 'core':
      return 1; // Core is single user
    case 'flow':
      return 5;
    case 'scale':
      return 10;
    case 'enterprise':
      return 50;
    default:
      return 1;
  }
}

/**
 * Complete signup flow for onboarding wizard
 * Creates user, tenant, owner role, and sends verification email
 */
export async function signup(params: SignupParams): Promise<SignupResult> {
  const {
    // Step 1: Plan
    plan,
    billingCycle,
    licenseCount,

    // Step 2: User Details
    email,
    password,
    firstName,
    lastName,
    phone,
    phoneCountryCode,
    country,
    city,

    // Step 3: Company Details
    companyName,
    industry,
    companySize,

    // Step 4: Workspace
    workspaceName,
    workspaceSubdomain,
    complianceRequirements = [],

    // Meta
    termsAccepted,
    termsVersion = '1.0',
    ipAddress,
    userAgent,
  } = params;

  // Validate terms accepted
  if (!termsAccepted) {
    throw new Error('You must accept the terms of service');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedSlug = workspaceSubdomain.toLowerCase().trim();

  // Validate slug
  if (!isValidSlug(normalizedSlug)) {
    throw new Error('Invalid workspace URL format. Use lowercase letters, numbers, and hyphens.');
  }

  if (isBlockedSlug(normalizedSlug)) {
    throw new Error('This workspace URL is reserved. Please choose another.');
  }

  // Validate compliance requirements
  if (complianceRequirements.length > 0 && !isValidCompliance(complianceRequirements)) {
    throw new Error('Invalid compliance requirement specified');
  }

  // Validate company details for non-core plans
  const tenantType = getTenantType(plan);
  if (tenantType === 'organization' && !companyName) {
    throw new Error('Company name is required for organization plans');
  }

  // Get license count
  const finalLicenseCount = plan === 'core' ? 1 : (licenseCount || getDefaultLicenseCount(plan));

  const db = getDb();

  // Check if email already exists
  const existingUser = await getUserByEmail(normalizedEmail);
  if (existingUser) {
    throw new Error('An account with this email already exists');
  }

  // Check if slug already exists
  const existingTenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, normalizedSlug),
    columns: { id: true },
  });

  if (existingTenant) {
    throw new Error('This workspace URL is already taken');
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  const now = new Date();
  const trialExpiresAt = new Date();
  trialExpiresAt.setDate(trialExpiresAt.getDate() + TRIAL_PERIOD_DAYS);

  // Create everything in a transaction
  const result = await db.transaction(async (tx) => {
    // 1. Create user with all details from Step 2
    const [user] = await tx
      .insert(users)
      .values({
        email: normalizedEmail,
        emailVerified: false,
        passwordHash,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`.trim(),
        phone,
        phoneCountryCode,
        phoneVerified: false,
        country,
        city,
        status: 'active',
        termsAcceptedAt: now,
        termsVersion,
        privacyAcceptedAt: now,
        privacyVersion: termsVersion,
        passwordChangedAt: now,
      })
      .returning();

    // 2. Create tenant with all details from Steps 1, 3, 4
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: workspaceName,
        slug: normalizedSlug,
        type: tenantType,
        // Company details (Step 3)
        industry: tenantType === 'organization' ? industry : null,
        companySize: tenantType === 'organization' ? companySize : null,
        // Compliance (Step 4)
        complianceRequirements: complianceRequirements,
        // Subscription (Step 1)
        plan,
        billingCycle,
        licenseCount: finalLicenseCount,
        trialExpiresAt,
        subscriptionStatus: 'trialing',
        status: 'active',
      })
      .returning();

    // 3. Create tenant security config with defaults
    // Adjust requirements based on compliance
    const requiresStrictSecurity = complianceRequirements.some((c) =>
      ['HIPAA', 'SOC2', 'PCI-DSS'].includes(c)
    );

    await tx.insert(tenantSecurityConfig).values({
      tenantId: tenant.id,
      requirePhoneVerification: true,
      requireMfa: requiresStrictSecurity ? true : true, // Always require MFA
      phoneVerificationDeadlineDays: requiresStrictSecurity ? 1 : 3,
      mfaDeadlineDays: requiresStrictSecurity ? 3 : 7,
      // Stricter password policy for compliance
      passwordMinLength: requiresStrictSecurity ? 14 : 12,
      passwordRequireUppercase: true,
      passwordRequireLowercase: true,
      passwordRequireNumbers: true,
      passwordRequireSymbols: true,
      passwordExpiryDays: requiresStrictSecurity ? 90 : null,
    });

    // 4. Create OWNER role (protected, all permissions)
    const [ownerRole] = await tx
      .insert(roles)
      .values({
        tenantId: tenant.id,
        name: 'Owner',
        slug: 'owner',
        description: 'Full access to all tenant features. Cannot be modified or deleted.',
        hierarchyLevel: 1,
        isSystem: true,
        isProtected: true,
        createdBy: user.id,
      })
      .returning();

    // 5. Get all permissions and assign to Owner role
    const allPermissions = await tx.select().from(permissions);

    if (allPermissions.length > 0) {
      const rolePermissionValues = allPermissions.map((permission) => ({
        roleId: ownerRole.id,
        permissionId: permission.id,
        tenantId: tenant.id,
        grantedBy: user.id,
      }));

      await tx.insert(rolePermissions).values(rolePermissionValues);
    }

    // 6. Assign user as Owner (tenant member)
    await tx.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId: user.id,
      primaryRoleId: ownerRole.id,
      isOwner: true,
      status: 'active',
      joinedAt: now,
    });

    // 7. Create audit log with full onboarding details
    await tx.insert(auditLogs).values({
      userId: user.id,
      action: 'signup',
      resourceType: 'user',
      resourceId: user.id,
      details: {
        email: normalizedEmail,
        tenantId: tenant.id,
        tenantSlug: normalizedSlug,
        plan,
        billingCycle,
        licenseCount: finalLicenseCount,
        tenantType,
        industry: industry || null,
        companySize: companySize || null,
        complianceRequirements,
        country,
        city,
      },
      ipAddress,
      userAgent,
      status: 'success',
    });

    return { user, tenant, ownerRole, allPermissions };
  });

  // 8. Cache permissions in Redis (outside transaction)
  const permissionKeys = result.allPermissions.map((p) => p.key);
  await cachePermissions(result.user.id, result.tenant.id, permissionKeys);

  // 9. Send verification email
  let verificationEmailSent = false;
  try {
    const emailResult = await sendVerificationEmail(normalizedEmail, firstName);
    verificationEmailSent = emailResult.sent;
  } catch (error) {
    console.error('Failed to send verification email:', error);
    // Don't fail signup if email fails - user can resend later
  }

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      emailVerified: result.user.emailVerified,
      phoneVerified: result.user.phoneVerified,
      mfaEnabled: result.user.mfaEnabled,
    },
    tenant: {
      id: result.tenant.id,
      name: result.tenant.name,
      slug: result.tenant.slug,
      type: result.tenant.type,
      plan: result.tenant.plan,
      billingCycle: result.tenant.billingCycle,
      licenseCount: result.tenant.licenseCount,
      trialExpiresAt: result.tenant.trialExpiresAt,
    },
    role: {
      id: result.ownerRole.id,
      name: result.ownerRole.name,
      hierarchyLevel: result.ownerRole.hierarchyLevel,
      isProtected: result.ownerRole.isProtected,
    },
    requiresEmailVerification: true,
    verificationEmailSent,
    redirectUrl: '/verify-email',
  };
}

/**
 * Signup with OAuth (email already verified)
 * Simplified flow - only requires workspace subdomain and plan
 */
export async function signupWithOAuth(params: {
  // OAuth data
  provider: 'google' | 'github' | 'microsoft' | 'apple';
  providerUserId: string;
  email: string;
  firstName?: string;
  lastName?: string;

  // Step 1: Plan
  plan: PlanType;
  billingCycle: BillingCycle;
  licenseCount?: number;

  // Step 2: User Details (optional - can be filled later)
  phone?: string;
  phoneCountryCode?: string;
  country?: string;
  city?: string;

  // Step 3: Company Details (optional)
  companyName?: string;
  industry?: IndustryType;
  companySize?: CompanySizeType;

  // Step 4: Workspace
  workspaceName: string;
  workspaceSubdomain: string;
  complianceRequirements?: ComplianceType[];

  // Meta
  termsAccepted: boolean;
  ipAddress?: string;
  userAgent?: string;
}): Promise<SignupResult> {
  const {
    provider,
    providerUserId,
    email,
    firstName,
    lastName,
    plan,
    billingCycle,
    licenseCount,
    phone,
    phoneCountryCode,
    country,
    city,
    companyName,
    industry,
    companySize,
    workspaceName,
    workspaceSubdomain,
    complianceRequirements = [],
    termsAccepted,
    ipAddress,
    userAgent,
  } = params;

  if (!termsAccepted) {
    throw new Error('You must accept the terms of service');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedSlug = workspaceSubdomain.toLowerCase().trim();

  // Validate slug
  if (!isValidSlug(normalizedSlug)) {
    throw new Error('Invalid workspace URL format');
  }

  if (isBlockedSlug(normalizedSlug)) {
    throw new Error('This workspace URL is reserved');
  }

  // Determine tenant type based on plan
  const tenantType = getTenantType(plan);

  const finalLicenseCount = plan === 'core' ? 1 : (licenseCount || getDefaultLicenseCount(plan));

  const db = getDb();

  // Check if email already exists
  const existingUser = await getUserByEmail(normalizedEmail);
  if (existingUser) {
    throw new Error('An account with this email already exists');
  }

  // Check if slug already exists
  const existingTenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, normalizedSlug),
    columns: { id: true },
  });

  if (existingTenant) {
    throw new Error('This workspace URL is already taken');
  }

  const now = new Date();
  const trialExpiresAt = new Date();
  trialExpiresAt.setDate(trialExpiresAt.getDate() + TRIAL_PERIOD_DAYS);

  // Create everything in a transaction
  const result = await db.transaction(async (tx) => {
    // 1. Create user (email_verified=true for OAuth)
    const [user] = await tx
      .insert(users)
      .values({
        email: normalizedEmail,
        emailVerified: true, // OAuth verified the email
        passwordHash: '', // No password for OAuth users
        firstName: firstName || null,
        lastName: lastName || null,
        displayName: firstName && lastName ? `${firstName} ${lastName}` : firstName || undefined,
        phone: phone || null,
        phoneCountryCode: phoneCountryCode || null,
        phoneVerified: false,
        country: country || null,
        city: city || null,
        status: 'active',
        termsAcceptedAt: now,
        termsVersion: '1.0',
        privacyAcceptedAt: now,
        privacyVersion: '1.0',
      })
      .returning();

    // 2. Create tenant
    const requiresStrictSecurity = complianceRequirements.some((c) =>
      ['HIPAA', 'SOC2', 'PCI-DSS'].includes(c)
    );

    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: workspaceName,
        slug: normalizedSlug,
        type: tenantType,
        industry: tenantType === 'organization' ? industry : null,
        companySize: tenantType === 'organization' ? companySize : null,
        complianceRequirements,
        plan,
        billingCycle,
        licenseCount: finalLicenseCount,
        trialExpiresAt,
        subscriptionStatus: 'trialing',
        status: 'active',
      })
      .returning();

    // 3. Create tenant security config
    await tx.insert(tenantSecurityConfig).values({
      tenantId: tenant.id,
      requirePhoneVerification: true,
      requireMfa: true,
      phoneVerificationDeadlineDays: requiresStrictSecurity ? 1 : 3,
      mfaDeadlineDays: requiresStrictSecurity ? 3 : 7,
      passwordMinLength: requiresStrictSecurity ? 14 : 12,
      passwordRequireUppercase: true,
      passwordRequireLowercase: true,
      passwordRequireNumbers: true,
      passwordRequireSymbols: true,
      passwordExpiryDays: requiresStrictSecurity ? 90 : null,
    });

    // 4. Create OWNER role
    const [ownerRole] = await tx
      .insert(roles)
      .values({
        tenantId: tenant.id,
        name: 'Owner',
        slug: 'owner',
        description: 'Full access to all tenant features',
        hierarchyLevel: 1,
        isSystem: true,
        isProtected: true,
        createdBy: user.id,
      })
      .returning();

    // 5. Assign all permissions to Owner role
    const allPermissions = await tx.select().from(permissions);

    if (allPermissions.length > 0) {
      await tx.insert(rolePermissions).values(
        allPermissions.map((p) => ({
          roleId: ownerRole.id,
          permissionId: p.id,
          tenantId: tenant.id,
          grantedBy: user.id,
        }))
      );
    }

    // 6. Assign user as Owner
    await tx.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId: user.id,
      primaryRoleId: ownerRole.id,
      isOwner: true,
      status: 'active',
      joinedAt: now,
    });

    // 7. Audit log
    await tx.insert(auditLogs).values({
      userId: user.id,
      action: 'signup_oauth',
      resourceType: 'user',
      resourceId: user.id,
      details: {
        email: normalizedEmail,
        provider,
        tenantId: tenant.id,
        tenantSlug: normalizedSlug,
        plan,
        billingCycle,
        licenseCount: finalLicenseCount,
        tenantType,
        industry: industry || null,
        companySize: companySize || null,
        complianceRequirements,
        country,
        city,
      },
      ipAddress,
      userAgent,
      status: 'success',
    });

    return { user, tenant, ownerRole, allPermissions };
  });

  // Cache permissions
  const permissionKeys = result.allPermissions.map((p) => p.key);
  await cachePermissions(result.user.id, result.tenant.id, permissionKeys);

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      emailVerified: result.user.emailVerified,
      phoneVerified: result.user.phoneVerified,
      mfaEnabled: result.user.mfaEnabled,
    },
    tenant: {
      id: result.tenant.id,
      name: result.tenant.name,
      slug: result.tenant.slug,
      type: result.tenant.type,
      plan: result.tenant.plan,
      billingCycle: result.tenant.billingCycle,
      licenseCount: result.tenant.licenseCount,
      trialExpiresAt: result.tenant.trialExpiresAt,
    },
    role: {
      id: result.ownerRole.id,
      name: result.ownerRole.name,
      hierarchyLevel: result.ownerRole.hierarchyLevel,
      isProtected: result.ownerRole.isProtected,
    },
    requiresEmailVerification: false, // OAuth users are already verified
    verificationEmailSent: false,
    redirectUrl: '/complete-profile', // Go to phone verification
  };
}

export const signupService = {
  signup,
  signupWithOAuth,
};
