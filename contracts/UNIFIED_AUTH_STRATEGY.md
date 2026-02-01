# Zygo Unified Authentication & RBAC Strategy

**Version:** 1.0.0
**Last Updated:** January 2026
**Status:** Implementation Guide
**Related Docs:** [AUTHENTICATION.md](./AUTHENTICATION.md), [rbac_contract.md](./rbac_contract.md), [TENANCY.md](./TENANCY.md)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Principles](#2-core-principles)
3. [Verification Requirements](#3-verification-requirements)
4. [URL Structure & Entry Points](#4-url-structure--entry-points)
5. [Unified Signup Flow](#5-unified-signup-flow)
6. [Unified Signin Flow](#6-unified-signin-flow)
7. [Multi-Tenant User Management](#7-multi-tenant-user-management)
8. [RBAC System](#8-rbac-system)
9. [Permission Resolution & Caching](#9-permission-resolution--caching)
10. [Account Linking Strategy](#10-account-linking-strategy)
11. [Domain Claiming (Enterprise)](#11-domain-claiming-enterprise)
12. [Free Trial & Billing Rules](#12-free-trial--billing-rules)
13. [Tenant Types](#13-tenant-types)
14. [Admin Panel Authentication](#14-admin-panel-authentication)
15. [Database Schema](#15-database-schema)
16. [Implementation Checklist](#16-implementation-checklist)

---

## 1. Overview

This document defines the **unified authentication, verification, and RBAC strategy** for Zygo's multi-tenant platform.

### Key Architecture Decisions

| Aspect | Decision |
|--------|----------|
| **Auth Provider** | Supabase Auth (GoTrue) |
| **Identity** | Email is unique identifier across platform |
| **Multi-Tenant** | One user can belong to multiple tenants |
| **Role Model** | Primary role (required) + Secondary roles (optional, time-limited) |
| **Owner Role** | Auto-created on signup, **PROTECTED** (cannot modify/delete) |
| **Custom Roles** | Unlimited per tenant, fully editable |
| **Permission Merge** | Union (OR) - all permissions from all roles |
| **Permission Cache** | Redis, 5 min TTL, **immediate invalidation** on changes |
| **Verification** | Email (immediate) + Phone (3 days) + MFA (7 days) |

---

## 2. Core Principles

### 2.1 Universal Rules (All Auth Methods)

| Rule | Description |
|------|-------------|
| **Email = Identity** | Email is the unique identifier across the platform |
| **Multi-Tenant** | One user (email) can belong to multiple tenants |
| **Trial Per Tenant** | 14-day trial is per tenant, not per user |
| **Tenant Picker** | Multi-tenant users see workspace selector on login |
| **Scoped Access** | Login from `{tenant}.zygo.tech` requires membership - **non-members REJECTED** |
| **Verification Enforced** | Email, Phone, MFA must be completed per deadlines |

### 2.2 Authentication Methods

| Method | Signup | Signin | Admin Panel |
|--------|--------|--------|-------------|
| Email/Password | Yes | Yes | Yes + MFA |
| Google OAuth | Yes | Yes | **No** |
| GitHub OAuth | Yes | Yes | **No** |
| Microsoft OAuth | Yes | Yes | **No** |
| Apple OAuth | Yes | Yes | **No** |
| SAML 2.0 | No | Yes* | **No** |
| OIDC | No | Yes* | **No** |

*SSO available only if tenant has configured it

---

## 3. Verification Requirements

### 3.1 Verification Deadlines

| Verification | Deadline | Enforcement |
|--------------|----------|-------------|
| **Email** | Immediate | Cannot proceed to tenant without verified email |
| **Phone (SMS)** | 3 days | After 3 days, redirect to `/complete-profile` |
| **MFA (TOTP)** | 7 days | After 7 days, redirect to `/complete-profile` |

### 3.2 Phone Verification Configuration

Phone verification requirement is **tenant configurable**:

```typescript
interface TenantSecurityConfig {
  require_phone_verification: boolean;  // Default: true
  require_mfa: boolean;                  // Default: true
  phone_verification_deadline_days: number;  // Default: 3
  mfa_deadline_days: number;             // Default: 7
}
```

### 3.3 Verification Enforcement Flow

```
User logs in successfully
         │
         ▼
┌─────────────────────────┐
│ Check: Email verified?  │──── NO ───► Block login entirely
└───────────┬─────────────┘             "Please verify your email first"
            │ YES
            ▼
┌─────────────────────────┐
│ Check: Phone required   │
│ by tenant config?       │
└───────────┬─────────────┘
            │
    ┌───────┴───────┐
    │ YES           │ NO (skip)
    ▼               │
┌─────────────────┐ │
│ Phone verified? │ │
└───────┬─────────┘ │
        │           │
┌───────┴───────┐   │
│ NO            │   │
▼               │   │
Account age     │   │
> 3 days?       │   │
    │           │   │
┌───┴───┐       │   │
│YES    │NO     │   │
▼       ▼       ▼   │
ENFORCE Allow   │   │
        (grace) │   │
            │   │   │
            └───┴───┘
                │
                ▼
┌─────────────────────────┐
│ Check: MFA enabled?     │
└───────────┬─────────────┘
            │
    ┌───────┴───────┐
    │ NO            │ YES
    ▼               ▼
Account age     Continue to
> 7 days?       tenant
    │
┌───┴───┐
│YES    │NO
▼       ▼
ENFORCE Allow
        (grace)


ENFORCE = Redirect to /complete-profile
          User cannot access tenant until verified
```

### 3.4 Complete Profile Page

When verification is incomplete and deadline passed:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                       Complete Your Profile                                  │
│                                                                              │
│  To continue using Zygo, please complete the following:                     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  ✅  Email Verified                                                │     │
│  │      john@example.com                                              │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  ⚠️  Phone Verification Required                                   │     │
│  │                                                                    │     │
│  │      [  +1 (___) ___-____  ]                                      │     │
│  │                                                                    │     │
│  │      [Send Verification Code]                                      │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  ⚠️  Two-Factor Authentication Required                            │     │
│  │                                                                    │     │
│  │      Scan QR code with authenticator app                          │     │
│  │                                                                    │     │
│  │      [QR CODE]                                                    │     │
│  │                                                                    │     │
│  │      Or enter manually: XXXX-XXXX-XXXX-XXXX                       │     │
│  │                                                                    │     │
│  │      Verify: [______]  [Confirm]                                  │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  [Log out]                                                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.5 Implementation

```typescript
// Middleware to enforce verification
async function enforceVerification(c: Context, next: Next) {
  const session = c.get('session');
  const user = session.user;
  const tenant = session.tenant;
  const tenantConfig = await getTenantSecurityConfig(tenant.id);

  const accountAgeDays = daysSince(user.createdAt);
  const missing: string[] = [];

  // Email - always required immediately
  if (!user.emailVerified) {
    throw new AuthError('EMAIL_NOT_VERIFIED', 'Please verify your email address');
  }

  // Phone - if required by tenant and deadline passed
  if (tenantConfig.require_phone_verification) {
    if (!user.phoneVerified && accountAgeDays > tenantConfig.phone_verification_deadline_days) {
      missing.push('phone');
    }
  }

  // MFA - deadline passed
  if (!user.mfaEnabled && accountAgeDays > tenantConfig.mfa_deadline_days) {
    missing.push('mfa');
  }

  if (missing.length > 0) {
    throw new VerificationRequiredError({
      missing,
      redirect: '/complete-profile',
      message: `Please complete verification: ${missing.join(', ')}`
    });
  }

  await next();
}
```

---

## 4. URL Structure & Entry Points

### 4.1 Domain Map

| URL | Purpose |
|-----|---------|
| `getzygo.com/signup` | New account + tenant creation |
| `getzygo.com/login` | Global login → Tenant picker |
| `getzygo.com/select-workspace` | Tenant picker |
| `getzygo.com/complete-profile` | Verification enforcement |
| `{tenant}.zygo.tech/login` | Tenant-specific login (members only) |
| `admin.zygo.tech/login` | Global admin (email + MFA only) |

### 4.2 Entry Point Rules

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  getzygo.com/signup                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Creates NEW user account                                                 │
│  • Creates NEW tenant with 14-day trial                                     │
│  • Auto-creates PROTECTED "Owner" role (all 114 permissions)               │
│  • Assigns user as Owner                                                    │
│  • Sends email verification                                                 │
│  • ERROR if email already exists → redirect to login                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  getzygo.com/login                                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Authenticates EXISTING user                                              │
│  • Checks verification status → may redirect to /complete-profile           │
│  • If 0 tenants → redirect to /create-workspace                             │
│  • If 1+ tenants → show tenant picker                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  {tenant}.zygo.tech/login                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Authenticates EXISTING user                                              │
│  • MUST be member of THIS tenant → ERROR if not                             │
│  • Checks verification against TENANT config                                │
│  • SSO available if tenant configured                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Unified Signup Flow

### 5.1 Flow Diagram

```
User initiates signup (Email or OAuth)
                    │
                    ▼
         ┌─────────────────────┐
         │ Authenticate &      │
         │ get email + name    │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Email exists?       │──── YES ───► Error: "Account exists"
         └──────────┬──────────┘              [Go to Login]
                    │ NO
                    ▼
         ┌─────────────────────┐
         │ Email blocked?      │──── YES ───► Error: "Cannot create"
         │ (abandoned tenant)  │
         └──────────┬──────────┘
                    │ NO
                    ▼
         ┌─────────────────────┐
         │ Domain claimed?     │──── YES ───► Warning shown
         └──────────┬──────────┘              (can still proceed)
                    │
                    ▼
         ┌─────────────────────┐
         │ Tenant Creation     │
         │ Form:               │
         │ • Workspace name    │
         │ • URL slug          │
         │ • Type: Personal/Org│
         └──────────┬──────────┘
                    │
                    ▼
    ┌───────────────────────────────────────┐
    │           TRANSACTION                  │
    │                                        │
    │  1. Create user (email_verified=false) │
    │  2. Link OAuth (if applicable)         │
    │  3. Create tenant                      │
    │  4. Create OWNER role (protected)      │
    │     - All 114 permissions              │
    │     - is_system = true                 │
    │     - is_protected = true              │
    │  5. Assign user as Owner               │
    │  6. Create tenant_config               │
    │  7. Cache permissions in Redis         │
    │                                        │
    └───────────────────────────────────────┘
                    │
                    ├──► Email: Verification link
                    │
                    ├──► Email: Welcome to Zygo
                    │
                    ▼
         ┌─────────────────────┐
         │ Response:           │
         │ requires_email_     │
         │ verification: true  │
         │                     │
         │ Redirect to:        │
         │ /verify-email       │
         └─────────────────────┘
```

### 5.2 Owner Role Creation

```typescript
async function createOwnerRole(tx: Transaction, tenantId: string): Promise<Role> {
  // Get all 114 permissions
  const allPermissions = await tx.query.permissions.findMany();

  // Create protected Owner role
  const [ownerRole] = await tx.insert(roles).values({
    tenant_id: tenantId,
    name: 'Owner',
    slug: 'owner',
    description: 'Full access to all features',
    hierarchy_level: 1,
    is_system: true,      // System-created
    is_protected: true,   // Cannot be modified or deleted
    created_by: null,     // System
  }).returning();

  // Assign all permissions
  await tx.insert(rolePermissions).values(
    allPermissions.map(p => ({
      role_id: ownerRole.id,
      permission_id: p.id,
      tenant_id: tenantId,
    }))
  );

  return ownerRole;
}
```

### 5.3 Signup Response

```typescript
interface SignupResponse {
  user: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    email_verified: false;  // Always false on signup
    phone_verified: false;
    mfa_enabled: false;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    type: 'personal' | 'organization';
    plan: 'free';
    trial_expires_at: string;
  };
  role: {
    id: string;
    name: 'Owner';
    hierarchy_level: 1;
    is_protected: true;
  };
  requires_email_verification: true;
  verification_email_sent: true;
  redirect_url: '/verify-email';
}
```

---

## 6. Unified Signin Flow

### 6.1 Flow Diagram

```
User submits login
         │
         ▼
┌─────────────────────┐
│ Authenticate        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ User exists?        │──── NO ───► Error: "No account"
└──────────┬──────────┘
           │ YES
           ▼
┌─────────────────────┐
│ Status = active?    │──── NO ───► Error (suspended/blocked)
└──────────┬──────────┘
           │ YES
           ▼
┌─────────────────────┐
│ Email verified?     │──── NO ───► Error: "Verify email first"
└──────────┬──────────┘             [Resend verification]
           │ YES
           ▼
┌─────────────────────┐
│ MFA enabled?        │──── YES ──► MFA Challenge
└──────────┬──────────┘
           │ NO (or passed)
           ▼
┌─────────────────────┐
│ Entry point?        │
└──────────┬──────────┘
           │
   ┌───────┴───────┐
   │               │
   ▼               ▼
Tenant URL      Global URL
   │               │
   ▼               ▼
┌───────────┐  ┌───────────┐
│ Is member?│  │ Get       │
│           │  │ tenants   │
└─────┬─────┘  └─────┬─────┘
      │              │
  ┌───┴───┐    ┌─────┴─────┐
  │       │    │           │
  ▼ NO    ▼YES ▼ 0         ▼ 1+
  │       │    │           │
ERROR   Check  Redirect   Tenant
"Not    verif  to create  Picker
member" status workspace
        │
        ▼
┌───────────────────┐
│ Verification      │
│ complete for      │
│ this tenant?      │
└─────────┬─────────┘
          │
  ┌───────┴───────┐
  │               │
  ▼ NO            ▼ YES
  │               │
Redirect to     Access
/complete-      granted
profile
```

### 6.2 Verification Check Per Tenant

```typescript
async function checkVerificationStatus(
  user: User,
  tenantId: string
): Promise<VerificationStatus> {
  const config = await getTenantSecurityConfig(tenantId);
  const accountAgeDays = daysSince(user.createdAt);

  const status: VerificationStatus = {
    complete: true,
    missing: [],
    deadlines: {}
  };

  // Email - always required
  if (!user.emailVerified) {
    status.complete = false;
    status.missing.push('email');
  }

  // Phone - if tenant requires it
  if (config.require_phone_verification && !user.phoneVerified) {
    const deadline = config.phone_verification_deadline_days;
    if (accountAgeDays > deadline) {
      status.complete = false;
      status.missing.push('phone');
    } else {
      status.deadlines.phone = deadline - accountAgeDays;
    }
  }

  // MFA - always required after deadline
  if (!user.mfaEnabled) {
    const deadline = config.mfa_deadline_days;
    if (accountAgeDays > deadline) {
      status.complete = false;
      status.missing.push('mfa');
    } else {
      status.deadlines.mfa = deadline - accountAgeDays;
    }
  }

  return status;
}
```

---

## 7. Multi-Tenant User Management

### 7.1 Tenant Picker

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Select your workspace                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  🏢  Acme Corporation                                              │     │
│  │      acme.zygo.tech                                     [Open]     │     │
│  │      Role: Admin • Organization                                    │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  👤  John's Workspace                                              │     │
│  │      john-doe.zygo.tech                                 [Open]     │     │
│  │      Role: Owner • Personal                                        │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Want to create a new workspace? [Go to getzygo.com/signup]                 │
│  [Log out]                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Tenant Switching

```typescript
// POST /api/v1/auth/switch-tenant
async function switchTenant(c: Context) {
  const { target_tenant_id } = await c.req.json();
  const session = c.get('session');

  // Verify membership
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, session.user.id),
      eq(tenantMembers.tenantId, target_tenant_id),
      eq(tenantMembers.status, 'active')
    )
  });

  if (!membership) {
    throw new ForbiddenError('NOT_MEMBER');
  }

  // Check verification for target tenant
  const verificationStatus = await checkVerificationStatus(
    session.user,
    target_tenant_id
  );

  if (!verificationStatus.complete) {
    return c.json({
      requires_verification: true,
      missing: verificationStatus.missing,
      redirect_url: '/complete-profile'
    }, 403);
  }

  // Create new session for target tenant
  const newSession = await createSession(session.user.id, target_tenant_id);

  return c.json({
    tenant: membership.tenant,
    session: newSession,
    redirect_url: `https://${membership.tenant.slug}.zygo.tech`
  });
}
```

---

## 8. RBAC System

### 8.1 Role Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ROLE TYPES                                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  OWNER ROLE (Auto-created, PROTECTED)                                        │
│  ─────────────────────────────────────                                       │
│  • Created automatically on tenant signup                                   │
│  • Cannot be modified (permissions, name, etc.)                             │
│  • Cannot be deleted                                                        │
│  • At least 1 member must always have Owner role                           │
│  • All 114 permissions                                                      │
│  • Hierarchy level: 1 (highest)                                             │
│                                                                              │
│  is_system: true                                                            │
│  is_protected: true                                                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  CUSTOM ROLES (Tenant-created)                                               │
│  ──────────────────────────────                                              │
│  • Created by tenant admins with canManageRoles permission                  │
│  • Unlimited number per tenant                                              │
│  • Fully customizable:                                                      │
│    - Name, description                                                      │
│    - Any combination of 114 permissions                                     │
│    - Hierarchy level (2-100, cannot be 1)                                   │
│  • Can be modified at any time                                              │
│  • Can be deleted (if no members assigned)                                  │
│                                                                              │
│  is_system: false                                                           │
│  is_protected: false                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Role Assignment Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     USER ROLE ASSIGNMENT                                     │
└─────────────────────────────────────────────────────────────────────────────┘

                          User in Tenant
                                │
                ┌───────────────┴───────────────┐
                │                               │
                ▼                               ▼
        ┌───────────────┐               ┌───────────────┐
        │ PRIMARY ROLE  │               │SECONDARY ROLES│
        │               │               │               │
        │ • Required    │               │ • Optional    │
        │ • Exactly 1   │               │ • 0 to many   │
        │ • Permanent   │               │ • Time-limited│
        │ • Defines     │               │ • Adds extra  │
        │   base access │               │   permissions │
        └───────┬───────┘               └───────┬───────┘
                │                               │
                └───────────────┬───────────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │ EFFECTIVE PERMISSIONS│
                     │                     │
                     │ = Union (OR) of all │
                     │   permissions from  │
                     │   ALL assigned roles│
                     └─────────────────────┘
```

### 8.3 Role Management Rules

```typescript
// Validation rules for role operations
const roleRules = {
  // Creating roles
  create: {
    requiredPermission: 'canManageRoles',
    hierarchyRule: 'Cannot create role with hierarchy < your own',
    reservedNames: ['owner'],  // Cannot use "owner" name
    minHierarchy: 2,  // Level 1 reserved for Owner
  },

  // Modifying roles
  modify: {
    requiredPermission: 'canManageRoles',
    protectedRoles: ['owner'],  // Cannot modify Owner role
    hierarchyRule: 'Cannot modify roles above your hierarchy',
  },

  // Deleting roles
  delete: {
    requiredPermission: 'canManageRoles',
    protectedRoles: ['owner'],  // Cannot delete Owner role
    memberCheck: 'Cannot delete role with assigned members',
    hierarchyRule: 'Cannot delete roles above your hierarchy',
  },

  // Assigning roles
  assign: {
    requiredPermission: 'canAssignRoles',
    hierarchyRule: 'Cannot assign roles above your hierarchy',
    ownerRule: 'At least 1 member must have Owner role',
  },
};
```

### 8.4 Creating Custom Roles

```typescript
// POST /api/v1/roles
async function createRole(c: Context) {
  const session = c.get('session');
  const body = await c.req.json();

  // Validate permission
  if (!await hasPermission(session.userId, session.tenantId, 'canManageRoles')) {
    throw new ForbiddenError('PERMISSION_DENIED');
  }

  // Validate hierarchy
  const userHierarchy = await getUserHierarchy(session.userId, session.tenantId);
  if (body.hierarchy_level <= userHierarchy) {
    throw new ForbiddenError('HIERARCHY_VIOLATION',
      `Cannot create role with hierarchy ${body.hierarchy_level}. Your level is ${userHierarchy}.`
    );
  }

  // Validate not using reserved name
  if (body.name.toLowerCase() === 'owner') {
    throw new BadRequestError('RESERVED_NAME', 'Cannot use reserved role name "Owner"');
  }

  // Validate hierarchy >= 2
  if (body.hierarchy_level < 2) {
    throw new BadRequestError('INVALID_HIERARCHY', 'Hierarchy level must be 2 or higher');
  }

  // Create role
  const [role] = await db.insert(roles).values({
    tenant_id: session.tenantId,
    name: body.name,
    slug: slugify(body.name),
    description: body.description,
    hierarchy_level: body.hierarchy_level,
    is_system: false,
    is_protected: false,
    created_by: session.userId,
  }).returning();

  // Assign permissions
  if (body.permissions?.length > 0) {
    const permissionRecords = await db.query.permissions.findMany({
      where: inArray(permissions.key, body.permissions)
    });

    await db.insert(rolePermissions).values(
      permissionRecords.map(p => ({
        role_id: role.id,
        permission_id: p.id,
        tenant_id: session.tenantId,
        granted_by: session.userId,
      }))
    );
  }

  // Audit log
  await auditLog('role.created', {
    tenantId: session.tenantId,
    roleId: role.id,
    roleName: role.name,
    permissionCount: body.permissions?.length || 0,
    createdBy: session.userId,
  });

  return c.json({ role }, 201);
}
```

### 8.5 Owner Role Protection

```typescript
// Middleware to protect Owner role operations
async function protectOwnerRole(c: Context, next: Next) {
  const roleId = c.req.param('roleId');

  const role = await db.query.roles.findFirst({
    where: eq(roles.id, roleId)
  });

  if (role?.is_protected) {
    throw new ForbiddenError('PROTECTED_ROLE',
      'The Owner role cannot be modified or deleted'
    );
  }

  await next();
}

// Ensure at least 1 Owner exists
async function ensureOwnerExists(tenantId: string): Promise<void> {
  const ownerRole = await db.query.roles.findFirst({
    where: and(
      eq(roles.tenant_id, tenantId),
      eq(roles.slug, 'owner')
    )
  });

  const ownerMembers = await db.query.tenantMembers.findMany({
    where: and(
      eq(tenantMembers.tenant_id, tenantId),
      eq(tenantMembers.primary_role_id, ownerRole.id),
      eq(tenantMembers.status, 'active')
    )
  });

  if (ownerMembers.length === 0) {
    throw new ForbiddenError('OWNER_REQUIRED',
      'At least one member must have the Owner role'
    );
  }
}
```

---

## 9. Permission Resolution & Caching

### 9.1 Permission Check Flow

```
API Request with required permission
                    │
                    ▼
         ┌─────────────────────┐
         │ Check Redis Cache   │
         │ Key: rbac:{user}:{tenant}
         └──────────┬──────────┘
                    │
        ┌───────────┴───────────┐
        │ MISS                  │ HIT
        ▼                       ▼
┌───────────────────┐    Use cached
│ Load from DB:     │    permissions
│ - Primary role    │         │
│ - Secondary roles │         │
│ - Merge (union)   │         │
│ - Cache 5 min     │         │
└─────────┬─────────┘         │
          │                   │
          └─────────┬─────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Permission in set?  │──── NO ───► 403 DENY
         └──────────┬──────────┘
                    │ YES
                    ▼
         ┌─────────────────────┐
         │ Is critical         │
         │ (MFA required)?     │
         └──────────┬──────────┘
                    │
        ┌───────────┴───────────┐
        │ NO                    │ YES
        ▼                       ▼
     ALLOW               Check MFA verified
                         in last 15 min
                                │
                        ┌───────┴───────┐
                        │ NO            │ YES
                        ▼               ▼
                   MFA Challenge     ALLOW
```

### 9.2 Permission Resolution

```typescript
async function resolvePermissions(
  userId: string,
  tenantId: string
): Promise<Map<string, PermissionGrant>> {
  const cacheKey = `rbac:${userId}:${tenantId}`;

  // Try cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return new Map(JSON.parse(cached));
  }

  // Load from DB
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.status, 'active')
    ),
    with: {
      primaryRole: {
        with: { permissions: { with: { permission: true } } }
      },
      secondaryRoles: {
        where: or(
          isNull(secondaryRoleAssignments.expiresAt),
          gt(secondaryRoleAssignments.expiresAt, new Date())
        ),
        with: {
          role: {
            with: { permissions: { with: { permission: true } } }
          }
        }
      }
    }
  });

  if (!membership) {
    return new Map();
  }

  // Merge all permissions (UNION)
  const permissions = new Map<string, PermissionGrant>();

  // Primary role
  for (const rp of membership.primaryRole.permissions) {
    permissions.set(rp.permission.key, {
      key: rp.permission.key,
      roleId: membership.primaryRole.id,
      roleName: membership.primaryRole.name,
      isPrimary: true,
      expiresAt: null,
    });
  }

  // Secondary roles
  for (const sra of membership.secondaryRoles) {
    for (const rp of sra.role.permissions) {
      if (!permissions.has(rp.permission.key)) {
        permissions.set(rp.permission.key, {
          key: rp.permission.key,
          roleId: sra.role.id,
          roleName: sra.role.name,
          isPrimary: false,
          expiresAt: sra.expiresAt,
        });
      }
    }
  }

  // Cache with 5 min TTL
  await redis.setex(cacheKey, 300, JSON.stringify([...permissions]));

  return permissions;
}
```

### 9.3 Immediate Cache Invalidation

```typescript
// Called on ANY permission-affecting change
async function invalidatePermissionCache(
  userId: string,
  tenantId: string
): Promise<void> {
  const key = `rbac:${userId}:${tenantId}`;
  await redis.del(key);

  // Publish for distributed systems
  await redis.publish('rbac:invalidate', JSON.stringify({
    userId,
    tenantId,
    timestamp: Date.now()
  }));
}

// Called when role permissions change (affects all users with role)
async function invalidateRoleCache(
  roleId: string,
  tenantId: string
): Promise<void> {
  // Get all users with this role (primary or secondary)
  const primaryMembers = await db.query.tenantMembers.findMany({
    where: eq(tenantMembers.primaryRoleId, roleId),
    columns: { userId: true }
  });

  const secondaryMembers = await db.query.secondaryRoleAssignments.findMany({
    where: and(
      eq(secondaryRoleAssignments.roleId, roleId),
      eq(secondaryRoleAssignments.status, 'active')
    ),
    columns: { userId: true }
  });

  const userIds = new Set([
    ...primaryMembers.map(m => m.userId),
    ...secondaryMembers.map(m => m.userId)
  ]);

  // Invalidate all affected users
  const pipeline = redis.pipeline();
  for (const userId of userIds) {
    pipeline.del(`rbac:${userId}:${tenantId}`);
  }
  await pipeline.exec();
}

// Events that trigger invalidation:
// - Role assigned to user
// - Role removed from user
// - Role permissions modified
// - Secondary role assigned
// - Secondary role expired/revoked
// - User's primary role changed
```

### 9.4 Critical Permissions (MFA Required)

```typescript
const CRITICAL_PERMISSIONS = {
  canDeleteUsers: { requiresMfa: true },
  canDeleteTenant: { requiresMfa: true },
  canCancelSubscription: { requiresMfa: true },
  canExportSecrets: { requiresMfa: true },
  canExportAuditLogs: { requiresMfa: true },
  canExportAIData: { requiresMfa: true },
  canRebuildServers: { requiresMfa: true },
  canRestoreSnapshots: { requiresMfa: true },
};

// Middleware for MFA-required permissions
function requireMfaForCritical(permission: string) {
  return async (c: Context, next: Next) => {
    if (!CRITICAL_PERMISSIONS[permission]?.requiresMfa) {
      return next();
    }

    const session = c.get('session');
    const mfaAge = Date.now() - new Date(session.mfaVerifiedAt || 0).getTime();

    if (mfaAge > 15 * 60 * 1000) { // 15 minutes
      const challenge = await createMfaChallenge(session.userId, permission);
      throw new MfaRequiredError({
        permission,
        challengeId: challenge.id,
        message: 'MFA verification required for this action'
      });
    }

    await next();
  };
}
```

---

## 10. Account Linking Strategy

### 10.1 Linking Rules

| Scenario | Has Other Tenants? | Action |
|----------|-------------------|--------|
| OAuth login, user doesn't exist | - | Create user (signup) |
| OAuth login, user exists, OAuth not linked | **No** | Auto-link |
| OAuth login, user exists, OAuth not linked | **Yes** | **Require email verification** |
| OAuth login, OAuth already linked | - | Update tokens |

### 10.2 Verification Flow

```
User OAuth login, has existing tenants, OAuth not linked
                    │
                    ▼
         ┌─────────────────────┐
         │ Create link request │
         │ Send 6-digit code   │
         │ to user's email     │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ User enters code    │
         └──────────┬──────────┘
                    │
        ┌───────────┴───────────┐
        │ INVALID (max 3)       │ VALID
        ▼                       ▼
   Block request          Link OAuth
                          Continue signin
```

---

## 11. Domain Claiming (Enterprise)

| Setting | Value |
|---------|-------|
| Availability | Enterprise plan only |
| Default | Disabled |
| Effect | Warning to users with claimed domain |
| User Action | Can still create personal workspace |

---

## 12. Free Trial & Billing Rules

### 12.1 Trial Rules

| Rule | Value |
|------|-------|
| Duration | 14 days |
| Tokens | 50% of plan |
| Max Users | 20 |
| Scope | Per tenant |

### 12.2 Lifecycle

```
Day 0       Day 7       Day 13      Day 14      Day 74
  │           │           │           │           │
Trial       Email       Email       Expires     Soft delete
starts      warning     warning     0 tokens    Block owner
50% tokens
```

---

## 13. Tenant Types

| Feature | Personal | Organization |
|---------|----------|--------------|
| Max Users | 1 | Plan-based |
| Custom Roles | No | Yes |
| SSO | No | Enterprise |

---

## 14. Admin Panel Authentication

| Rule | Value |
|------|-------|
| Auth Methods | Email/Password **ONLY** |
| MFA | **Mandatory** |
| OAuth | **Not allowed** |
| Session | 4 hours |

---

## 15. Database Schema

```sql
-- Roles table
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) NOT NULL,
  description TEXT,
  hierarchy_level INTEGER NOT NULL CHECK (hierarchy_level BETWEEN 1 AND 100),
  is_system BOOLEAN DEFAULT FALSE,
  is_protected BOOLEAN DEFAULT FALSE,  -- Cannot modify/delete if true
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

-- Role permissions
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

-- Tenant members (with primary role)
CREATE TABLE tenant_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  primary_role_id UUID NOT NULL REFERENCES roles(id),
  is_owner BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- Secondary role assignments (optional, time-limited)
CREATE TABLE secondary_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  expires_at TIMESTAMP,
  reason TEXT,
  assigned_by UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tenant security config
CREATE TABLE tenant_security_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID UNIQUE NOT NULL REFERENCES tenants(id),
  require_phone_verification BOOLEAN DEFAULT TRUE,
  require_mfa BOOLEAN DEFAULT TRUE,
  phone_verification_deadline_days INTEGER DEFAULT 3,
  mfa_deadline_days INTEGER DEFAULT 7,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Users additions
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
ALTER TABLE users ADD COLUMN phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN blocked_until TIMESTAMP;
ALTER TABLE users ADD COLUMN block_reason VARCHAR(50);
```

---

## 16. Implementation Checklist

### Phase 1: Core Auth
- [x] Signup with Owner role creation
- [x] Email verification (immediate)
- [x] Signin with verification check
- [x] Complete profile page
- [x] Phone verification (Twilio)
- [x] MFA setup (TOTP)
- [x] Password reset (forgot-password, verify-code, reset-password)

### Phase 2: RBAC
- [x] Permission resolution with Redis cache
- [x] Immediate cache invalidation
- [x] Custom role CRUD
- [x] Owner role protection
- [x] Role assignment with hierarchy check
- [x] Secondary role assignment (time-limited)

### Phase 3: Multi-Tenant
- [x] Tenant picker (GET /api/v1/tenants)
- [x] Tenant switching with verification check (POST /api/v1/tenants/switch)
- [x] Tenant-specific security config (GET/PATCH /api/v1/tenants/:id/security-config)

### Phase 4: OAuth & Linking
- [ ] Google, GitHub OAuth
- [ ] Account linking with verification
- [ ] Auto-link for users without tenants

### Phase 5: Enterprise
- [ ] SAML/OIDC configuration
- [ ] Domain claiming
- [ ] Admin panel (email + MFA only)

---

*Version: 1.0.0 | January 2026*
