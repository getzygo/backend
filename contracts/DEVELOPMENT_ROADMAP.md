# Backend Development Roadmap

**Version:** 1.0.0
**Last Updated:** January 28, 2026
**Status:** Active Development Guide

---

## Overview

This document organizes the Zygo backend documentation into a logical development sequence. Follow the phases in order to build the backend systematically, ensuring dependencies are met before moving to the next phase.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ZYGO BACKEND DEVELOPMENT PATH                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 1          PHASE 2           PHASE 3          PHASE 4               │
│  Infrastructure   Database &        Core API         Advanced              │
│  Setup            Foundation        Development      Features              │
│                                                                              │
│  ┌─────────┐     ┌─────────┐       ┌─────────┐      ┌─────────┐           │
│  │   VPS   │────▶│Database │──────▶│  Auth   │─────▶│Workflows│           │
│  │   DNS   │     │ Schema  │       │  RBAC   │      │   AI    │           │
│  │  Infra  │     │   RLS   │       │  APIs   │      │  Jobs   │           │
│  └─────────┘     └─────────┘       └─────────┘      └─────────┘           │
│       │               │                 │                │                 │
│       ▼               ▼                 ▼                ▼                 │
│  ┌─────────┐     ┌─────────┐       ┌─────────┐      ┌─────────┐           │
│  │  Week   │     │  Week   │       │  Weeks  │      │  Weeks  │           │
│  │   1-2   │     │   2-3   │       │   3-6   │      │   6-10  │           │
│  └─────────┘     └─────────┘       └─────────┘      └─────────┘           │
│                                                                              │
│                              PHASE 5                                        │
│                         Production Ready                                    │
│                                                                              │
│                         ┌─────────────┐                                    │
│                         │  Security   │                                    │
│                         │  CI/CD      │                                    │
│                         │  Compliance │                                    │
│                         └─────────────┘                                    │
│                              │                                              │
│                              ▼                                              │
│                         ┌─────────┐                                        │
│                         │  Weeks  │                                        │
│                         │  10-12  │                                        │
│                         └─────────┘                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Infrastructure Setup

**Duration:** Week 1-2
**Prerequisites:** None
**Goal:** Production-ready server and network infrastructure

### 1.1 VPS Server Setup

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Initial Server Setup | Create deploy user, update system, configure timezone |
| 2 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Install Dependencies | Node.js 20, Docker, Nginx, Certbot |
| 3 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | PostgreSQL Setup | Install PostgreSQL 15, configure connections |
| 4 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Supabase Self-Hosted | Clone repo, configure .env, start Docker |
| 5 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Redis Setup | Install and configure Redis |
| 6 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Firewall Configuration | Configure UFW, restrict access |

### 1.2 DNS & SSL Configuration

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [DNS_CONFIGURATION.md](./DNS_CONFIGURATION.md) | Domain Architecture | Understand getzygo.com, zygo.tech, zygo.cloud structure |
| 2 | [DNS_CONFIGURATION.md](./DNS_CONFIGURATION.md) | Cloudflare Setup | Add domains, configure nameservers |
| 3 | [DNS_CONFIGURATION.md](./DNS_CONFIGURATION.md) | DNS Records | Create A, CNAME, MX, TXT records |
| 4 | [DNS_CONFIGURATION.md](./DNS_CONFIGURATION.md) | SSL/TLS Configuration | Configure Full (strict) SSL mode |
| 5 | [DNS_CONFIGURATION.md](./DNS_CONFIGURATION.md) | Email DNS Records | SPF, DKIM, DMARC for email delivery |
| 6 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | SSL Certificates | Obtain Let's Encrypt certificates via Certbot |

### 1.3 Nginx & Process Management

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Nginx Configuration | Create API and Supabase reverse proxy configs |
| 2 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Process Management | Install PM2, create ecosystem.config.js |
| 3 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Monitoring Setup | Node Exporter, health check scripts |
| 4 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Backup Strategy | Database and Redis backup scripts |

### Phase 1 Checklist

- [ ] VPS provisioned (Ubuntu 22.04 LTS)
- [ ] SSH access configured with deploy user
- [ ] Docker installed and running
- [ ] PostgreSQL 15 installed and configured
- [ ] Supabase self-hosted running
- [ ] Redis installed and configured
- [ ] Nginx configured as reverse proxy
- [ ] SSL certificates obtained
- [ ] DNS records configured in Cloudflare
- [ ] Firewall rules applied
- [ ] PM2 installed
- [ ] Backup scripts created

