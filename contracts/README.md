# Zygo Backend Documentation

**Version:** 3.2.0
**Last Updated:** January 28, 2026
**Status:** Production-Ready

This directory contains backend-specific documentation for the Zygo platform API, database, and infrastructure.

---

## Documentation Index

### Core Contracts

| Document | Description |
|----------|-------------|
| [api_contract.yaml](./api_contract.yaml) | OpenAPI 3.1 specification for all backend APIs |
| [db_contract.md](./db_contract.md) | Database schema with all tables, RLS policies, and relations |
| [rbac_contract.md](./rbac_contract.md) | Complete RBAC system: 114 permissions, 6 roles, mappings |
| [supabase_migration_plan.md](./supabase_migration_plan.md) | Ordered SQL migrations with rollbacks and RLS policies |

### Architecture & Implementation

| Document | Description |
|----------|-------------|
| [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) | Hono + Drizzle architecture, project structure, middleware, services |
| [NODE_WORKFLOW_ENGINE.md](./NODE_WORKFLOW_ENGINE.md) | Core platform: AI Agent orchestration, 20 node types, workflow engine |
| [WORKFLOW_EXECUTION.md](./WORKFLOW_EXECUTION.md) | Workflow execution API, WebSocket updates, retry policies |
| [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md) | Background jobs, data lifecycle management, tenant/user deletion workflows |
| [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md) | Supabase Edge Functions: auth hooks, webhooks, realtime auth |

### Authentication & Security

| Document | Description |
|----------|-------------|
| [AUTHENTICATION.md](./AUTHENTICATION.md) | Complete auth strategy: login, signup, password reset, social OAuth, Enterprise SSO |
| [OAUTH_STRATEGY.md](./OAUTH_STRATEGY.md) | OAuth 2.0 SSO authentication + external integrations (OneDrive, Google Drive, etc.) |
| [RATE_LIMITING.md](./RATE_LIMITING.md) | Rate limit strategies, auth protection, plan-based limits |
| [RLS_AUDIT_LOGGING.md](./RLS_AUDIT_LOGGING.md) | RLS violation detection, security audit trails, admin override logging |
| [API_ERROR_SPECIFICATION.md](./API_ERROR_SPECIFICATION.md) | Standardized error codes, HTTP status codes, error response schema |

### Multi-Tenancy & Compliance

| Document | Description |
|----------|-------------|
| [TENANCY.md](./TENANCY.md) | Multi-tenant architecture, mode resolution, storage isolation |
| [DATA_PROTECTION.md](./DATA_PROTECTION.md) | GDPR/CCPA/CPRA/APPI compliance requirements |
| [SECRETS_AND_ENVIRONMENT.md](./SECRETS_AND_ENVIRONMENT.md) | User-managed secrets & environment variables (tenant-isolated) |

### Infrastructure & Deployment

| Document | Description |
|----------|-------------|
| [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md) | Ubuntu 22.04 VPS setup, PostgreSQL, Redis, Nginx, PM2, SSL |
| [DNS_CONFIGURATION.md](./DNS_CONFIGURATION.md) | DNS setup, Cloudflare, SSL/TLS, email records, CDN configuration |
| [CI_CD_PIPELINE.md](./CI_CD_PIPELINE.md) | GitHub Actions workflows, SSH deployment, rollback procedures |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | Backend environment configuration and secrets |
| [.env.example](./.env.example) | Example environment variables for backend |

### Development Guide

| Document | Description |
|----------|-------------|
| [APPLICATION_DEVELOPMENT_PLAN.md](./APPLICATION_DEVELOPMENT_PLAN.md) | **START HERE** - Complete app development plan from auth to AI workflows |
| [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) | Infrastructure-focused development path, document dependencies |
| [BACKEND_READINESS_ASSESSMENT.md](./BACKEND_READINESS_ASSESSMENT.md) | Documentation audit, gap analysis, development readiness |

---

## Domain Structure

| Domain | Purpose | Content |
|--------|---------|---------|
| **getzygo.com** | Public-facing | Landing page, marketing, auth pages, public docs |
| **zygo.tech** | Application | API (`api.zygo.tech`), tenant app (`*.app.zygo.tech`), admin panel |
| **zygo.cloud** | Infrastructure | Cloud services, nameservers, node deployments |

---

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Hono | 4.x | Web framework |
| Drizzle ORM | Latest | Database ORM |
| PostgreSQL | 15 | Database |
| Redis | 7.x | Caching & queues |
| BullMQ | Latest | Job queue |
| Supabase | Latest | Auth, Realtime, Edge Functions |
| TypeScript | 5.x | Type safety |
| Zod | 3.x | Schema validation |

---

## API Overview

### Endpoint Summary

