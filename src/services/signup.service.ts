/**
 * Signup Orchestration Service
 *
 * Handles the complete signup flow with tenant and owner role creation.
 * Per UNIFIED_AUTH_STRATEGY.md Section 5.1.
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
  type TenantSecurityConfig,
} from '../db/schema';
import { hashPassword, getUserByEmail } from './user.service';
import { sendVerificationEmail } from './email.service';
import { cachePermissions, ALL_PERMISSIONS } from './permission.service';

// Trial period in days
const TRIAL_PERIOD_DAYS = 14;

export interface SignupParams {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  tenantName: string;
  tenantSlug: string;
  tenantType: 'personal' | 'organization';
  termsVersion?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SignupResult {
  user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'emailVerified' | 'phoneVerified' | 'mfaEnabled'>;
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'type' | 'plan' | 'trialExpiresAt'>;
  role: Pick<Role, 'id' | 'name' | 'hierarchyLevel' | 'isProtected'>;
  requiresEmailVerification: boolean;
  verificationEmailSent: boolean;
  redirectUrl: string;
}

/**
 * Validate tenant slug format
 */
function isValidSlug(slug: string): boolean {
  const slugRegex = /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/;
  return slugRegex.test(slug);
}

/**
 * Check if slug is reserved
 */
function isReservedSlug(slug: string): boolean {
  const reserved = [
    'api', 'app', 'www', 'admin', 'help', 'support', 'blog', 'docs',
    'status', 'mail', 'ftp', 'ssh', 'test', 'dev', 'staging', 'prod',
    'production', 'zygo', 'auth', 'login', 'signup', 'register',
    'account', 'settings', 'billing', 'dashboard',
  ];
  return reserved.includes(slug.toLowerCase());
}

/**
 * Complete signup flow
 * Creates user, tenant, owner role, and sends verification email
 */
export async function signup(params: SignupParams): Promise<SignupResult> {
  const {
    email,
    password,
    firstName,
    lastName,
    tenantName,
    tenantSlug,
    tenantType,
    termsVersion = '1.0',
    ipAddress,
    userAgent,
  } = params;

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedSlug = tenantSlug.toLowerCase().trim();

  // Validate inputs
  if (!isValidSlug(normalizedSlug)) {
    throw new Error('Invalid tenant slug format. Use lowercase letters, numbers, and hyphens.');
  }

  if (isReservedSlug(normalizedSlug)) {
    throw new Error('This workspace URL is reserved. Please choose another.');
  }

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

  // Hash password for storage (no Supabase Auth - direct database auth)
  const passwordHash = await hashPassword(password);

  const now = new Date();
  const trialExpiresAt = new Date();
  trialExpiresAt.setDate(trialExpiresAt.getDate() + TRIAL_PERIOD_DAYS);

  // Create everything in a transaction
  const result = await db.transaction(async (tx) => {
    // 1. Create user (email_verified=false)
    const [user] = await tx
      .insert(users)
      .values({
        // Let database generate the UUID
        email: normalizedEmail,
        emailVerified: false,
        passwordHash,
        firstName,
        lastName,
        displayName: firstName && lastName ? `${firstName} ${lastName}` : firstName || undefined,
        status: 'active',
        termsAcceptedAt: now,
        termsVersion,
        privacyAcceptedAt: now,
        privacyVersion: termsVersion,
        passwordChangedAt: now,
      })
      .returning();

    // 2. Create tenant
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: tenantName,
        slug: normalizedSlug,
        type: tenantType,
        plan: 'free',
        trialExpiresAt,
        subscriptionStatus: 'trialing',
        status: 'active',
      })
      .returning();

    // 3. Create tenant security config with defaults
    const [securityConfig] = await tx
      .insert(tenantSecurityConfig)
      .values({
        tenantId: tenant.id,
        requirePhoneVerification: true,
        requireMfa: true,
        phoneVerificationDeadlineDays: 3,
        mfaDeadlineDays: 7,
      })
      .returning();

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

    // 7. Create audit log
    await tx.insert(auditLogs).values({
      userId: user.id,
      action: 'signup',
      resourceType: 'user',
      resourceId: user.id,
      details: {
        email: normalizedEmail,
        tenantId: tenant.id,
        tenantSlug: normalizedSlug,
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
 */
export async function signupWithOAuth(params: {
  email: string;
  provider: 'google' | 'github';
  providerUserId: string;
  firstName?: string;
  lastName?: string;
  tenantName: string;
  tenantSlug: string;
  tenantType: 'personal' | 'organization';
  ipAddress?: string;
  userAgent?: string;
}): Promise<SignupResult> {
  const {
    email,
    provider,
    providerUserId,
    firstName,
    lastName,
    tenantName,
    tenantSlug,
    tenantType,
    ipAddress,
    userAgent,
  } = params;

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedSlug = tenantSlug.toLowerCase().trim();

  // Validate inputs
  if (!isValidSlug(normalizedSlug)) {
    throw new Error('Invalid tenant slug format');
  }

  if (isReservedSlug(normalizedSlug)) {
    throw new Error('This workspace URL is reserved');
  }

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
        firstName,
        lastName,
        displayName: firstName && lastName ? `${firstName} ${lastName}` : firstName || undefined,
        status: 'active',
        termsAcceptedAt: now,
        termsVersion: '1.0',
        privacyAcceptedAt: now,
        privacyVersion: '1.0',
      })
      .returning();

    // 2. Create tenant
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: tenantName,
        slug: normalizedSlug,
        type: tenantType,
        plan: 'free',
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
      phoneVerificationDeadlineDays: 3,
      mfaDeadlineDays: 7,
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
    redirectUrl: '/complete-profile',
  };
}

export const signupService = {
  signup,
  signupWithOAuth,
};
