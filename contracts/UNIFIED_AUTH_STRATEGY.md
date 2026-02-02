# Zygo Unified Authentication & RBAC Strategy

**Version:** 2.0.0
**Last Updated:** February 2, 2026
**Status:** Production Implementation
**Related Docs:** [AUTHENTICATION.md](./AUTHENTICATION.md), [rbac_contract.md](./rbac_contract.md), [TENANCY.md](./TENANCY.md)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Principles](#2-core-principles)
3. [Cross-Domain Authentication](#3-cross-domain-authentication)
4. [Unified Signup Flow](#4-unified-signup-flow)
5. [Unified Signin Flow](#5-unified-signin-flow)
6. [OAuth Authentication](#6-oauth-authentication)
7. [Password Reset Flow](#7-password-reset-flow)
8. [Verification Requirements](#8-verification-requirements)
9. [Multi-Tenant User Management](#9-multi-tenant-user-management)
10. [Tenant Switching](#10-tenant-switching)
11. [RBAC System](#11-rbac-system)
12. [Permission Resolution & Caching](#12-permission-resolution--caching)
13. [Account Linking Strategy](#13-account-linking-strategy)
14. [Session Management](#14-session-management)
15. [Admin Panel Authentication](#15-admin-panel-authentication)
16. [API Endpoints Reference](#16-api-endpoints-reference)
17. [Implementation Checklist](#17-implementation-checklist)

---

## 1. Overview

This document defines the **unified authentication, cross-domain token exchange, and RBAC strategy** for Zygo's multi-tenant platform.

### Key Architecture Decisions

| Aspect | Decision |
|--------|----------|
| **Auth Provider** | Supabase Auth (GoTrue) for identity + Custom auth tokens for cross-domain |
| **Identity** | Email is unique identifier across platform |
| **Multi-Tenant** | One user can belong to multiple tenants |
| **Cross-Domain Auth** | Opaque auth tokens stored in Redis (2 min TTL, single-use) |
| **Session Storage** | Supabase tokens in sessionStorage + tenant data in tenantStorage |
| **Tenant Isolation** | Tenant memberships cached at login, no cross-tenant API calls |
| **Role Model** | Primary role (required) + Secondary roles (optional, time-limited) |
| **Owner Role** | Auto-created on signup, **PROTECTED** (cannot modify/delete) |
| **Permission Cache** | Redis, 5 min TTL, **immediate invalidation** on changes |

### Domain Architecture

| Domain | Purpose |
|--------|---------|
| `getzygo.com` | Public landing, auth pages (login, signup, password reset) |
| `api.zygo.tech` | Backend API |
| `{tenant}.zygo.tech` | Tenant workspace apps |
| `admin.zygo.tech` | Global admin panel |

---

## 2. Core Principles

### 2.1 Universal Rules (All Auth Methods)

| Rule | Description |
|------|-------------|
| **Email = Identity** | Email is the unique identifier across the platform |
| **Multi-Tenant** | One user (email) can belong to multiple tenants |
| **Tenant Isolation** | Each tenant app only knows about its own data |
| **Cached Memberships** | Tenant list cached at login, no API calls to fetch other tenants |
| **Cross-Domain Tokens** | Single-use, 2-minute TTL, stored in Redis |
| **Trial Per Tenant** | 14-day trial is per tenant, not per user |
| **Core Plan Limit** | One free (Core plan) workspace per user |

### 2.2 Authentication Methods

| Method | Signup | Signin | Admin Panel |
|--------|--------|--------|-------------|
| Email/Password | Yes | Yes | Yes + MFA |
| Google OAuth | Yes | Yes | **No** |
| GitHub OAuth | Yes | Yes | **No** |
| Microsoft OAuth | Planned | Planned | **No** |
| Apple OAuth | Planned | Planned | **No** |
| SAML 2.0 | No | Yes* | **No** |
| OIDC | No | Yes* | **No** |

*SSO available only if tenant has configured it

---

## 3. Cross-Domain Authentication

### 3.1 The Problem

Zygo uses separate domains for auth (`getzygo.com`) and tenant apps (`{tenant}.zygo.tech`). Cookies cannot be shared across these domains, so we need a secure way to transfer authentication.

### 3.2 The Solution: Auth Tokens

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CROSS-DOMAIN AUTHENTICATION FLOW                          │
└─────────────────────────────────────────────────────────────────────────────┘

User logs in at getzygo.com
         │
         ▼
┌─────────────────────┐
│ 1. Authenticate     │
│    with Supabase    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 2. Backend creates  │
│    auth token in    │     ┌─────────────────────────────────────────┐
│    Redis with:      │     │  AuthTokenPayload in Redis:             │
│    - userId         │     │  {                                      │
│    - tenantId       │     │    userId, tenantId, email,             │
│    - roleInfo       │     │    firstName, lastName, avatarUrl,      │
│    - permissions    │     │    emailVerified, emailVerifiedVia,     │
│    - supabaseTokens │     │    roleId, roleName, roleSlug, isOwner, │
│    - memberships    │     │    supabaseAccessToken,                 │
└──────────┬──────────┘     │    supabaseRefreshToken,                │
           │                │    tenantMemberships: [...],            │
           │                │    createdAt                            │
           │                │  }                                      │
           │                │  TTL: 2 minutes, Single-use             │
           ▼                └─────────────────────────────────────────┘
┌─────────────────────┐
│ 3. Redirect to      │
│    tenant app with  │
│    ?auth_token=xxx  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 4. Tenant app calls │
│    POST /verify-    │
│    token            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. Backend verifies & DELETES token (single-use)                            │
│    Returns: user, tenant, role, permissions, session, tenantMemberships     │
└─────────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────┐
│ 6. Frontend stores: │
│    - sessionStorage │
│      (access_token) │
│    - tenantStorage  │
│      (memberships)  │
└─────────────────────┘
```

### 3.3 Auth Token Service Implementation

```typescript
// src/services/auth-token.service.ts

export interface TenantMembership {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: { id: string; name: string; };
  isOwner: boolean;
}

export interface AuthTokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl?: string | null;
  emailVerified: boolean;
  emailVerifiedVia?: string | null;
  roleId: string;
  roleName: string;
  roleSlug: string;
  isOwner: boolean;
  supabaseAccessToken?: string;
  supabaseRefreshToken?: string;
  tenantMemberships?: TenantMembership[];  // Cached at login
  createdAt: number;
}

// Create token (stores in Redis with 2 min TTL)
async function createAuthToken(payload: Omit<AuthTokenPayload, 'createdAt'>): Promise<string>

// Verify and consume token (single-use, deletes from Redis)
async function verifyAuthToken(token: string): Promise<AuthTokenPayload | null>
```

### 3.4 Security Properties

| Property | Implementation |
|----------|---------------|
| **Unpredictable** | 32 bytes of cryptographically random data (base64url encoded) |
| **Short-lived** | 2 minute TTL in Redis |
| **Single-use** | Token is deleted atomically during verification |
| **Server-validated** | Token must exist in Redis; no client-side validation |
| **Contains no secrets** | Token is opaque; all data stored server-side |

---

## 4. Unified Signup Flow

### 4.1 Onboarding Wizard Steps

```
Step 1: Plan Selection
├── plan: core | flow | scale | enterprise
├── billing_cycle: monthly | annual
└── license_count (for paid plans)

Step 2: User Details
├── email, password
├── first_name, last_name
├── phone, phone_country_code
├── country, city

Step 3: Company Details (optional for Core plan)
├── company_name
├── industry
└── company_size

Step 4: Workspace Setup
├── workspace_name
├── workspace_subdomain
└── compliance_requirements
```

### 4.2 Signup Flow Diagram

```
User submits signup form at getzygo.com/signup
                    │
                    ▼
         ┌─────────────────────┐
         │ POST /api/v1/auth/  │
         │ signup              │
         └──────────┬──────────┘
                    │
         ┌──────────┴──────────┐
         │ Check if email      │──── EXISTS ───► Error: "Account exists"
         │ already exists      │               [Redirect to /login]
         └──────────┬──────────┘
                    │ NEW
                    ▼
    ┌───────────────────────────────────────┐
    │           TRANSACTION                  │
    │                                        │
    │  1. Create user in Supabase Auth       │
    │     (email_confirm=true for OAuth)     │
    │  2. Create user record in users table  │
    │  3. Create tenant                      │
    │  4. Create OWNER role (protected)      │
    │     - All 114 permissions              │
    │     - is_system = true                 │
    │     - is_protected = true              │
    │  5. Create tenant_member (isOwner=true)│
    │  6. Create audit log                   │
    │                                        │
    └───────────────────────────────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Sign in with        │
         │ Supabase to get     │
         │ access/refresh      │
         │ tokens              │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Create auth token   │
         │ with:               │
         │ - User info         │
         │ - Tenant info       │
         │ - Role info         │
         │ - Supabase tokens   │
         │ - tenantMemberships │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Return response:    │
         │ redirect_url =      │
         │ https://{slug}.     │
         │ zygo.tech?auth_     │
         │ token=xxx           │
         └─────────────────────┘
```

### 4.3 Signup Response

```typescript
interface SignupResponse {
  user: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    email_verified: boolean;
    phone_verified: boolean;
    mfa_enabled: boolean;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    type: 'personal' | 'organization';
    plan: 'core' | 'flow' | 'scale' | 'enterprise';
    billing_cycle: 'monthly' | 'annual';
    trial_expires_at: string;
  };
  role: {
    id: string;
    name: 'Owner';
    hierarchy_level: 1;
    is_protected: true;
  };
  requires_email_verification: boolean;
  verification_email_sent: boolean;
  redirect_url: string;  // https://{slug}.zygo.tech?auth_token=xxx
}
```

### 4.4 Core Plan Limit Enforcement

```typescript
// Only one free (Core plan) workspace per user
if (body.plan === 'core') {
  const hasCore = await userHasCorePlanTenant(user.id);
  if (hasCore) {
    throw new Error('You can only have one free (Core) workspace. Please select a paid plan.');
  }
}
```

---

## 5. Unified Signin Flow

### 5.1 Flow Diagram

```
User submits login at getzygo.com/login
         │
         ▼
┌─────────────────────┐
│ POST /api/v1/auth/  │
│ signin              │
│ {email, password,   │
│  tenant_slug?,      │
│  mfa_code?}         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ User exists?        │──── NO ───► 401: "Invalid email or password"
└──────────┬──────────┘
           │ YES
           ▼
┌─────────────────────┐
│ Account status?     │
├──────────┬──────────┤
│ suspended│  deleted │──────────► 403: Status error
└──────────┴──────────┘
           │ active
           ▼
┌─────────────────────┐
│ Account locked?     │──── YES ──► 403: "Account locked for X minutes"
└──────────┬──────────┘
           │ NO
           ▼
┌─────────────────────┐
│ Verify password     │──── FAIL ──┬► Increment failed attempts
└──────────┬──────────┘            │  If >= 5: Lock for 15 minutes
           │ PASS                  │  Return 401: "Invalid credentials"
           │                       └──────────────────────────────────
           ▼
┌─────────────────────┐
│ MFA enabled?        │──── YES & no code ──► 403: "MFA required"
└──────────┬──────────┘                       require_mfa_code: true
           │ NO or code valid
           ▼
┌─────────────────────┐
│ Sign in with        │
│ Supabase            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Reset failed        │
│ attempts, update    │
│ lastLoginAt         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Get user's tenants  │
└──────────┬──────────┘
           │
   ┌───────┴───────────────────────────────────┐
   │ 0 tenants        │ 1 tenant    │ 2+ tenants │
   ▼                  ▼             ▼            │
Return:           Select auto    Return:        │
redirect_url =    Check verif    tenants list   │
/onboarding       status         redirect_url = │
                      │          /select-       │
                      ▼          workspace      │
              ┌─────────────────┐               │
              │ Verification    │               │
              │ complete?       │               │
              └───────┬─────────┘               │
                  ┌───┴───┐                     │
                  │ NO    │ YES                 │
                  ▼       ▼                     │
              redirect  Create auth             │
              to /      token &                 │
              complete- redirect to             │
              profile   tenant app              │
```

### 5.2 Signin Response Variants

**Single Tenant (auto-selected):**
```typescript
{
  user: { id, email, first_name, last_name, email_verified, ... },
  session: { access_token, refresh_token, expires_at },
  current_tenant: { id, name, slug, type, plan },
  verification_status: { complete: true, missing: [], deadlines: {} },
  redirect_url: "https://{slug}.zygo.tech?auth_token=xxx"
}
```

**Multiple Tenants (show picker):**
```typescript
{
  user: { ... },
  session: { ... },
  tenants: [
    { id, name, slug, type, plan, role: { id, name }, is_owner },
    ...
  ],
  redirect_url: "/select-workspace"
}
```

**No Tenants:**
```typescript
{
  user: { ... },
  session: { ... },
  redirect_url: "/onboarding",
  message: "Please create your first workspace"
}
```

### 5.3 Account Lockout

```typescript
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// On failed password attempt
const attempts = parseInt(user.failedLoginAttempts || '0', 10) + 1;

if (attempts >= MAX_ATTEMPTS) {
  const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
  await db.update(users).set({
    failedLoginAttempts: attempts.toString(),
    lockedUntil: lockUntil,
  }).where(eq(users.id, user.id));

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'account_locked',
    details: { reason: 'too_many_failed_attempts', attempts },
  });

  return { error: 'account_locked', message: 'Account locked for 15 minutes' };
}
```

---

## 6. OAuth Authentication

### 6.1 Supported Providers

| Provider | Status | Scopes |
|----------|--------|--------|
| Google | ✅ Active | openid, profile, email |
| GitHub | ✅ Active | read:user, user:email |
| Microsoft | 🔜 Planned | openid, profile, email |
| Apple | 🔜 Planned | name, email |

### 6.2 OAuth Flows

**Flow 1: New User Signup via OAuth**
```
User clicks "Sign up with Google"
         │
         ▼
Frontend redirects to Supabase OAuth
         │
         ▼
User authenticates with Google
         │
         ▼
Supabase callback returns to frontend
         │
         ▼
Frontend has Supabase access_token
         │
         ▼
POST /api/v1/auth/oauth/complete-signup
{
  workspace_subdomain: "acme",
  plan: "core",
  ...
}
Authorization: Bearer {supabase_access_token}
         │
         ▼
Backend:
1. Validates Supabase token
2. Extracts email, name from token
3. Creates user (email_verified=true via OAuth)
4. Creates tenant
5. Creates Owner role
6. Returns auth_token redirect
```

**Flow 2: Existing User Signin via OAuth**
```
User clicks "Sign in with Google"
         │
         ▼
Frontend redirects to Supabase OAuth
         │
         ▼
User authenticates with Google
         │
         ▼
Supabase callback returns to frontend
         │
         ▼
POST /api/v1/auth/oauth/signin
{
  provider: "google",
  supabase_access_token: "xxx"
}
         │
         ▼
Backend:
1. Validates Supabase token
2. Looks up user by email
3. If no tenants: redirect to /create-workspace
4. If 1 tenant: create auth_token, redirect
5. If 2+ tenants: return tenant list
```

### 6.3 OAuth Account Linking

When an OAuth user with existing tenants tries to link a new OAuth provider:

```
OAuth login, user exists, has tenants, OAuth not linked
         │
         ▼
┌─────────────────────┐
│ Require email       │
│ verification        │
│ (6-digit code)      │
│ Max 3 attempts      │
└──────────┬──────────┘
         │
         ├──── VALID ───► Link OAuth account
         │
         └──── INVALID (3x) ───► Block request
```

**Auto-Link Rule:** If user has no tenants, OAuth is auto-linked (no data at risk).

---

## 7. Password Reset Flow

### 7.1 Three-Step Process

```
Step 1: POST /api/v1/auth/forgot-password
{email}
         │
         ▼
- Check user exists (don't reveal if not)
- Rate limit: 3 requests per hour
- Generate 6-digit code
- Store in Redis (1 hour TTL)
- Send email with code
         │
         ▼
Response: { success: true, message: "If account exists, code sent" }


Step 2: POST /api/v1/auth/verify-reset-code
{email, code}
         │
         ▼
- Check code exists in Redis
- Max 5 attempts (then invalidate)
- If valid: generate reset_token (32 chars)
- Store reset_token in Redis (15 min TTL)
- Delete the code
         │
         ▼
Response: { success: true, reset_token: "xxx", expires_in: 900 }


Step 3: POST /api/v1/auth/reset-password
{email, reset_token, password}
         │
         ▼
- Validate reset_token
- Hash new password
- Update in users table + Supabase Auth
- Delete reset_token
- Clear rate limits
- Send confirmation email
         │
         ▼
Response: { success: true, message: "Password reset successfully" }
```

### 7.2 Password Requirements

```typescript
const passwordSchema = z.string()
  .min(12, 'Password must be at least 12 characters')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');
```

---

## 8. Verification Requirements

### 8.1 Verification Deadlines

| Verification | Deadline | Enforcement |
|--------------|----------|-------------|
| **Email** | Immediate | Cannot proceed without verified email |
| **Phone (SMS)** | 3 days | After deadline, redirect to /complete-profile |
| **MFA (TOTP)** | 7 days | After deadline, redirect to /complete-profile |

### 8.2 Verification Status Check

```typescript
async function checkVerificationStatus(user: User, tenantId: string): Promise<VerificationStatus> {
  const config = await getTenantSecurityConfig(tenantId);
  const accountAgeDays = daysSince(user.createdAt);

  const status = { complete: true, missing: [], deadlines: {} };

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

### 8.3 Phone Verification (Twilio SMS)

```
POST /api/v1/auth/verify-phone/send-code
{phone, phone_country_code}
         │
         ▼
- Format E.164: +{country_code}{phone}
- Rate limit: 3 codes per hour
- Generate 6-digit code
- Store in Redis (10 min TTL)
- Send via Twilio SMS
         │
         ▼
POST /api/v1/auth/verify-phone
{code}
         │
         ▼
- Validate code (max 5 attempts)
- Update user.phoneVerified = true
- Audit log
```

### 8.4 MFA Setup (TOTP)

```
POST /api/v1/auth/mfa/setup
         │
         ▼
- Generate TOTP secret (base32, 32 chars)
- Store pending secret in Redis (10 min TTL)
- Return: secret, otpauth_uri, qr_code (base64)
         │
         ▼
POST /api/v1/auth/mfa/enable
{code, backup_code_count: 10}
         │
         ▼
- Verify TOTP code
- Generate backup codes (10 codes)
- Hash and store backup codes
- Enable MFA on user
- Return: backup_codes (display once)
```

---

## 9. Multi-Tenant User Management

### 9.1 Tenant Isolation Principle

**Critical:** Tenant apps must NOT make API calls to fetch other tenants' data.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TENANT ISOLATION                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ✅ CORRECT: Cache tenant memberships at login                              │
│                                                                              │
│     Login Response → Auth Token → tenantMemberships cached                  │
│                                   │                                          │
│                                   ▼                                          │
│     Tenant App stores in tenantStorage.set('tenant_memberships', [...])     │
│                                   │                                          │
│                                   ▼                                          │
│     Tenant Switcher reads from tenantStorage (NO API CALL)                  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ❌ WRONG: Tenant app calls GET /api/v1/tenants                             │
│                                                                              │
│     This would:                                                              │
│     - Return data about OTHER tenants                                        │
│     - Violate tenant isolation                                               │
│     - Allow cross-tenant data leakage                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Tenant Memberships in Auth Token

```typescript
// When creating auth token, include all user's tenant memberships
const userTenants = await getUserTenants(user.id);
const tenantMemberships = userTenants.map((m) => ({
  id: m.tenant.id,
  name: m.tenant.name,
  slug: m.tenant.slug,
  plan: m.tenant.plan,
  role: {
    id: m.role.id,
    name: m.role.name,
  },
  isOwner: m.isOwner,
}));

const authToken = await createAuthToken({
  userId: user.id,
  tenantId: targetTenant.id,
  // ... other fields
  supabaseAccessToken: authResult.session.access_token,
  supabaseRefreshToken: authResult.session.refresh_token,
  tenantMemberships,  // ← Cached for tenant switcher
});
```

### 9.3 Frontend Storage Pattern

```typescript
// App.tsx - After verifying auth token
const data = await verifyTokenResponse.json();

// Store tenant memberships for switcher UI (cached, no API calls needed)
if (data.tenantMemberships) {
  tenantStorage.set('tenant_memberships', JSON.stringify(data.tenantMemberships));
}

// Store Supabase tokens for authenticated API calls
if (data.session?.access_token) {
  sessionStorage.setItem('access_token', data.session.access_token);
  if (data.session.refresh_token) {
    sessionStorage.setItem('refresh_token', data.session.refresh_token);
  }
}
```

---

## 10. Tenant Switching

### 10.1 Switch Tenant Flow

```
User clicks on different tenant in switcher
         │
         ▼
┌─────────────────────┐
│ POST /api/v1/auth/  │
│ signin/switch-tenant│
│ {tenant_slug}       │
│ Authorization:      │
│ Bearer {supabase_   │
│ access_token}       │
└──────────┬──────────┘
         │
         ▼
┌─────────────────────┐
│ Validate Supabase   │
│ token               │
└──────────┬──────────┘
         │
         ▼
┌─────────────────────┐
│ Look up user by     │
│ email (handles      │
│ OAuth ID mismatch)  │
└──────────┬──────────┘
         │
         ▼
┌─────────────────────┐
│ Verify user is      │──── NOT MEMBER ──► 403: "Not a member"
│ member of target    │
│ tenant              │
└──────────┬──────────┘
         │
         ▼
┌─────────────────────┐
│ Get membership      │
│ with role info      │
└──────────┬──────────┘
         │
         ▼
┌─────────────────────┐
│ Refresh tenant      │
│ memberships list    │
└──────────┬──────────┘
         │
         ▼
┌─────────────────────┐
│ Create new auth     │
│ token for target    │
│ tenant              │
└──────────┬──────────┘
         │
         ▼
┌─────────────────────┐
│ Return:             │
│ { auth_token,       │
│   tenant: {...} }   │
└─────────────────────┘
         │
         ▼
Frontend:
1. Clean up browser state
2. Clear tenantStorage
3. Clear caches
4. Redirect to new tenant
   with auth_token
```

### 10.2 Browser State Cleanup on Switch

```typescript
// ProfileMenu.tsx - cleanupBrowserState()
const cleanupBrowserState = async () => {
  // 1. Clear all tenant-scoped storage
  tenantStorage.clear();

  // 2. Clear ALL localStorage items with zygo prefix
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('zygo:')) localStorage.removeItem(key);
  });

  // 3. Clear ALL sessionStorage items
  Object.keys(sessionStorage).forEach(key => {
    if (key.startsWith('zygo:') || key === 'access_token' || key === 'refresh_token') {
      sessionStorage.removeItem(key);
    }
  });

  // 4. Reset application state
  await resetOnFullLogout();

  // 5. Clear any cached data
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
  }
};
```

---

## 11. RBAC System

### 11.1 Role Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  OWNER ROLE (Auto-created, PROTECTED)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
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
├─────────────────────────────────────────────────────────────────────────────┤
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

### 11.2 Default Roles

| Role | Hierarchy | Permissions | Description |
|------|-----------|-------------|-------------|
| Owner | 1 | All 114 | Full access, protected |
| Admin | 10 | ~100 | Full access except billing |
| Billing Admin | 20 | Billing only | Manage subscriptions |
| Developer | 30 | Dev tools | Workflows, APIs, secrets |
| Member | 50 | Basic | View and basic editing |
| Viewer | 90 | Read-only | View only |

### 11.3 Permission Categories (114 Total)

```
Workflows (10)
├── canViewWorkflows, canCreateWorkflows, canEditWorkflows, canDeleteWorkflows
├── canExecuteWorkflows, canScheduleWorkflows, canViewWorkflowHistory
├── canExportWorkflows, canImportWorkflows, canManageWorkflowVersions

AI (8)
├── canViewAI, canUseAI, canConfigureAI, canManageAIAgents
├── canViewAIHistory, canExportAIData, canManageAIModels, canManageAIBudget

Data Sources (8)
├── canViewDataSources, canCreateDataSources, canEditDataSources
├── canDeleteDataSources, canConnectDataSources, canSyncDataSources
├── canViewDataSourceLogs, canManageDataSourceCredentials

Infrastructure (12)
├── canViewServers, canCreateServers, canEditServers, canDeleteServers
├── canStartServers, canStopServers, canRebuildServers, canResizeServers
├── canViewSnapshots, canCreateSnapshots, canRestoreSnapshots, canDeleteSnapshots

... and more categories
```

---

## 12. Permission Resolution & Caching

### 12.1 Permission Check Flow

```
API Request
         │
         ▼
┌─────────────────────┐
│ Check Redis Cache   │
│ Key: rbac:{user}:   │
│      {tenant}       │
└──────────┬──────────┘
         │
   ┌─────┴─────┐
   │ MISS      │ HIT
   ▼           ▼
Load from   Use cached
DB, cache   permissions
5 min
         │
         ▼
┌─────────────────────┐
│ Permission in set?  │──── NO ───► 403 DENY
└──────────┬──────────┘
           │ YES
           ▼
┌─────────────────────┐
│ Critical action?    │──── YES ──► Check MFA (15 min window)
│ (delete, export)    │
└──────────┬──────────┘
           │ NO
           ▼
        ALLOW
```

### 12.2 Permission Merge (UNION)

```typescript
// All permissions from primary role + all active secondary roles
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

// Secondary roles (time-limited)
for (const sra of membership.secondaryRoles) {
  for (const rp of sra.role.permissions) {
    if (!permissions.has(rp.permission.key)) {
      permissions.set(rp.permission.key, { ... });
    }
  }
}
```

### 12.3 Cache Invalidation

```typescript
// Invalidate on:
// - Role assigned to user
// - Role removed from user
// - Role permissions modified
// - Secondary role assigned/expired/revoked
// - User's primary role changed

async function invalidatePermissionCache(userId: string, tenantId: string) {
  const key = `rbac:${userId}:${tenantId}`;
  await redis.del(key);

  // Publish for distributed systems
  await redis.publish('rbac:invalidate', JSON.stringify({ userId, tenantId }));
}
```

---

## 13. Account Linking Strategy

### 13.1 Linking Rules

| Scenario | Has Tenants? | Action |
|----------|-------------|--------|
| OAuth login, user doesn't exist | - | Create user (signup) |
| OAuth login, user exists, OAuth not linked | **No** | Auto-link |
| OAuth login, user exists, OAuth not linked | **Yes** | **Require email verification** |
| OAuth login, OAuth already linked | - | Update tokens, proceed |

### 13.2 Unlinking OAuth

```typescript
// When unlinking the ONLY OAuth provider that verified the email
if (user.emailVerifiedVia === provider && !user.passwordHash) {
  // Reset email verification
  await db.update(users).set({
    emailVerified: false,
    emailVerifiedVia: null,
  }).where(eq(users.id, user.id));

  return { emailVerificationReset: true };
}
```

---

## 14. Session Management

### 14.1 Token Lifetimes

| Token | Lifetime | Storage |
|-------|----------|---------|
| Supabase Access Token | 1 hour | sessionStorage |
| Supabase Refresh Token | 7 days | sessionStorage |
| Auth Token (cross-domain) | 2 minutes | Redis |
| MFA Session | 15 minutes | Redis |

### 14.2 Token Refresh

```typescript
// Frontend: Supabase handles refresh automatically
await supabase.auth.setSession({
  access_token: data.session.access_token,
  refresh_token: data.session.refresh_token,
});

// Supabase will refresh the access token before expiry
```

---

## 15. Admin Panel Authentication

| Rule | Value |
|------|-------|
| Auth Methods | Email/Password **ONLY** |
| MFA | **Mandatory** |
| OAuth | **Not allowed** |
| Session | 4 hours max |
| IP Restriction | Optional whitelist |

---

## 16. API Endpoints Reference

### Authentication

```
# Signup
POST /api/v1/auth/signup                    # Full onboarding signup
POST /api/v1/auth/signup/create-workspace   # Existing user creates workspace
GET  /api/v1/auth/signup/check-slug/:slug   # Check slug availability
GET  /api/v1/auth/signup/check-email/:email # Check email availability
POST /api/v1/auth/signup/verify-password    # Verify password for existing user
GET  /api/v1/auth/signup/plans              # Get available plans

# Signin
POST /api/v1/auth/signin                    # Email/password signin
POST /api/v1/auth/signin/switch-tenant      # Switch to different tenant
POST /api/v1/auth/signin/signout            # Sign out

# OAuth
POST /api/v1/auth/oauth/callback            # Exchange OAuth code
POST /api/v1/auth/oauth/signin              # OAuth signin
POST /api/v1/auth/oauth/complete-signup     # Complete OAuth signup
POST /api/v1/auth/oauth/link/initiate       # Start account linking
POST /api/v1/auth/oauth/link/verify         # Complete account linking
GET  /api/v1/auth/oauth/providers           # List linked providers
DELETE /api/v1/auth/oauth/providers/:p      # Unlink provider

# Token Verification
POST /api/v1/auth/verify-token              # Verify auth token (cross-domain)

# Password Reset
POST /api/v1/auth/forgot-password           # Request reset code
POST /api/v1/auth/verify-reset-code         # Verify code, get token
POST /api/v1/auth/reset-password            # Reset password
GET  /api/v1/auth/reset-status              # Check reset status

# Email Verification
POST /api/v1/auth/verify-email              # Verify email code
POST /api/v1/auth/verify-email/resend       # Resend verification
GET  /api/v1/auth/verify-email/status       # Check verification status

# Phone Verification
POST /api/v1/auth/verify-phone/send-code    # Send SMS code
POST /api/v1/auth/verify-phone              # Verify phone code
GET  /api/v1/auth/verify-phone/status       # Check phone status

# MFA
POST /api/v1/auth/mfa/setup                 # Start MFA setup
POST /api/v1/auth/mfa/enable                # Enable MFA
POST /api/v1/auth/mfa/verify                # Verify MFA code
POST /api/v1/auth/mfa/disable               # Disable MFA
POST /api/v1/auth/mfa/backup-codes          # Regenerate backup codes
GET  /api/v1/auth/mfa/status                # Get MFA status
```

---

## 17. Implementation Checklist

### Phase 1: Core Auth ✅
- [x] Signup with Owner role creation
- [x] Email verification
- [x] Signin with verification check
- [x] Complete profile page
- [x] Phone verification (Twilio)
- [x] MFA setup (TOTP)
- [x] Password reset (3-step)

### Phase 2: Cross-Domain Auth ✅
- [x] Auth token service (Redis)
- [x] verify-token endpoint
- [x] Frontend token verification
- [x] Supabase token passthrough

### Phase 3: Multi-Tenant ✅
- [x] Tenant memberships caching
- [x] Tenant switching
- [x] Browser state cleanup
- [x] Tenant isolation enforcement

### Phase 4: OAuth ✅
- [x] Google OAuth
- [x] GitHub OAuth
- [x] Account linking with verification
- [x] Auto-link for users without tenants

### Phase 5: RBAC ✅
- [x] Permission resolution with Redis cache
- [x] Immediate cache invalidation
- [x] Custom role CRUD
- [x] Owner role protection
- [x] Role assignment with hierarchy check

### Phase 6: Enterprise (In Progress)
- [ ] Microsoft OAuth
- [ ] Apple OAuth
- [ ] SAML/OIDC configuration
- [ ] Domain claiming
- [ ] Admin panel (email + MFA only)

---

*Version: 2.0.0 | February 2, 2026*