| Category | Count | Description |
|----------|-------|-------------|
| Auth/Session | 20+ | Login, signup, OAuth, MFA, sessions |
| Users | 8 | User CRUD, profile, preferences |
| Roles | 6 | Role management, permissions |
| Infrastructure | 50+ | Servers, volumes, networks, DNS |
| Webhooks | 6 | Webhook configuration and delivery |
| Billing | 40+ | Subscriptions, payments, licenses |
| Compliance | 15 | GDPR exports, deletion requests |
| Audit | 8 | Audit logs, security events |
| Workflows | 20+ | Workflow CRUD, execution, nodes |

### Admin Endpoints

| Category | Count | Description |
|----------|-------|-------------|
| Admin Auth | 3 | Global admin authentication |
| Tenant Management | 6 | Cross-tenant operations |
| System Stats | 4 | Platform metrics |
| Global Audit | 4 | Platform-wide audit logs |
| Feature Flags | 3 | Feature toggle management |

---

## Database Overview

### Tables by Category

| Category | Tables | RLS |
|----------|--------|-----|
| Core Tenancy | 4 | ✅ |
| RBAC | 4 | ✅ |
| Users/Auth | 8 | ✅ |
| Infrastructure | 12 | ✅ |
| Secrets/Variables | 4 | ✅ |
| Webhooks | 2 | ✅ |
| Billing/Licenses | 12 | ✅ |
| Compliance | 6 | ✅ |
| Audit | 5 | ✅ |
| Node/Workflows | 8 | ✅ |

**Total: 65 tables with Row-Level Security**

---

## Permission System

### Categories

| Category | Count | Critical | MFA Required |
|----------|-------|----------|--------------|
| Billing & Subscription | 9 | 1 | 1 |
| User Management | 4 | 1 | 0 |
| Roles & Permissions | 3 | 0 | 0 |
| Organization Settings | 3 | 1 | 1 |
| Secrets & Environment | 5 | 1 | 1 |
| Webhooks | 4 | 0 | 0 |
| Cloud Providers | 2 | 0 | 0 |
| Servers & Compute | 10 | 2 | 0 |
| Volumes & Storage | 7 | 1 | 0 |
| Networks | 6 | 1 | 0 |
| Firewalls | 6 | 1 | 0 |
| Load Balancers | 7 | 1 | 0 |
| DNS Management | 6 | 1 | 0 |
| Snapshots & Backups | 6 | 0 | 0 |
| Floating IPs | 4 | 0 | 0 |
| AI Components | 12 | 1 | 0 |
| Workflows | 6 | 0 | 0 |
| Monitoring | 6 | 0 | 0 |

**Total: 114 permissions, 18 critical, 3 MFA-required**

---

## Getting Started

### Recommended Reading Order

**Start with [APPLICATION_DEVELOPMENT_PLAN.md](./APPLICATION_DEVELOPMENT_PLAN.md)** - Complete development plan covering authentication, user journeys, tenant management, infrastructure, and AI workflows across 5 milestones.

For infrastructure-specific setup, see [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md).

### For Backend Developers

1. **Phase 1-2:** Follow infrastructure and database setup in roadmap
2. **Phase 3:** Use `api_contract.yaml` for endpoint implementation
3. **Phase 3:** Use `db_contract.md` for database schema reference
4. **Phase 3:** Use `rbac_contract.md` for permission enforcement
5. **Phase 4-5:** Implement workflows, jobs, and compliance

### For DevOps

1. **Phase 1:** Use `VPS_DEPLOYMENT.md` for server setup
2. **Phase 1:** Use `DNS_CONFIGURATION.md` for DNS configuration
3. **Phase 5:** Use `CI_CD_PIPELINE.md` for deployment pipelines
4. Reference `ENVIRONMENT.md` for environment variables

---

## Related Documentation

For frontend documentation, see the [zygo-ui](https://github.com/getzygo/zygo-ui) repository:

- Frontend architecture and routing
- Design system and components
- Multi-tenant mode detection
- Cookie consent implementation

---

## Changelog

### v3.2.0 (January 28, 2026)

- Added APPLICATION_DEVELOPMENT_PLAN.md - complete app development plan
  - 5 milestones from authentication to production
  - Detailed user journeys for all features
  - API and frontend development sequences
  - Testing strategy and definition of done

### v3.1.0 (January 28, 2026)

- Added DEVELOPMENT_ROADMAP.md - logical 5-phase development guide
- Updated Getting Started section to reference roadmap first

### v3.0.0 (January 27, 2026)

- Reorganized documentation for backend-only focus
- Removed frontend UI specification documents (moved to zygo-ui)
- Added domain structure section
- Updated documentation index

### v2.20.0 (January 26, 2026)

- Enhanced Authentication Security Features
- Suspicious Activity Detection
- Phone Verification with Twilio SMS
- SMS-Based MFA

---

## Contact

- **Backend Team:** backend@zygo.tech
- **DevOps Team:** devops@zygo.tech
- **Security Team:** security@zygo.tech
