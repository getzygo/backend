# Zygo Application Development Plan

**Version:** 1.0.0
**Last Updated:** January 28, 2026
**Status:** Strategic Development Guide
**Scope:** Full-Stack Application Development

---

## Executive Summary

This document provides a complete development plan for building the Zygo platform from scratch. It covers the entire application lifecycle from authentication to the AI workflow engine, organized in a logical sequence that respects dependencies and delivers incremental value.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ZYGO APPLICATION DEVELOPMENT OVERVIEW                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   MILESTONE 1        MILESTONE 2         MILESTONE 3        MILESTONE 4     │
│   Foundation         Core Platform       Infrastructure     AI & Workflows  │
│                                                                              │
│   ┌──────────┐      ┌──────────┐        ┌──────────┐       ┌──────────┐    │
│   │  Auth    │      │  Tenant  │        │  Cloud   │       │ Workflow │    │
│   │  Users   │─────▶│  Teams   │───────▶│  Servers │──────▶│  Nodes   │    │
│   │  RBAC    │      │  Billing │        │  Network │       │ AI Agent │    │
│   └──────────┘      └──────────┘        └──────────┘       └──────────┘    │
│                                                                              │
│   Week 1-4           Week 5-8            Week 9-12          Week 13-16      │
│                                                                              │
│                           MILESTONE 5                                        │
│                      Production & Scale                                      │
│                                                                              │
│                      ┌──────────────┐                                       │
│                      │  Compliance  │                                       │
│                      │  Admin Panel │                                       │
│                      │  Monitoring  │                                       │
│                      └──────────────┘                                       │
│                                                                              │
│                         Week 17-20                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