---

## Phase 2: Database & Foundation

**Duration:** Week 2-3
**Prerequisites:** Phase 1 complete
**Goal:** Database schema deployed with RLS and migrations

### 2.1 Environment Configuration

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [ENVIRONMENT.md](./ENVIRONMENT.md) | Full document | Understand all environment variables |
| 2 | [.env.example](./.env.example) | Full file | Copy and configure .env.production |
| 3 | [SECRETS_AND_ENVIRONMENT.md](./SECRETS_AND_ENVIRONMENT.md) | Overview | Understand tenant-isolated secrets architecture |

### 2.2 Database Schema

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [db_contract.md](./db_contract.md) | Overview | Understand 65 tables across 10 categories |
| 2 | [db_contract.md](./db_contract.md) | Core Tenancy | tenants, tenant_domains, tenant_settings, tenant_features |
| 3 | [db_contract.md](./db_contract.md) | RBAC Tables | roles, permissions, role_permissions, user_roles |
| 4 | [db_contract.md](./db_contract.md) | Users/Auth | users, sessions, mfa_tokens, password_reset_tokens |
| 5 | [db_contract.md](./db_contract.md) | All Categories | Review remaining table categories |

### 2.3 Database Migrations

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [supabase_migration_plan.md](./supabase_migration_plan.md) | Migration Order | Understand 12-phase migration sequence |
| 2 | [supabase_migration_plan.md](./supabase_migration_plan.md) | Phase 1-3 | Run core schema migrations |
| 3 | [supabase_migration_plan.md](./supabase_migration_plan.md) | Phase 4-6 | Run auth and RBAC migrations |
| 4 | [supabase_migration_plan.md](./supabase_migration_plan.md) | Phase 7-12 | Run feature table migrations |
| 5 | [supabase_migration_plan.md](./supabase_migration_plan.md) | RLS Policies | Apply Row-Level Security policies |

### 2.4 RBAC Foundation

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [rbac_contract.md](./rbac_contract.md) | Overview | Understand granular RBAC system |
| 2 | [rbac_contract.md](./rbac_contract.md) | Permissions | Review 114 permissions across 18 categories |
| 3 | [rbac_contract.md](./rbac_contract.md) | Default Roles | Understand 6 default roles (Owner → Viewer) |
| 4 | [rbac_contract.md](./rbac_contract.md) | Role Hierarchy | Implement hierarchy level enforcement |
| 5 | [rbac_contract.md](./rbac_contract.md) | Permission Matrix | Reference for role-permission mappings |

### Phase 2 Checklist

- [ ] Environment variables configured
- [ ] Database migrations run successfully
- [ ] All 65 tables created
- [ ] RLS policies applied to all tenant-scoped tables
- [ ] Default roles seeded
- [ ] Permissions seeded
- [ ] Role-permission mappings created
- [ ] Database connection tested from application

---

## Phase 3: Core API Development

**Duration:** Week 3-6
**Prerequisites:** Phase 2 complete
**Goal:** Authentication, middleware, and core endpoints

### 3.1 Backend Architecture

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) | Project Structure | Set up Hono + Drizzle project structure |
| 2 | [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) | Middleware | Implement tenant context, auth, rate limiting middleware |
| 3 | [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) | Service Layer | Create service layer patterns |
| 4 | [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) | Error Handling | Implement standardized error responses |
| 5 | [API_ERROR_SPECIFICATION.md](./API_ERROR_SPECIFICATION.md) | Full document | Implement error codes and response schema |

### 3.2 Authentication System

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [AUTHENTICATION.md](./AUTHENTICATION.md) | Overview | Understand complete auth strategy |
| 2 | [AUTHENTICATION.md](./AUTHENTICATION.md) | Email/Password | Implement signup, login, password reset |
| 3 | [AUTHENTICATION.md](./AUTHENTICATION.md) | JWT Tokens | Implement access/refresh token flow |
| 4 | [AUTHENTICATION.md](./AUTHENTICATION.md) | MFA | Implement TOTP and SMS-based MFA |
| 5 | [AUTHENTICATION.md](./AUTHENTICATION.md) | Social OAuth | Implement Google, GitHub, Microsoft OAuth |
| 6 | [AUTHENTICATION.md](./AUTHENTICATION.md) | Suspicious Login | Implement risk scoring and detection |
| 7 | [OAUTH_STRATEGY.md](./OAUTH_STRATEGY.md) | Enterprise SSO | Implement SAML 2.0 and OIDC |
| 8 | [OAUTH_STRATEGY.md](./OAUTH_STRATEGY.md) | External Integrations | Google Drive, OneDrive, Dropbox OAuth |