1. [Development Principles](#development-principles)
2. [Milestone 1: Foundation](#milestone-1-foundation)
3. [Milestone 2: Core Platform](#milestone-2-core-platform)
4. [Milestone 3: Infrastructure Management](#milestone-3-infrastructure-management)
5. [Milestone 4: AI & Workflow Engine](#milestone-4-ai--workflow-engine)
6. [Milestone 5: Production & Scale](#milestone-5-production--scale)
7. [API Development Sequence](#api-development-sequence)
8. [Frontend Development Sequence](#frontend-development-sequence)
9. [Testing Strategy](#testing-strategy)
10. [Definition of Done](#definition-of-done)

---

## Development Principles

### 1. Dependency-Driven Sequencing
Build features in order of dependency. Authentication must exist before user management. Tenants must exist before team management.

### 2. Vertical Slices
Develop complete features (API + Frontend + Tests) rather than building all APIs first then all UIs.

### 3. Security First
Implement security controls (auth, RBAC, RLS) before building features that require them.

### 4. Incremental Value
Each milestone delivers a usable, deployable product increment.

### 5. Contract-Driven Development
Use existing contracts (`api_contract.yaml`, `db_contract.md`, `rbac_contract.md`) as the source of truth.

---

## Milestone 1: Foundation

**Duration:** Week 1-4
**Goal:** Users can sign up, log in, and access a protected dashboard
**Deliverable:** Working authentication system with basic user management

### Phase 1.1: Authentication - Email/Password (Week 1)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement signup endpoint | `POST /auth/signup` | users | AUTHENTICATION.md |
| 2 | Implement email verification | `POST /auth/verify-email` | email_verification_tokens | AUTHENTICATION.md |
| 3 | Implement login endpoint | `POST /auth/login` | sessions | AUTHENTICATION.md |
| 4 | Implement JWT token generation | - | - | AUTHENTICATION.md |
| 5 | Implement token refresh | `POST /auth/refresh` | sessions | AUTHENTICATION.md |
| 6 | Implement logout | `POST /auth/logout` | sessions | AUTHENTICATION.md |
| 7 | Implement password reset request | `POST /auth/forgot-password` | password_reset_tokens | AUTHENTICATION.md |
| 8 | Implement password reset confirm | `POST /auth/reset-password` | users | AUTHENTICATION.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create signup page | `/signup` | FRONTEND_ARCHITECTURE.md |
| 2 | Create login page | `/login` | FRONTEND_ARCHITECTURE.md |
| 3 | Create email verification page | `/verify-email` | FRONTEND_ARCHITECTURE.md |
| 4 | Create forgot password page | `/forgot-password` | FRONTEND_ARCHITECTURE.md |
| 5 | Create reset password page | `/reset-password` | FRONTEND_ARCHITECTURE.md |
| 6 | Implement auth context/provider | AuthProvider | FRONTEND_ARCHITECTURE.md |
| 7 | Implement protected route wrapper | ProtectedRoute | FRONTEND_ARCHITECTURE.md |
| 8 | Create basic dashboard shell | `/dashboard` | FRONTEND_ARCHITECTURE.md |

#### User Journey: Basic Authentication

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER JOURNEY: AUTHENTICATION                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  NEW USER SIGNUP                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │ Landing │───▶│ Signup  │───▶│ Verify  │───▶│ Login   │───▶│Dashboard│  │
│  │  Page   │    │  Form   │    │ Email   │    │  Page   │    │  Home   │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                                              │
│  RETURNING USER                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                                 │
│  │ Landing │───▶│  Login  │───▶│Dashboard│                                 │
│  │  Page   │    │  Form   │    │  Home   │                                 │
│  └─────────┘    └─────────┘    └─────────┘                                 │
│                                                                              │
│  PASSWORD RESET                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐                  │
│  │  Login  │───▶│ Forgot  │───▶│ Check   │───▶│ Reset   │                  │
│  │  Page   │    │Password │    │ Email   │    │Password │                  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 1.2: Multi-Factor Authentication (Week 2)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement TOTP setup | `POST /auth/mfa/totp/setup` | mfa_tokens | AUTHENTICATION.md |
| 2 | Implement TOTP verification | `POST /auth/mfa/totp/verify` | mfa_tokens | AUTHENTICATION.md |
| 3 | Implement TOTP disable | `DELETE /auth/mfa/totp` | mfa_tokens | AUTHENTICATION.md |
| 4 | Implement backup codes generation | `POST /auth/mfa/backup-codes` | mfa_backup_codes | AUTHENTICATION.md |
| 5 | Implement SMS MFA setup | `POST /auth/mfa/sms/setup` | mfa_tokens | AUTHENTICATION.md |
| 6 | Implement SMS MFA verification | `POST /auth/mfa/sms/verify` | mfa_tokens | AUTHENTICATION.md |
| 7 | Implement phone verification | `POST /auth/phone/verify` | users | AUTHENTICATION.md |
| 8 | Update login flow for MFA challenge | `POST /auth/login` (update) | - | AUTHENTICATION.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create MFA setup page | `/settings/security/mfa` | AUTHENTICATION.md |
| 2 | Create TOTP setup wizard | TOTPSetupWizard | AUTHENTICATION.md |
| 3 | Create MFA challenge page | `/auth/mfa-challenge` | AUTHENTICATION.md |
| 4 | Create backup codes display | BackupCodesModal | AUTHENTICATION.md |
| 5 | Create phone verification flow | PhoneVerification | AUTHENTICATION.md |
| 6 | Update login flow for MFA | Login (update) | AUTHENTICATION.md |

### Phase 1.3: Social OAuth (Week 2-3)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement Google OAuth | `GET /auth/oauth/google`, `GET /auth/oauth/google/callback` | oauth_accounts | OAUTH_STRATEGY.md |
| 2 | Implement GitHub OAuth | `GET /auth/oauth/github`, `GET /auth/oauth/github/callback` | oauth_accounts | OAUTH_STRATEGY.md |
| 3 | Implement Microsoft OAuth | `GET /auth/oauth/microsoft`, `GET /auth/oauth/microsoft/callback` | oauth_accounts | OAUTH_STRATEGY.md |
| 4 | Implement Apple OAuth | `GET /auth/oauth/apple`, `GET /auth/oauth/apple/callback` | oauth_accounts | OAUTH_STRATEGY.md |
| 5 | Implement OAuth account linking | `POST /auth/oauth/link` | oauth_accounts | OAUTH_STRATEGY.md |
| 6 | Implement OAuth account unlinking | `DELETE /auth/oauth/{provider}` | oauth_accounts | OAUTH_STRATEGY.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Add OAuth buttons to login page | SocialLoginButtons | OAUTH_STRATEGY.md |
| 2 | Add OAuth buttons to signup page | SocialLoginButtons | OAUTH_STRATEGY.md |
| 3 | Create OAuth callback handler | `/auth/oauth/callback` | OAUTH_STRATEGY.md |
| 4 | Create connected accounts settings | `/settings/security/connected-accounts` | OAUTH_STRATEGY.md |

### Phase 1.4: User Profile & Basic RBAC (Week 3-4)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement get current user | `GET /users/me` | users | api_contract.yaml |
| 2 | Implement update profile | `PATCH /users/me` | users | api_contract.yaml |
| 3 | Implement change password | `POST /users/me/change-password` | users | api_contract.yaml |
| 4 | Implement user preferences | `GET/PATCH /users/me/preferences` | user_preferences | api_contract.yaml |
| 5 | Seed default permissions | - | permissions | rbac_contract.md |
| 6 | Seed default roles | - | roles | rbac_contract.md |
| 7 | Implement permission check middleware | - | - | rbac_contract.md |
| 8 | Implement role hierarchy validation | - | - | rbac_contract.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create profile page | `/settings/profile` | FRONTEND_ARCHITECTURE.md |
| 2 | Create profile edit form | ProfileForm | FRONTEND_ARCHITECTURE.md |
| 3 | Create avatar upload | AvatarUpload | FRONTEND_ARCHITECTURE.md |
| 4 | Create change password form | ChangePasswordForm | FRONTEND_ARCHITECTURE.md |
| 5 | Create preferences page | `/settings/preferences` | FRONTEND_ARCHITECTURE.md |
| 6 | Implement RBAC context | RBACProvider | rbac_contract.md |
| 7 | Create permission gate component | PermissionGate | rbac_contract.md |

### Milestone 1 Checklist

- [ ] Users can sign up with email/password
- [ ] Email verification works
- [ ] Users can log in
- [ ] JWT tokens issued and refreshed
- [ ] Password reset works
- [ ] TOTP MFA can be enabled
- [ ] SMS MFA can be enabled
- [ ] Google OAuth works
- [ ] GitHub OAuth works
- [ ] Users can view/edit profile
- [ ] Users can change password
- [ ] Default roles seeded
- [ ] Default permissions seeded
- [ ] Permission checks enforced
- [ ] Protected routes work

---

## Milestone 2: Core Platform

**Duration:** Week 5-8
**Goal:** Multi-tenant platform with team management and billing
**Deliverable:** Users can create organizations, invite team members, and manage subscriptions

### Phase 2.1: Tenant Management (Week 5)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement tenant creation | `POST /tenants` | tenants | TENANCY.md |
| 2 | Implement tenant retrieval | `GET /tenants/{id}` | tenants | TENANCY.md |
| 3 | Implement tenant update | `PATCH /tenants/{id}` | tenants | TENANCY.md |
| 4 | Implement tenant settings | `GET/PATCH /tenants/{id}/settings` | tenant_settings | TENANCY.md |
| 5 | Implement tenant features | `GET /tenants/{id}/features` | tenant_features | TENANCY.md |
| 6 | Implement custom domain | `POST/DELETE /tenants/{id}/domains` | tenant_domains | TENANCY.md |
| 7 | Implement tenant context middleware | - | - | TENANCY.md |
| 8 | Apply RLS policies for tenant isolation | - | All tables | db_contract.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create tenant creation flow | `/onboarding/create-organization` | TENANCY.md |
| 2 | Create organization settings page | `/settings/organization` | TENANCY.md |
| 3 | Create branding settings | `/settings/organization/branding` | TENANCY.md |
| 4 | Create custom domain settings | `/settings/organization/domain` | TENANCY.md |
| 5 | Implement tenant context provider | TenantProvider | TENANCY.md |
| 6 | Implement subdomain detection | useTenantMode hook | TENANCY.md |

#### User Journey: Tenant Creation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      USER JOURNEY: TENANT CREATION                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │  Login  │───▶│ No Org? │───▶│ Create  │───▶│ Choose  │───▶│ Setup   │  │
│  │         │    │Redirect │    │Org Name │    │  Plan   │    │ Welcome │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                      │                                              │       │
│                      │         ┌─────────┐                          │       │
│                      └────────▶│ Join    │──────────────────────────┘       │
│                                │Existing │                                   │
│                                └─────────┘                                   │
│                                                                              │
│  POST-CREATION SETUP                                                         │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐                  │
│  │ Upload  │───▶│  Invite │───▶│ Connect │───▶│Dashboard│                  │
│  │  Logo   │    │  Team   │    │ Cloud   │    │  Home   │                  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 2.2: Team & User Management (Week 6)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement list tenant users | `GET /tenants/{id}/users` | users, user_roles | api_contract.yaml |
| 2 | Implement invite user | `POST /tenants/{id}/invitations` | invitations | api_contract.yaml |
| 3 | Implement accept invitation | `POST /invitations/{token}/accept` | invitations, users | api_contract.yaml |
| 4 | Implement revoke invitation | `DELETE /invitations/{id}` | invitations | api_contract.yaml |
| 5 | Implement remove user from tenant | `DELETE /tenants/{id}/users/{userId}` | user_roles | api_contract.yaml |
| 6 | Implement update user role | `PATCH /tenants/{id}/users/{userId}/role` | user_roles | api_contract.yaml |
| 7 | Implement suspend/activate user | `POST /users/{id}/suspend`, `POST /users/{id}/activate` | users | api_contract.yaml |
| 8 | Implement user search/filter | `GET /tenants/{id}/users?search=&role=` | users | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create team members page | `/settings/team` | FRONTEND_ARCHITECTURE.md |
| 2 | Create user list table | UserTable | FRONTEND_ARCHITECTURE.md |
| 3 | Create invite user modal | InviteUserModal | FRONTEND_ARCHITECTURE.md |
| 4 | Create invitation accept page | `/invitations/accept` | FRONTEND_ARCHITECTURE.md |
| 5 | Create user detail/edit modal | UserDetailModal | FRONTEND_ARCHITECTURE.md |
| 6 | Create role assignment dropdown | RoleSelect | rbac_contract.md |
| 7 | Create user status toggle | UserStatusToggle | FRONTEND_ARCHITECTURE.md |

### Phase 2.3: Role & Permission Management (Week 6-7)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement list roles | `GET /roles` | roles | rbac_contract.md |
| 2 | Implement get role | `GET /roles/{id}` | roles, role_permissions | rbac_contract.md |
| 3 | Implement create custom role | `POST /roles` | roles | rbac_contract.md |
| 4 | Implement update role | `PATCH /roles/{id}` | roles | rbac_contract.md |
| 5 | Implement delete role | `DELETE /roles/{id}` | roles | rbac_contract.md |
| 6 | Implement list permissions | `GET /permissions` | permissions | rbac_contract.md |
| 7 | Implement assign permissions to role | `POST /roles/{id}/permissions` | role_permissions | rbac_contract.md |
| 8 | Implement role hierarchy validation | - | roles | rbac_contract.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create roles list page | `/settings/roles` | rbac_contract.md |
| 2 | Create role detail page | `/settings/roles/{id}` | rbac_contract.md |
| 3 | Create role creation form | CreateRoleForm | rbac_contract.md |
| 4 | Create permission matrix | PermissionMatrix | rbac_contract.md |
| 5 | Create role hierarchy visualization | RoleHierarchyTree | rbac_contract.md |
| 6 | Create permission category accordion | PermissionCategories | rbac_contract.md |

### Phase 2.4: Billing & Subscription (Week 7-8)

#### Payment Providers

| Provider | Purpose | Features |
|----------|---------|----------|
| **PayPal** | Primary payment method | Subscriptions, one-time payments, PayPal balance, linked cards |
| **Revolut** | Card payments | Credit/debit cards via Revolut Pay |

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Integrate PayPal SDK | - | - | api_contract.yaml |
| 2 | Integrate Revolut Pay API | - | - | api_contract.yaml |
| 3 | Implement create subscription | `POST /billing/subscriptions` | subscriptions | api_contract.yaml |
| 4 | Implement get subscription | `GET /billing/subscriptions/current` | subscriptions | api_contract.yaml |
| 5 | Implement update subscription (upgrade/downgrade) | `PATCH /billing/subscriptions/{id}` | subscriptions | api_contract.yaml |
| 6 | Implement cancel subscription | `DELETE /billing/subscriptions/{id}` | subscriptions | api_contract.yaml |
| 7 | Implement payment methods | `GET/POST/DELETE /billing/payment-methods` | payment_methods | api_contract.yaml |
| 8 | Implement invoices | `GET /billing/invoices` | invoices | api_contract.yaml |
| 9 | Implement usage tracking | `GET /billing/usage` | usage_logs | api_contract.yaml |
| 10 | Implement PayPal webhooks | `POST /webhooks/paypal` | - | api_contract.yaml |
| 11 | Implement Revolut webhooks | `POST /webhooks/revolut` | - | api_contract.yaml |
| 12 | Implement plan-based feature gates | - | tenant_features | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create billing overview page | `/settings/billing` | FRONTEND_ARCHITECTURE.md |
| 2 | Create plan selection page | `/settings/billing/plans` | FRONTEND_ARCHITECTURE.md |
| 3 | Create payment method management | `/settings/billing/payment` | FRONTEND_ARCHITECTURE.md |
| 4 | Create PayPal button integration | PayPalButton | FRONTEND_ARCHITECTURE.md |
| 5 | Create Revolut Pay integration | RevolutPayButton | FRONTEND_ARCHITECTURE.md |
| 6 | Create invoices list | `/settings/billing/invoices` | FRONTEND_ARCHITECTURE.md |
| 7 | Create usage dashboard | `/settings/billing/usage` | FRONTEND_ARCHITECTURE.md |
| 8 | Create upgrade/downgrade flow | PlanChangeFlow | FRONTEND_ARCHITECTURE.md |

#### User Journey: Billing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        USER JOURNEY: BILLING                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  INITIAL SUBSCRIPTION                                                        │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │ Create  │───▶│ Select  │───▶│ Choose  │───▶│ Confirm │───▶│ Active  │  │
│  │  Org    │    │  Plan   │    │ Payment │    │ Purchase│    │  Plan   │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                      │                                       │
│                          ┌───────────┴───────────┐                          │
│                          │                       │                          │
│                          ▼                       ▼                          │
│                    ┌──────────┐           ┌──────────┐                      │
│                    │  PayPal  │           │ Revolut  │                      │
│                    │  Button  │           │Card Pay  │                      │
│                    └──────────┘           └──────────┘                      │
│                                                                              │
│  PLAN UPGRADE                                                                │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐                  │
│  │ Billing │───▶│ Compare │───▶│ Confirm │───▶│ Upgraded│                  │
│  │Settings │    │  Plans  │    │ Prorate │    │  Plan   │                  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘                  │
│                                                                              │
│  INVOICE MANAGEMENT                                                          │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                                 │
│  │ Billing │───▶│ Invoice │───▶│Download │                                 │
│  │Settings │    │  List   │    │   PDF   │                                 │
│  └─────────┘    └─────────┘    └─────────┘                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Milestone 2 Checklist

- [ ] Users can create organizations (tenants)
- [ ] Tenant isolation (RLS) enforced
- [ ] Users can configure organization settings
- [ ] Custom branding (logo, colors) works
- [ ] Custom domain support
- [ ] Users can invite team members
- [ ] Invitations can be accepted/revoked
- [ ] Users can be assigned roles
- [ ] Custom roles can be created
- [ ] Permission matrix works
- [ ] Stripe integration complete
- [ ] Subscriptions can be created
- [ ] Plan upgrades/downgrades work
- [ ] Payment methods managed
- [ ] Invoices displayed
- [ ] Usage tracking works
- [ ] Feature gates based on plan

---

## Milestone 3: Infrastructure Management

**Duration:** Week 9-12
**Goal:** Users can manage cloud infrastructure (BYC - Bring Your Own Cloud)
**Deliverable:** Complete server, storage, and network management

### Phase 3.1: Cloud Provider Integration (Week 9)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement cloud provider credentials | `POST /cloud-providers` | cloud_providers | api_contract.yaml |
| 2 | Implement list cloud providers | `GET /cloud-providers` | cloud_providers | api_contract.yaml |
| 3 | Implement delete cloud provider | `DELETE /cloud-providers/{id}` | cloud_providers | api_contract.yaml |
| 4 | Implement Hetzner API client | - | - | api_contract.yaml |
| 5 | Implement AWS API client | - | - | api_contract.yaml |
| 6 | Implement credential encryption | - | cloud_providers | SECRETS_AND_ENVIRONMENT.md |
| 7 | Implement credential validation | `POST /cloud-providers/validate` | - | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create cloud providers page | `/settings/cloud-providers` | FRONTEND_ARCHITECTURE.md |
| 2 | Create add provider wizard | AddProviderWizard | FRONTEND_ARCHITECTURE.md |
| 3 | Create provider credential forms | ProviderCredentialForm | FRONTEND_ARCHITECTURE.md |
| 4 | Create provider status indicators | ProviderStatus | FRONTEND_ARCHITECTURE.md |

### Phase 3.2: Server Management (Week 9-10)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement create server | `POST /servers` | servers | api_contract.yaml |
| 2 | Implement list servers | `GET /servers` | servers | api_contract.yaml |
| 3 | Implement get server | `GET /servers/{id}` | servers | api_contract.yaml |
| 4 | Implement update server | `PATCH /servers/{id}` | servers | api_contract.yaml |
| 5 | Implement delete server | `DELETE /servers/{id}` | servers | api_contract.yaml |
| 6 | Implement server actions (start/stop/reboot) | `POST /servers/{id}/actions/{action}` | servers | api_contract.yaml |
| 7 | Implement server resize | `POST /servers/{id}/resize` | servers | api_contract.yaml |
| 8 | Implement server metrics | `GET /servers/{id}/metrics` | server_metrics | api_contract.yaml |
| 9 | Implement server console | `GET /servers/{id}/console` | - | api_contract.yaml |
| 10 | Implement server rebuild | `POST /servers/{id}/rebuild` | servers | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create servers list page | `/infrastructure/servers` | FRONTEND_ARCHITECTURE.md |
| 2 | Create server detail page | `/infrastructure/servers/{id}` | FRONTEND_ARCHITECTURE.md |
| 3 | Create server creation wizard | CreateServerWizard | FRONTEND_ARCHITECTURE.md |
| 4 | Create server actions menu | ServerActionsMenu | FRONTEND_ARCHITECTURE.md |
| 5 | Create server metrics dashboard | ServerMetrics | FRONTEND_ARCHITECTURE.md |
| 6 | Create web console component | WebConsole | FRONTEND_ARCHITECTURE.md |
| 7 | Create server resize modal | ResizeServerModal | FRONTEND_ARCHITECTURE.md |

### Phase 3.3: Storage & Volumes (Week 10-11)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement create volume | `POST /volumes` | volumes | api_contract.yaml |
| 2 | Implement list volumes | `GET /volumes` | volumes | api_contract.yaml |
| 3 | Implement get volume | `GET /volumes/{id}` | volumes | api_contract.yaml |
| 4 | Implement resize volume | `POST /volumes/{id}/resize` | volumes | api_contract.yaml |
| 5 | Implement attach volume | `POST /volumes/{id}/attach` | volumes | api_contract.yaml |
| 6 | Implement detach volume | `POST /volumes/{id}/detach` | volumes | api_contract.yaml |
| 7 | Implement delete volume | `DELETE /volumes/{id}` | volumes | api_contract.yaml |
| 8 | Implement create snapshot | `POST /snapshots` | snapshots | api_contract.yaml |
| 9 | Implement list snapshots | `GET /snapshots` | snapshots | api_contract.yaml |
| 10 | Implement restore from snapshot | `POST /snapshots/{id}/restore` | snapshots | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create volumes list page | `/infrastructure/volumes` | FRONTEND_ARCHITECTURE.md |
| 2 | Create volume detail page | `/infrastructure/volumes/{id}` | FRONTEND_ARCHITECTURE.md |
| 3 | Create volume creation form | CreateVolumeForm | FRONTEND_ARCHITECTURE.md |
| 4 | Create attach/detach dialogs | VolumeAttachDialog | FRONTEND_ARCHITECTURE.md |
| 5 | Create snapshots list | `/infrastructure/snapshots` | FRONTEND_ARCHITECTURE.md |
| 6 | Create snapshot creation modal | CreateSnapshotModal | FRONTEND_ARCHITECTURE.md |

### Phase 3.4: Networking (Week 11-12)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement create network/VPC | `POST /networks` | networks | api_contract.yaml |
| 2 | Implement list networks | `GET /networks` | networks | api_contract.yaml |
| 3 | Implement create subnet | `POST /networks/{id}/subnets` | subnets | api_contract.yaml |
| 4 | Implement create firewall | `POST /firewalls` | firewalls | api_contract.yaml |
| 5 | Implement firewall rules | `POST /firewalls/{id}/rules` | firewall_rules | api_contract.yaml |
| 6 | Implement create load balancer | `POST /load-balancers` | load_balancers | api_contract.yaml |
| 7 | Implement LB target groups | `POST /load-balancers/{id}/targets` | lb_targets | api_contract.yaml |
| 8 | Implement floating IPs | `POST /floating-ips` | floating_ips | api_contract.yaml |
| 9 | Implement assign floating IP | `POST /floating-ips/{id}/assign` | floating_ips | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create networks list page | `/infrastructure/networks` | FRONTEND_ARCHITECTURE.md |
| 2 | Create network detail/topology | `/infrastructure/networks/{id}` | FRONTEND_ARCHITECTURE.md |
| 3 | Create firewalls page | `/infrastructure/firewalls` | FRONTEND_ARCHITECTURE.md |
| 4 | Create firewall rules editor | FirewallRulesEditor | FRONTEND_ARCHITECTURE.md |
| 5 | Create load balancers page | `/infrastructure/load-balancers` | FRONTEND_ARCHITECTURE.md |
| 6 | Create LB configuration wizard | LBConfigWizard | FRONTEND_ARCHITECTURE.md |
| 7 | Create floating IPs page | `/infrastructure/floating-ips` | FRONTEND_ARCHITECTURE.md |

### Phase 3.5: DNS Management (Week 12)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement create DNS zone | `POST /dns/zones` | dns_zones | api_contract.yaml |
| 2 | Implement list DNS zones | `GET /dns/zones` | dns_zones | api_contract.yaml |
| 3 | Implement create DNS record | `POST /dns/zones/{id}/records` | dns_records | api_contract.yaml |
| 4 | Implement update DNS record | `PATCH /dns/records/{id}` | dns_records | api_contract.yaml |
| 5 | Implement delete DNS record | `DELETE /dns/records/{id}` | dns_records | api_contract.yaml |
| 6 | Implement DNS propagation check | `GET /dns/zones/{id}/check` | - | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create DNS zones list | `/infrastructure/dns` | FRONTEND_ARCHITECTURE.md |
| 2 | Create zone detail page | `/infrastructure/dns/{id}` | FRONTEND_ARCHITECTURE.md |
| 3 | Create DNS record editor | DNSRecordEditor | FRONTEND_ARCHITECTURE.md |
| 4 | Create propagation checker | PropagationChecker | FRONTEND_ARCHITECTURE.md |

### Milestone 3 Checklist

- [ ] Cloud provider credentials stored securely
- [ ] Hetzner integration works
- [ ] AWS integration works
- [ ] Servers can be created/managed
- [ ] Server actions (start/stop/reboot) work
- [ ] Server metrics displayed
- [ ] Web console accessible
- [ ] Volumes can be created/attached
- [ ] Snapshots can be created/restored
- [ ] Networks/VPCs can be created
- [ ] Firewalls can be configured
- [ ] Load balancers work
- [ ] Floating IPs assignable
- [ ] DNS zones and records managed

---

## Milestone 4: AI & Workflow Engine

**Duration:** Week 13-16
**Goal:** Users can create and execute AI-powered workflows
**Deliverable:** Complete visual workflow builder with AI orchestration

### Phase 4.1: Secrets & Environment Variables (Week 13)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement create secret | `POST /secrets` | secrets | SECRETS_AND_ENVIRONMENT.md |
| 2 | Implement list secrets | `GET /secrets` | secrets | SECRETS_AND_ENVIRONMENT.md |
| 3 | Implement update secret | `PATCH /secrets/{id}` | secrets | SECRETS_AND_ENVIRONMENT.md |
| 4 | Implement delete secret | `DELETE /secrets/{id}` | secrets | SECRETS_AND_ENVIRONMENT.md |
| 5 | Implement environment variables | `GET/POST/PATCH/DELETE /env-vars` | environment_variables | SECRETS_AND_ENVIRONMENT.md |
| 6 | Implement secret encryption (AES-256-GCM) | - | secrets | SECRETS_AND_ENVIRONMENT.md |
| 7 | Implement secret access logging | - | secret_access_logs | SECRETS_AND_ENVIRONMENT.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create secrets list page | `/settings/secrets` | SECRETS_AND_ENVIRONMENT.md |
| 2 | Create secret creation modal | CreateSecretModal | SECRETS_AND_ENVIRONMENT.md |
| 3 | Create environment variables page | `/settings/environment` | SECRETS_AND_ENVIRONMENT.md |
| 4 | Create secret access logs view | SecretAccessLogs | SECRETS_AND_ENVIRONMENT.md |

### Phase 4.2: Workflow CRUD (Week 13-14)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement create workflow | `POST /workflows` | workflows | NODE_WORKFLOW_ENGINE.md |
| 2 | Implement list workflows | `GET /workflows` | workflows | NODE_WORKFLOW_ENGINE.md |
| 3 | Implement get workflow | `GET /workflows/{id}` | workflows, nodes | NODE_WORKFLOW_ENGINE.md |
| 4 | Implement update workflow | `PATCH /workflows/{id}` | workflows | NODE_WORKFLOW_ENGINE.md |
| 5 | Implement delete workflow | `DELETE /workflows/{id}` | workflows | NODE_WORKFLOW_ENGINE.md |
| 6 | Implement duplicate workflow | `POST /workflows/{id}/duplicate` | workflows | NODE_WORKFLOW_ENGINE.md |
| 7 | Implement workflow versioning | `POST /workflows/{id}/versions` | workflow_versions | NODE_WORKFLOW_ENGINE.md |
| 8 | Implement workflow templates | `GET /workflow-templates` | workflow_templates | NODE_WORKFLOW_ENGINE.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create workflows list page | `/workflows` | NODE_WORKFLOW_ENGINE.md |
| 2 | Create workflow card/grid view | WorkflowCard | NODE_WORKFLOW_ENGINE.md |
| 3 | Create new workflow modal | NewWorkflowModal | NODE_WORKFLOW_ENGINE.md |
| 4 | Create workflow settings modal | WorkflowSettingsModal | NODE_WORKFLOW_ENGINE.md |
| 5 | Create workflow templates browser | TemplatesBrowser | NODE_WORKFLOW_ENGINE.md |

### Phase 4.3: Visual Workflow Builder (Week 14-15)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement get node types | `GET /node-types` | - | NODE_WORKFLOW_ENGINE.md |
| 2 | Implement get node schema | `GET /node-types/{type}/schema` | - | NODE_WORKFLOW_ENGINE.md |
| 3 | Implement add node to workflow | `POST /workflows/{id}/nodes` | nodes | NODE_WORKFLOW_ENGINE.md |
| 4 | Implement update node | `PATCH /nodes/{id}` | nodes | NODE_WORKFLOW_ENGINE.md |
| 5 | Implement delete node | `DELETE /nodes/{id}` | nodes | NODE_WORKFLOW_ENGINE.md |
| 6 | Implement add connection | `POST /workflows/{id}/connections` | node_connections | NODE_WORKFLOW_ENGINE.md |
| 7 | Implement delete connection | `DELETE /connections/{id}` | node_connections | NODE_WORKFLOW_ENGINE.md |
| 8 | Implement validate workflow | `POST /workflows/{id}/validate` | - | NODE_WORKFLOW_ENGINE.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create workflow builder page | `/workflows/{id}/edit` | NODE_WORKFLOW_ENGINE.md |
| 2 | Create canvas component (React Flow) | WorkflowCanvas | NODE_WORKFLOW_ENGINE.md |
| 3 | Create node palette | NodePalette | NODE_WORKFLOW_ENGINE.md |
| 4 | Create node components (20 types) | AIAgentNode, TriggerNode, etc. | NODE_WORKFLOW_ENGINE.md |
| 5 | Create node configuration panel | NodeConfigPanel | NODE_WORKFLOW_ENGINE.md |
| 6 | Create connection handles | ConnectionHandle | NODE_WORKFLOW_ENGINE.md |
| 7 | Create mini-map | WorkflowMiniMap | NODE_WORKFLOW_ENGINE.md |
| 8 | Create undo/redo functionality | useWorkflowHistory | NODE_WORKFLOW_ENGINE.md |

#### Node Types to Implement

| Category | Nodes | Priority |
|----------|-------|----------|
| **Orchestration** | AI Agent, Trigger, Planner | P0 |
| **AI & Intelligence** | LLM, RAG Context, Memory Store, Memory Search | P0 |
| **Integration** | HTTP API, Data Source, Email, Code | P0 |
| **Flow Control** | Conditional, Loop, Filter, Delay | P0 |
| **Operations** | Security, Maintenance, Monitoring | P1 |

### Phase 4.4: Workflow Execution Engine (Week 15-16)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement execute workflow | `POST /workflows/{id}/execute` | workflow_executions | WORKFLOW_EXECUTION.md |
| 2 | Implement get execution status | `GET /executions/{id}` | workflow_executions | WORKFLOW_EXECUTION.md |
| 3 | Implement list executions | `GET /workflows/{id}/executions` | workflow_executions | WORKFLOW_EXECUTION.md |
| 4 | Implement cancel execution | `POST /executions/{id}/cancel` | workflow_executions | WORKFLOW_EXECUTION.md |
| 5 | Implement retry execution | `POST /executions/{id}/retry` | workflow_executions | WORKFLOW_EXECUTION.md |
| 6 | Implement execution logs | `GET /executions/{id}/logs` | execution_logs | WORKFLOW_EXECUTION.md |
| 7 | Implement WebSocket updates | `WS /executions/{id}/stream` | - | WORKFLOW_EXECUTION.md |
| 8 | Implement AI Agent orchestrator | - | - | NODE_WORKFLOW_ENGINE.md |
| 9 | Implement node executors (per type) | - | node_executions | NODE_WORKFLOW_ENGINE.md |
| 10 | Implement execution queue (BullMQ) | - | - | BACKGROUND_JOBS.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create execution button/trigger | ExecuteButton | WORKFLOW_EXECUTION.md |
| 2 | Create execution history page | `/workflows/{id}/executions` | WORKFLOW_EXECUTION.md |
| 3 | Create execution detail page | `/executions/{id}` | WORKFLOW_EXECUTION.md |
| 4 | Create real-time execution viewer | ExecutionViewer | WORKFLOW_EXECUTION.md |
| 5 | Create node execution status | NodeExecutionStatus | WORKFLOW_EXECUTION.md |
| 6 | Create execution logs panel | ExecutionLogs | WORKFLOW_EXECUTION.md |
| 7 | Implement WebSocket connection | useExecutionStream | WORKFLOW_EXECUTION.md |

#### User Journey: Workflow Creation & Execution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  USER JOURNEY: WORKFLOW CREATION & EXECUTION                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  WORKFLOW CREATION                                                           │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │Workflows│───▶│  New    │───▶│  Add    │───▶│Configure│───▶│  Save   │  │
│  │  List   │    │Workflow │    │ Nodes   │    │ Nodes   │    │Workflow │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                      │                                                       │
│                      ▼                                                       │
│                 ┌─────────┐    ┌─────────┐    ┌─────────┐                   │
│                 │  Use    │───▶│Customize│───▶│  Save   │                   │
│                 │Template │    │ Nodes   │    │Workflow │                   │
│                 └─────────┘    └─────────┘    └─────────┘                   │
│                                                                              │
│  WORKFLOW EXECUTION                                                          │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │Workflow │───▶│ Execute │───▶│  Watch  │───▶│  View   │───▶│ Review  │  │
│  │ Detail  │    │ Button  │    │Realtime │    │ Output  │    │  Logs   │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                                              │
│  AI-ASSISTED CREATION                                                        │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐                  │
│  │  New    │───▶│Describe │───▶│   AI    │───▶│ Refine  │                  │
│  │Workflow │    │  Goal   │    │Generates│    │ & Save  │                  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Milestone 4 Checklist

- [ ] Secrets stored with AES-256-GCM encryption
- [ ] Environment variables manageable
- [ ] Workflows can be created/edited/deleted
- [ ] Workflow versioning works
- [ ] Templates available
- [ ] Visual canvas renders nodes
- [ ] All 20 node types implemented
- [ ] Nodes can be configured
- [ ] Connections work between nodes
- [ ] Workflow validation works
- [ ] Workflows can be executed
- [ ] Real-time execution updates (WebSocket)
- [ ] Execution logs captured
- [ ] AI Agent orchestration works
- [ ] Retry policies work

---

## Milestone 5: Production & Scale

**Duration:** Week 17-20
**Goal:** Production-ready platform with compliance and monitoring
**Deliverable:** Enterprise-grade, compliant, monitored application

### Phase 5.1: Webhooks (Week 17)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement create webhook | `POST /webhooks` | webhooks | api_contract.yaml |
| 2 | Implement list webhooks | `GET /webhooks` | webhooks | api_contract.yaml |
| 3 | Implement update webhook | `PATCH /webhooks/{id}` | webhooks | api_contract.yaml |
| 4 | Implement delete webhook | `DELETE /webhooks/{id}` | webhooks | api_contract.yaml |
| 5 | Implement webhook delivery | - | webhook_deliveries | BACKGROUND_JOBS.md |
| 6 | Implement webhook signing | - | - | api_contract.yaml |
| 7 | Implement delivery retries | - | webhook_deliveries | BACKGROUND_JOBS.md |
| 8 | Implement test webhook | `POST /webhooks/{id}/test` | - | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create webhooks list page | `/settings/webhooks` | FRONTEND_ARCHITECTURE.md |
| 2 | Create webhook creation form | CreateWebhookForm | FRONTEND_ARCHITECTURE.md |
| 3 | Create event selector | WebhookEventSelector | FRONTEND_ARCHITECTURE.md |
| 4 | Create delivery history | WebhookDeliveryHistory | FRONTEND_ARCHITECTURE.md |
| 5 | Create test webhook button | TestWebhookButton | FRONTEND_ARCHITECTURE.md |

### Phase 5.2: Audit & Activity Logging (Week 17-18)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement audit log creation | - | audit_logs | RLS_AUDIT_LOGGING.md |
| 2 | Implement query audit logs | `GET /audit-logs` | audit_logs | RLS_AUDIT_LOGGING.md |
| 3 | Implement user activity logs | `GET /users/{id}/activity` | user_activity | RLS_AUDIT_LOGGING.md |
| 4 | Implement security event logging | - | security_events | RLS_AUDIT_LOGGING.md |
| 5 | Implement RLS violation detection | - | rls_violations | RLS_AUDIT_LOGGING.md |
| 6 | Implement admin action logging | - | admin_actions | RLS_AUDIT_LOGGING.md |
| 7 | Implement log retention policies | - | - | RLS_AUDIT_LOGGING.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create audit logs page | `/settings/audit-logs` | RLS_AUDIT_LOGGING.md |
| 2 | Create audit log filters | AuditLogFilters | RLS_AUDIT_LOGGING.md |
| 3 | Create activity timeline | ActivityTimeline | RLS_AUDIT_LOGGING.md |
| 4 | Create security events view | SecurityEvents | RLS_AUDIT_LOGGING.md |

### Phase 5.3: Compliance (GDPR/CCPA) (Week 18-19)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement data export request | `POST /compliance/export-requests` | export_requests | DATA_PROTECTION.md |
| 2 | Implement data export generation | - | export_requests | DATA_PROTECTION.md |
| 3 | Implement deletion request | `POST /compliance/deletion-requests` | deletion_requests | DATA_PROTECTION.md |
| 4 | Implement deletion workflow | - | deletion_requests | BACKGROUND_JOBS.md |
| 5 | Implement consent management | `GET/POST /compliance/consents` | consent_records | DATA_PROTECTION.md |
| 6 | Implement privacy policy versioning | `GET /compliance/privacy-policy` | privacy_policies | DATA_PROTECTION.md |
| 7 | Implement DPA management | `GET /compliance/dpa` | dpas | DATA_PROTECTION.md |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create data export page | `/settings/privacy/export` | DATA_PROTECTION.md |
| 2 | Create deletion request page | `/settings/privacy/deletion` | DATA_PROTECTION.md |
| 3 | Create cookie consent banner | CookieConsentBanner | DATA_PROTECTION.md |
| 4 | Create consent preferences | `/settings/privacy/consent` | DATA_PROTECTION.md |
| 5 | Create privacy dashboard | `/settings/privacy` | DATA_PROTECTION.md |

### Phase 5.4: Admin Panel (Week 19-20)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement global admin auth | `POST /admin/auth/login` | admin_users | api_contract.yaml |
| 2 | Implement list all tenants | `GET /admin/tenants` | tenants | api_contract.yaml |
| 3 | Implement tenant details | `GET /admin/tenants/{id}` | tenants | api_contract.yaml |
| 4 | Implement suspend tenant | `POST /admin/tenants/{id}/suspend` | tenants | api_contract.yaml |
| 5 | Implement platform stats | `GET /admin/stats` | - | api_contract.yaml |
| 6 | Implement feature flags | `GET/PATCH /admin/feature-flags` | feature_flags | api_contract.yaml |
| 7 | Implement global audit logs | `GET /admin/audit-logs` | audit_logs | api_contract.yaml |
| 8 | Implement system health | `GET /admin/health` | - | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create admin login page | `/admin/login` | FRONTEND_ARCHITECTURE.md |
| 2 | Create admin dashboard | `/admin` | FRONTEND_ARCHITECTURE.md |
| 3 | Create tenants list | `/admin/tenants` | FRONTEND_ARCHITECTURE.md |
| 4 | Create tenant detail page | `/admin/tenants/{id}` | FRONTEND_ARCHITECTURE.md |
| 5 | Create platform stats dashboard | `/admin/stats` | FRONTEND_ARCHITECTURE.md |
| 6 | Create feature flags page | `/admin/feature-flags` | FRONTEND_ARCHITECTURE.md |
| 7 | Create system health page | `/admin/health` | FRONTEND_ARCHITECTURE.md |

### Phase 5.5: Background Jobs & Monitoring (Week 20)

#### Backend Tasks

| # | Task | API Endpoints | Database Tables | Reference Doc |
|---|------|---------------|-----------------|---------------|
| 1 | Implement job queue dashboard | `GET /admin/jobs` | - | BACKGROUND_JOBS.md |
| 2 | Implement email queue | - | - | BACKGROUND_JOBS.md |
| 3 | Implement cleanup jobs | - | - | BACKGROUND_JOBS.md |
| 4 | Implement tenant deletion job | - | - | BACKGROUND_JOBS.md |
| 5 | Implement user deletion job | - | - | BACKGROUND_JOBS.md |
| 6 | Implement metrics endpoint | `GET /metrics` | - | api_contract.yaml |
| 7 | Implement health check | `GET /health` | - | api_contract.yaml |

#### Frontend Tasks

| # | Task | Pages/Components | Reference Doc |
|---|------|------------------|---------------|
| 1 | Create job queue dashboard | `/admin/jobs` | BACKGROUND_JOBS.md |
| 2 | Create monitoring dashboard | `/admin/monitoring` | FRONTEND_ARCHITECTURE.md |
| 3 | Create alert configuration | `/admin/alerts` | FRONTEND_ARCHITECTURE.md |

### Milestone 5 Checklist

- [ ] Webhooks configurable
- [ ] Webhook delivery with retries
- [ ] Webhook signing implemented
- [ ] Audit logs queryable
- [ ] Activity timeline works
- [ ] Security events logged
- [ ] GDPR data export works
- [ ] GDPR deletion works
- [ ] Cookie consent banner
- [ ] Admin authentication
- [ ] Tenant management (admin)
- [ ] Platform stats dashboard
- [ ] Feature flags manageable
- [ ] Background job queues running
- [ ] Health checks passing
- [ ] Metrics endpoint exposed

---

## API Development Sequence

Complete API endpoint development order respecting dependencies:

### Priority 0: Core Foundation
```
1. POST   /auth/signup
2. POST   /auth/verify-email
3. POST   /auth/login
4. POST   /auth/refresh
5. POST   /auth/logout
6. GET    /users/me
7. PATCH  /users/me
```

### Priority 1: Extended Auth
```
8.  POST   /auth/forgot-password
9.  POST   /auth/reset-password
10. POST   /auth/mfa/totp/setup
11. POST   /auth/mfa/totp/verify
12. GET    /auth/oauth/google
13. GET    /auth/oauth/github
```

### Priority 2: Multi-Tenancy
```
14. POST   /tenants
15. GET    /tenants/{id}
16. PATCH  /tenants/{id}
17. GET    /tenants/{id}/users
18. POST   /tenants/{id}/invitations
```

### Priority 3: RBAC
```
19. GET    /roles
20. POST   /roles
21. GET    /permissions
22. POST   /roles/{id}/permissions
23. PATCH  /tenants/{id}/users/{userId}/role
```

### Priority 4: Billing
```
24. POST   /billing/subscriptions
25. GET    /billing/subscriptions/current
26. GET    /billing/invoices
27. POST   /billing/payment-methods
```

### Priority 5: Infrastructure
```
28. POST   /cloud-providers
29. POST   /servers
30. GET    /servers
31. POST   /servers/{id}/actions/{action}
32. POST   /volumes
33. POST   /networks
34. POST   /firewalls
```

### Priority 6: Workflows
```
35. POST   /workflows
36. GET    /workflows
37. POST   /workflows/{id}/nodes
38. POST   /workflows/{id}/execute
39. GET    /executions/{id}
```

### Priority 7: Production
```
40. POST   /webhooks
41. GET    /audit-logs
42. POST   /compliance/export-requests
43. GET    /admin/tenants
44. GET    /admin/stats
```

---

## Frontend Development Sequence

### Phase 1: Auth Pages
```
/login
/signup
/verify-email
/forgot-password
/reset-password
/auth/mfa-challenge
/auth/oauth/callback
```

### Phase 2: Dashboard Shell
```
/dashboard (layout + navigation)
/settings/profile
/settings/security
/settings/preferences
```

### Phase 3: Tenant & Team
```
/onboarding/create-organization
/settings/organization
/settings/team
/settings/roles
/invitations/accept
```

### Phase 4: Billing
```
/settings/billing
/settings/billing/plans
/settings/billing/payment
/settings/billing/invoices
```

### Phase 5: Infrastructure
```
/infrastructure/servers
/infrastructure/servers/{id}
/infrastructure/volumes
/infrastructure/networks
/infrastructure/firewalls
/infrastructure/dns
```

### Phase 6: Workflows
```
/workflows
/workflows/{id}/edit (canvas)
/workflows/{id}/executions
/executions/{id}
/settings/secrets
```

### Phase 7: Admin & Compliance
```
/settings/webhooks
/settings/audit-logs
/settings/privacy
/admin/login
/admin (dashboard)
/admin/tenants
```

---

## Testing Strategy

### Unit Tests
- All service layer functions
- All utility functions
- Permission check logic
- Validation schemas

### Integration Tests
- API endpoint tests
- Database operations
- External service mocks (Stripe, Hetzner)

### E2E Tests
- Critical user journeys:
  - Signup → Login → Create Org → Invite User
  - Create Workflow → Execute → View Results
  - Subscribe → Upgrade Plan → View Invoice

### Security Tests
- Authentication bypass attempts
- RBAC permission enforcement
- Tenant isolation (RLS)
- SQL injection
- XSS prevention

---

## Definition of Done

### For Each Feature

- [ ] Backend API implemented
- [ ] Frontend UI implemented
- [ ] Unit tests passing (>80% coverage)
- [ ] Integration tests passing
- [ ] Security review completed
- [ ] Documentation updated
- [ ] Code reviewed and approved
- [ ] Deployed to staging
- [ ] QA approved
- [ ] Performance acceptable

### For Each Milestone

- [ ] All features complete
- [ ] E2E tests passing
- [ ] Security audit passed
- [ ] Performance benchmarks met
- [ ] Documentation complete
- [ ] Stakeholder demo approved
- [ ] Production deployment ready

---

## Changelog

### v1.0.0 (January 28, 2026)
- Initial application development plan
- 5 milestones covering complete platform
- Detailed user journeys
- API development sequence
- Frontend development sequence
- Testing strategy
- Definition of done criteria