### 3.3 Multi-Tenancy

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [TENANCY.md](./TENANCY.md) | Overview | Understand multi-tenant architecture |
| 2 | [TENANCY.md](./TENANCY.md) | Mode Resolution | Implement subdomain-based tenant detection |
| 3 | [TENANCY.md](./TENANCY.md) | Tenant Context | Implement tenant middleware |
| 4 | [TENANCY.md](./TENANCY.md) | Storage Isolation | Implement tenant-scoped file storage |
| 5 | [RLS_AUDIT_LOGGING.md](./RLS_AUDIT_LOGGING.md) | Full document | Implement RLS violation detection and logging |

### 3.4 Rate Limiting & Security

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [RATE_LIMITING.md](./RATE_LIMITING.md) | Strategy | Understand rate limit tiers |
| 2 | [RATE_LIMITING.md](./RATE_LIMITING.md) | Auth Protection | Implement login/signup rate limits |
| 3 | [RATE_LIMITING.md](./RATE_LIMITING.md) | Plan-Based Limits | Implement per-tenant rate limits by plan |
| 4 | [RATE_LIMITING.md](./RATE_LIMITING.md) | Implementation | Redis-based rate limiting |

### 3.5 Core API Endpoints

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [api_contract.yaml](./api_contract.yaml) | Auth endpoints | Implement /auth/* endpoints |
| 2 | [api_contract.yaml](./api_contract.yaml) | User endpoints | Implement /users/* endpoints |
| 3 | [api_contract.yaml](./api_contract.yaml) | Role endpoints | Implement /roles/* endpoints |
| 4 | [api_contract.yaml](./api_contract.yaml) | Tenant endpoints | Implement /tenants/* endpoints |
| 5 | [SECRETS_AND_ENVIRONMENT.md](./SECRETS_AND_ENVIRONMENT.md) | APIs | Implement secrets & env variables endpoints |

### 3.6 Edge Functions

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md) | Overview | Understand Supabase Edge Functions architecture |
| 2 | [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md) | Auth Hooks | Implement auth event hooks |
| 3 | [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md) | Webhooks | Implement webhook delivery functions |
| 4 | [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md) | Realtime Auth | Implement realtime authorization |

### Phase 3 Checklist

- [ ] Hono application structure created
- [ ] Drizzle ORM configured
- [ ] Tenant context middleware working
- [ ] JWT authentication implemented
- [ ] MFA (TOTP + SMS) implemented
- [ ] Social OAuth working (Google, GitHub)
- [ ] RBAC permission checks implemented
- [ ] Rate limiting active
- [ ] User CRUD endpoints working
- [ ] Role management endpoints working
- [ ] Secrets management endpoints working
- [ ] Edge functions deployed

---

## Phase 4: Advanced Features

**Duration:** Week 6-10
**Prerequisites:** Phase 3 complete
**Goal:** Workflow engine, AI integration, and background jobs

### 4.1 Workflow Engine

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [NODE_WORKFLOW_ENGINE.md](./NODE_WORKFLOW_ENGINE.md) | Overview | Understand workflow architecture |
| 2 | [NODE_WORKFLOW_ENGINE.md](./NODE_WORKFLOW_ENGINE.md) | Node Types | Implement 20+ node types |
| 3 | [NODE_WORKFLOW_ENGINE.md](./NODE_WORKFLOW_ENGINE.md) | AI Agent | Implement AI orchestration agent |
| 4 | [NODE_WORKFLOW_ENGINE.md](./NODE_WORKFLOW_ENGINE.md) | Execution Engine | Implement workflow executor |
| 5 | [WORKFLOW_EXECUTION.md](./WORKFLOW_EXECUTION.md) | API | Implement workflow execution endpoints |
| 6 | [WORKFLOW_EXECUTION.md](./WORKFLOW_EXECUTION.md) | WebSocket | Implement real-time execution updates |
| 7 | [WORKFLOW_EXECUTION.md](./WORKFLOW_EXECUTION.md) | Retry Policies | Implement failure handling and retries |

### 4.2 Background Jobs

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | Overview | Understand BullMQ job architecture |
| 2 | [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | Queue Configuration | Set up job queues |
| 3 | [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | Data Lifecycle | Implement tenant/user deletion workflows |
| 4 | [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | Scheduled Jobs | Implement recurring jobs |
| 5 | [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | Error Handling | Implement job retry and dead letter queues |

### 4.3 Infrastructure APIs

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [api_contract.yaml](./api_contract.yaml) | Servers | Implement server management endpoints |
| 2 | [api_contract.yaml](./api_contract.yaml) | Volumes | Implement storage volume endpoints |
| 3 | [api_contract.yaml](./api_contract.yaml) | Networks | Implement network management |
| 4 | [api_contract.yaml](./api_contract.yaml) | DNS | Implement DNS management endpoints |
| 5 | [api_contract.yaml](./api_contract.yaml) | Firewalls | Implement firewall rule endpoints |
| 6 | [api_contract.yaml](./api_contract.yaml) | Load Balancers | Implement load balancer endpoints |

### 4.4 Billing & Subscriptions

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [api_contract.yaml](./api_contract.yaml) | Billing | Implement subscription endpoints |
| 2 | [api_contract.yaml](./api_contract.yaml) | Payments | Implement Stripe integration |
| 3 | [api_contract.yaml](./api_contract.yaml) | Licenses | Implement license management |
| 4 | [api_contract.yaml](./api_contract.yaml) | Usage Tracking | Implement usage metering |

### 4.5 Webhooks

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [api_contract.yaml](./api_contract.yaml) | Webhooks | Implement webhook CRUD endpoints |
| 2 | [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | Delivery | Implement webhook delivery with retries |
| 3 | [api_contract.yaml](./api_contract.yaml) | Logs | Implement webhook delivery logs |

### Phase 4 Checklist

- [ ] Workflow CRUD endpoints working
- [ ] All 20+ node types implemented
- [ ] AI Agent orchestration working
- [ ] Workflow execution engine working
- [ ] WebSocket updates working
- [ ] BullMQ queues configured
- [ ] Background job workers running
- [ ] Tenant deletion workflow working
- [ ] Server management APIs working
- [ ] Stripe billing integrated
- [ ] Webhook delivery working

---

## Phase 5: Production Readiness

**Duration:** Week 10-12
**Prerequisites:** Phase 4 complete
**Goal:** Security hardening, compliance, and CI/CD

### 5.1 Data Protection & Compliance

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [DATA_PROTECTION.md](./DATA_PROTECTION.md) | GDPR | Implement GDPR compliance features |
| 2 | [DATA_PROTECTION.md](./DATA_PROTECTION.md) | CCPA/CPRA | Implement California privacy compliance |
| 3 | [DATA_PROTECTION.md](./DATA_PROTECTION.md) | Data Export | Implement user data export |
| 4 | [DATA_PROTECTION.md](./DATA_PROTECTION.md) | Data Deletion | Implement right to deletion |
| 5 | [api_contract.yaml](./api_contract.yaml) | Compliance | Implement compliance endpoints |

### 5.2 Audit & Monitoring

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [RLS_AUDIT_LOGGING.md](./RLS_AUDIT_LOGGING.md) | Audit Trails | Implement comprehensive audit logging |
| 2 | [RLS_AUDIT_LOGGING.md](./RLS_AUDIT_LOGGING.md) | Admin Override | Implement admin action logging |
| 3 | [api_contract.yaml](./api_contract.yaml) | Audit endpoints | Implement audit log query endpoints |
| 4 | [DNS_CONFIGURATION.md](./DNS_CONFIGURATION.md) | Monitoring | Set up external monitoring (Better Stack) |

### 5.3 Security Hardening

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [AUTHENTICATION.md](./AUTHENTICATION.md) | Security | Review and test auth security |
| 2 | [DNS_CONFIGURATION.md](./DNS_CONFIGURATION.md) | Security | Configure Cloudflare WAF rules |
| 3 | [DNS_CONFIGURATION.md](./DNS_CONFIGURATION.md) | DDoS Protection | Enable DDoS protection |
| 4 | [SECRETS_AND_ENVIRONMENT.md](./SECRETS_AND_ENVIRONMENT.md) | Encryption | Verify AES-256-GCM encryption |
| 5 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Security | Review server hardening |

### 5.4 CI/CD Pipeline

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [CI_CD_PIPELINE.md](./CI_CD_PIPELINE.md) | GitHub Actions | Set up CI/CD workflows |
| 2 | [CI_CD_PIPELINE.md](./CI_CD_PIPELINE.md) | Testing | Configure automated testing |
| 3 | [CI_CD_PIPELINE.md](./CI_CD_PIPELINE.md) | Deployment | Set up SSH deployment |
| 4 | [CI_CD_PIPELINE.md](./CI_CD_PIPELINE.md) | Rollback | Configure rollback procedures |
| 5 | [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Deploy Script | Test deployment scripts |

### 5.5 Admin Panel

| Step | Document | Section | Description |
|------|----------|---------|-------------|
| 1 | [api_contract.yaml](./api_contract.yaml) | Admin Auth | Implement global admin authentication |
| 2 | [api_contract.yaml](./api_contract.yaml) | Tenant Management | Implement cross-tenant operations |
| 3 | [api_contract.yaml](./api_contract.yaml) | System Stats | Implement platform metrics endpoints |
| 4 | [api_contract.yaml](./api_contract.yaml) | Feature Flags | Implement feature toggle management |

### Phase 5 Checklist

- [ ] GDPR data export working
- [ ] GDPR deletion requests working
- [ ] Audit logging comprehensive
- [ ] Cloudflare WAF configured
- [ ] Security headers configured
- [ ] CI/CD pipeline working
- [ ] Automated tests passing
- [ ] Deployment scripts tested
- [ ] Rollback procedure tested
- [ ] Admin endpoints secured
- [ ] Monitoring alerts configured
- [ ] Documentation complete

---

## Document Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DOCUMENT DEPENDENCY GRAPH                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                        ┌──────────────────────┐                             │
│                        │   VPS_DEPLOYMENT.md  │                             │
│                        │  DNS_CONFIGURATION   │                             │
│                        └──────────┬───────────┘                             │
│                                   │                                          │
│              ┌────────────────────┼────────────────────┐                    │
│              │                    │                    │                    │
│              ▼                    ▼                    ▼                    │
│  ┌───────────────────┐  ┌────────────────┐  ┌─────────────────┐            │
│  │   ENVIRONMENT.md  │  │ .env.example   │  │  TENANCY.md     │            │
│  └─────────┬─────────┘  └───────┬────────┘  └────────┬────────┘            │
│            │                    │                    │                      │
│            └────────────────────┼────────────────────┘                      │
│                                 │                                            │
│                                 ▼                                            │
│                    ┌────────────────────────┐                               │
│                    │    db_contract.md      │◀───────────────┐              │
│                    │supabase_migration_plan │                │              │
│                    └───────────┬────────────┘                │              │
│                                │                             │              │
│              ┌─────────────────┼─────────────────┐           │              │
│              │                 │                 │           │              │
│              ▼                 ▼                 ▼           │              │
│  ┌───────────────────┐ ┌──────────────┐ ┌──────────────┐    │              │
│  │  rbac_contract.md │ │AUTHENTICATION│ │BACKEND_ARCH  │    │              │
│  └─────────┬─────────┘ └──────┬───────┘ └──────┬───────┘    │              │
│            │                  │                │             │              │
│            │    ┌─────────────┼────────────────┘             │              │
│            │    │             │                              │              │
│            ▼    ▼             ▼                              │              │
│  ┌──────────────────────────────────────┐                   │              │
│  │         api_contract.yaml            │                   │              │
│  │     API_ERROR_SPECIFICATION          │                   │              │
│  └──────────────────┬───────────────────┘                   │              │
│                     │                                        │              │
│      ┌──────────────┼──────────────┬────────────────────────┘              │
│      │              │              │                                        │
│      ▼              ▼              ▼                                        │
│ ┌──────────┐ ┌────────────┐ ┌───────────────┐                              │
│ │WORKFLOW  │ │BACKGROUND  │ │ EDGE_FUNCTIONS│                              │
│ │ENGINE    │ │JOBS        │ │               │                              │
│ │EXECUTION │ │            │ └───────────────┘                              │
│ └────┬─────┘ └─────┬──────┘                                                │
│      │             │                                                        │
│      └──────┬──────┘                                                        │
│             │                                                               │
│             ▼                                                               │
│  ┌─────────────────────────────────────┐                                   │
│  │  DATA_PROTECTION.md                 │                                   │
│  │  RLS_AUDIT_LOGGING.md               │                                   │
│  │  RATE_LIMITING.md                   │                                   │
│  │  OAUTH_STRATEGY.md                  │                                   │
│  │  SECRETS_AND_ENVIRONMENT.md         │                                   │
│  └──────────────────┬──────────────────┘                                   │
│                     │                                                       │
│                     ▼                                                       │
│          ┌──────────────────────┐                                          │
│          │   CI_CD_PIPELINE.md  │                                          │
│          └──────────────────────┘                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Document Reference by Development Task

### When Setting Up Server

| Task | Primary Document | Supporting Documents |
|------|------------------|---------------------|
| Provision VPS | VPS_DEPLOYMENT.md | - |
| Configure DNS | DNS_CONFIGURATION.md | - |
| Install PostgreSQL | VPS_DEPLOYMENT.md | - |
| Install Supabase | VPS_DEPLOYMENT.md | ENVIRONMENT.md |
| Configure SSL | VPS_DEPLOYMENT.md, DNS_CONFIGURATION.md | - |
| Configure Nginx | VPS_DEPLOYMENT.md | - |

### When Setting Up Database

| Task | Primary Document | Supporting Documents |
|------|------------------|---------------------|
| Understand schema | db_contract.md | - |
| Run migrations | supabase_migration_plan.md | db_contract.md |
| Configure RLS | supabase_migration_plan.md | db_contract.md, TENANCY.md |
| Seed permissions | rbac_contract.md | supabase_migration_plan.md |
| Seed roles | rbac_contract.md | supabase_migration_plan.md |

### When Implementing Authentication

| Task | Primary Document | Supporting Documents |
|------|------------------|---------------------|
| Email/password auth | AUTHENTICATION.md | api_contract.yaml |
| JWT tokens | AUTHENTICATION.md | BACKEND_ARCHITECTURE.md |
| MFA implementation | AUTHENTICATION.md | api_contract.yaml |
| Social OAuth | AUTHENTICATION.md, OAUTH_STRATEGY.md | api_contract.yaml |
| Enterprise SSO | OAUTH_STRATEGY.md | AUTHENTICATION.md |
| Rate limiting | RATE_LIMITING.md | AUTHENTICATION.md |

### When Implementing RBAC

| Task | Primary Document | Supporting Documents |
|------|------------------|---------------------|
| Permission checks | rbac_contract.md | BACKEND_ARCHITECTURE.md |
| Role management | rbac_contract.md | api_contract.yaml |
| Hierarchy enforcement | rbac_contract.md | db_contract.md |
| Custom roles | rbac_contract.md | api_contract.yaml |

### When Implementing Workflows

| Task | Primary Document | Supporting Documents |
|------|------------------|---------------------|
| Workflow CRUD | api_contract.yaml | NODE_WORKFLOW_ENGINE.md |
| Node types | NODE_WORKFLOW_ENGINE.md | api_contract.yaml |
| Execution engine | WORKFLOW_EXECUTION.md | NODE_WORKFLOW_ENGINE.md |
| AI orchestration | NODE_WORKFLOW_ENGINE.md | - |
| Background execution | BACKGROUND_JOBS.md | WORKFLOW_EXECUTION.md |

### When Implementing Compliance

| Task | Primary Document | Supporting Documents |
|------|------------------|---------------------|
| GDPR compliance | DATA_PROTECTION.md | api_contract.yaml |
| Data export | DATA_PROTECTION.md | BACKGROUND_JOBS.md |
| Audit logging | RLS_AUDIT_LOGGING.md | db_contract.md |
| Tenant deletion | BACKGROUND_JOBS.md | DATA_PROTECTION.md |

### When Setting Up CI/CD

| Task | Primary Document | Supporting Documents |
|------|------------------|---------------------|
| GitHub Actions | CI_CD_PIPELINE.md | - |
| Deployment | CI_CD_PIPELINE.md | VPS_DEPLOYMENT.md |
| Rollback | CI_CD_PIPELINE.md | VPS_DEPLOYMENT.md |

---

## Quick Start Commands

### Phase 1: Infrastructure

```bash
# SSH to server
ssh root@your-server-ip

# Run initial setup (from VPS_DEPLOYMENT.md)
# 1. Create deploy user
# 2. Install dependencies
# 3. Configure PostgreSQL
# 4. Set up Supabase Docker
# 5. Configure Nginx
```

### Phase 2: Database

```bash
# Clone backend repo
git clone git@github.com:getzygo/zygo-backend.git
cd zygo-backend

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env.production
nano .env.production

# Run migrations
pnpm db:migrate
```

### Phase 3: Development

```bash
# Start development server
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build
```

### Phase 5: Deployment

```bash
# Deploy to production (from deploy script)
~/scripts/deploy.sh main

# Rollback if needed
~/scripts/rollback.sh 1
```

---

## Changelog

### v1.0.0 (January 28, 2026)
- Initial development roadmap
- Organized existing documentation into 5 phases
- Created document dependency graph
- Added task-to-document reference tables
- Added phase checklists
