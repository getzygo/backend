# Zygo Environment Variables

**Version:** 2.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready

This document defines all environment variables required for the Zygo backend.

---

## Table of Contents

1. [Overview](#overview)
2. [Environment Types](#environment-types)
3. [Variable Categories](#variable-categories)
   - [Core Application](#core-application)
   - [Database](#database)
   - [Authentication](#authentication)
   - [Cloud Providers](#cloud-providers)
   - [Email](#email)
   - [Storage](#storage)
   - [Payments](#payments)
   - [Monitoring](#monitoring)
   - [AI/ML](#aiml)
   - [Feature Flags](#feature-flags)
4. [Security Guidelines](#security-guidelines)
5. [Environment-Specific Overrides](#environment-specific-overrides)
6. [Secrets Management](#secrets-management)

---

## Overview

### Key Principles

1. **No Frontend Environment Variables**: The Zygo UI uses runtime mode detection from hostname patterns, eliminating the need for `VITE_*` variables
2. **Backend-Only Secrets**: All sensitive configuration is server-side only
3. **Hierarchical Configuration**: Environment → Tenant → User preferences
4. **Encrypted at Rest**: All secrets encrypted using AES-256-GCM

### Domain Structure

Zygo uses three primary domains:

| Domain | Purpose | Content |
|--------|---------|---------|
| **getzygo.com** | Public-facing | Landing page, marketing, auth pages, public docs |
| **zygo.tech** | Application | API, tenant app, admin panel, internal services |
| **zygo.cloud** | Infrastructure | Cloud services, nameservers, node deployments |

### Environment Detection (UI)

The frontend detects its environment from URL patterns:

| URL Pattern | Mode | Behavior |
|-------------|------|----------|
| `admin.zygo.tech` | Global Admin | Full platform administration |
| `{tenant}.zygo.tech` | Tenant | Tenant-specific dashboard |
| `demo.zygo.tech` | Demo | Demo mode with sample data |
| `localhost:*` | Development | Local development mode |
| `getzygo.com` | Public | Marketing/landing (separate app) |

---

## Environment Types

| Environment | Purpose | Typical Deployment |
|-------------|---------|-------------------|
| `development` | Local development | Developer machines |
| `staging` | Pre-production testing | Staging server |
| `production` | Live production | Production cluster |
| `test` | Automated testing | CI/CD pipelines |

---

## Variable Categories

### Core Application

```bash
# Application
NODE_ENV=production                    # Environment: development | staging | production | test
APP_NAME=Zygo                          # Application name

# Domain Structure:
#   - getzygo.com: Public-facing (landing page, auth pages, public docs)
#   - zygo.tech: Application (API, tenant app, admin panel)
#   - zygo.cloud: Infrastructure (nameservers, deployed nodes)

# Application URLs (zygo.tech)
APP_URL=https://app.zygo.tech          # Main application URL
ADMIN_URL=https://admin.zygo.tech      # Admin panel URL
API_URL=https://api.zygo.tech          # API base URL

# Public URLs (getzygo.com)
PUBLIC_URL=https://getzygo.com         # Landing/marketing site
DOCS_URL=https://docs.getzygo.com      # Public documentation

# Server
PORT=3000                              # Server port
HOST=0.0.0.0                           # Server host binding

# Logging
LOG_LEVEL=info                         # Log level: debug | info | warn | error
LOG_FORMAT=json                        # Log format: json | text
LOG_PRETTY=false                       # Pretty print logs (development only)

# CORS (include both zygo.tech and getzygo.com domains)
CORS_ORIGINS=https://app.zygo.tech,https://admin.zygo.tech,https://getzygo.com,https://docs.getzygo.com
CORS_CREDENTIALS=true                  # Allow credentials in CORS

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000             # Rate limit window (1 minute)
RATE_LIMIT_MAX_REQUESTS=100            # Max requests per window
```

### Database

```bash
# PostgreSQL (Supabase)
DATABASE_URL=postgresql://user:pass@host:5432/zygo?sslmode=require
DATABASE_POOL_MIN=2                    # Minimum pool connections
DATABASE_POOL_MAX=10                   # Maximum pool connections
DATABASE_SSL=true                      # Require SSL

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...               # Public anon key (safe for client)
SUPABASE_SERVICE_ROLE_KEY=eyJ...       # Service role key (server only!)

# Redis (for caching/sessions)
REDIS_URL=redis://localhost:6379
REDIS_TLS=true                         # Enable TLS for Redis
REDIS_KEY_PREFIX=zygo:                 # Key prefix for namespacing
```

### Authentication

```bash
# JWT Configuration
JWT_SECRET=your-256-bit-secret         # HMAC secret (min 32 chars)
JWT_ALGORITHM=HS256                    # Algorithm: HS256 | RS256
JWT_ACCESS_TOKEN_EXPIRES=15m           # Access token expiry
JWT_REFRESH_TOKEN_EXPIRES=7d           # Refresh token expiry

# Session
SESSION_SECRET=your-session-secret     # Session encryption key
SESSION_COOKIE_NAME=zygo_session       # Cookie name
SESSION_COOKIE_SECURE=true             # Secure cookies (HTTPS only)
SESSION_COOKIE_SAME_SITE=strict        # SameSite policy

# OAuth Providers
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx

GITHUB_CLIENT_ID=Iv1.xxx
GITHUB_CLIENT_SECRET=xxx

# SAML (Enterprise)
SAML_ENTITY_ID=https://api.zygo.tech/saml
SAML_CALLBACK_URL=https://api.zygo.tech/auth/saml/callback
SAML_CERTIFICATE_PATH=/etc/zygo/saml/cert.pem
SAML_PRIVATE_KEY_PATH=/etc/zygo/saml/key.pem

# MFA
MFA_ISSUER=Zygo                        # TOTP issuer name
MFA_BACKUP_CODES_COUNT=10              # Number of backup codes
```

### Cloud Providers

```bash
# DigitalOcean
DIGITALOCEAN_TOKEN=dop_v1_xxx          # API token
DIGITALOCEAN_SPACES_KEY=xxx            # Spaces access key
DIGITALOCEAN_SPACES_SECRET=xxx         # Spaces secret key
DIGITALOCEAN_SPACES_REGION=nyc3        # Spaces region
DIGITALOCEAN_SPACES_BUCKET=zygo-files  # Spaces bucket name

# AWS
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1
AWS_S3_BUCKET=zygo-files

# GCP
GCP_PROJECT_ID=zygo-prod
GCP_CREDENTIALS_JSON=/etc/zygo/gcp-credentials.json
GCP_STORAGE_BUCKET=zygo-files

# Azure
AZURE_SUBSCRIPTION_ID=xxx
AZURE_TENANT_ID=xxx
AZURE_CLIENT_ID=xxx
AZURE_CLIENT_SECRET=xxx
AZURE_STORAGE_ACCOUNT=zygofiles
AZURE_STORAGE_KEY=xxx

# Hetzner
HETZNER_API_TOKEN=xxx

# Linode
LINODE_API_TOKEN=xxx

# Vultr
VULTR_API_KEY=xxx
```

### Email

```bash
# SMTP Configuration
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=true                       # Use TLS
SMTP_USER=apikey
SMTP_PASSWORD=SG.xxx

# Email Addresses
EMAIL_FROM_ADDRESS=noreply@zygo.tech
EMAIL_FROM_NAME=Zygo
EMAIL_REPLY_TO=support@zygo.tech

# SendGrid (alternative)
SENDGRID_API_KEY=SG.xxx

# AWS SES (alternative)
AWS_SES_REGION=us-east-1
```

### Storage

```bash
# File Storage
STORAGE_DRIVER=s3                      # Driver: local | s3 | gcs | azure
STORAGE_LOCAL_PATH=/var/zygo/uploads   # Local storage path
STORAGE_MAX_FILE_SIZE=104857600        # Max file size (100MB)

# S3-Compatible Storage
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_BUCKET=zygo-files
S3_REGION=nyc3
S3_ACCESS_KEY=xxx
S3_SECRET_KEY=xxx
S3_ACL=private                         # Object ACL: private | public-read

# CDN
CDN_ENABLED=true
CDN_URL=https://cdn.zygo.tech
```

### Payments

```bash
# Stripe
STRIPE_SECRET_KEY=sk_live_xxx          # Secret key (server only!)
STRIPE_PUBLISHABLE_KEY=pk_live_xxx     # Publishable key
STRIPE_WEBHOOK_SECRET=whsec_xxx        # Webhook signing secret

# Stripe Products/Prices (for subscription tiers)
STRIPE_PRICE_STARTER_MONTHLY=price_xxx
STRIPE_PRICE_STARTER_YEARLY=price_xxx
STRIPE_PRICE_PRO_MONTHLY=price_xxx
STRIPE_PRICE_PRO_YEARLY=price_xxx
STRIPE_PRICE_ENTERPRISE_MONTHLY=price_xxx
STRIPE_PRICE_ENTERPRISE_YEARLY=price_xxx

# Tax Configuration
STRIPE_TAX_ENABLED=true
STRIPE_TAX_BEHAVIOR=exclusive          # Tax behavior: inclusive | exclusive
```

### Monitoring

```bash
# Sentry (Error Tracking)
SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1          # 10% of transactions
SENTRY_PROFILES_SAMPLE_RATE=0.1        # 10% of profiles

# DataDog (APM)
DD_API_KEY=xxx
DD_APP_KEY=xxx
DD_SITE=datadoghq.com
DD_SERVICE=zygo-api
DD_ENV=production

# Prometheus (Metrics)
PROMETHEUS_ENABLED=true
PROMETHEUS_PORT=9090
PROMETHEUS_PATH=/metrics

# Health Checks
HEALTH_CHECK_PATH=/health
HEALTH_CHECK_TIMEOUT=5000              # Timeout in ms
```

### AI/ML

```bash
# OpenAI
OPENAI_API_KEY=sk-xxx
OPENAI_ORGANIZATION=org-xxx
OPENAI_DEFAULT_MODEL=gpt-4-turbo

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_DEFAULT_MODEL=claude-3-opus-20240229

# Cohere
COHERE_API_KEY=xxx

# Hugging Face
HUGGINGFACE_API_KEY=hf_xxx

# Vector Database (Pinecone)
PINECONE_API_KEY=xxx
PINECONE_ENVIRONMENT=us-east-1
PINECONE_INDEX=zygo-embeddings

# AI Rate Limits
AI_RATE_LIMIT_RPM=60                   # Requests per minute
AI_MAX_TOKENS_PER_REQUEST=4096         # Max tokens per request
```

### Feature Flags

```bash
# LaunchDarkly
LAUNCHDARKLY_SDK_KEY=sdk-xxx

# Internal Feature Flags (fallback)
FEATURE_AI_WORKFLOWS=true
FEATURE_ADVANCED_ANALYTICS=true
FEATURE_CUSTOM_BRANDING=true
FEATURE_SSO=true
FEATURE_MULTI_CLOUD=true
FEATURE_BETA_FEATURES=false
```

### Encryption & Security

```bash
# Encryption Keys
ENCRYPTION_KEY=32-byte-hex-key         # AES-256 encryption key
ENCRYPTION_KEY_ID=key_2024_01          # Key identifier for rotation

# API Key Signing
API_KEY_SIGNING_SECRET=xxx             # For API key generation

# Webhook Signing
WEBHOOK_SIGNING_SECRET=xxx             # Default webhook secret

# Audit Log Integrity
AUDIT_HMAC_SECRET=xxx                  # HMAC secret for audit logs
```

### Queues & Background Jobs

```bash
# Bull/BullMQ (Redis-based queues)
QUEUE_REDIS_URL=redis://localhost:6379/1
QUEUE_PREFIX=zygo:queue:

# Job Configuration
JOB_RETRY_ATTEMPTS=3
JOB_RETRY_DELAY=5000                   # 5 seconds
JOB_TIMEOUT=300000                     # 5 minutes

# Specific Queues
QUEUE_EMAIL_CONCURRENCY=5
QUEUE_WEBHOOK_CONCURRENCY=10
QUEUE_WORKFLOW_CONCURRENCY=3
```

---

## Security Guidelines

### Required Security Practices

1. **Never Commit Secrets**
   - Use `.env.example` as template
   - Add `.env*` to `.gitignore`
   - Use secret managers in production

2. **Rotate Secrets Regularly**
   - JWT secrets: Every 90 days
   - API keys: Every 180 days
   - Encryption keys: Every 365 days

3. **Use Different Keys Per Environment**
   - Never share secrets between environments
   - Production secrets should be unique

4. **Principle of Least Privilege**
   - Service accounts with minimal permissions
   - Separate read/write credentials where possible

### Secret Classification

| Classification | Examples | Storage |
|---------------|----------|---------|
| Critical | JWT_SECRET, ENCRYPTION_KEY | Hardware Security Module (HSM) |
| High | Database credentials, API keys | Secret Manager (AWS/GCP/Vault) |
| Medium | SMTP credentials, OAuth secrets | Encrypted environment files |
| Low | Feature flags, non-sensitive config | Environment variables |

---

## Environment-Specific Overrides

### Development

```bash
# Development overrides
NODE_ENV=development
LOG_LEVEL=debug
LOG_PRETTY=true
DATABASE_SSL=false
SESSION_COOKIE_SECURE=false
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Staging

```bash
# Staging overrides
NODE_ENV=staging
LOG_LEVEL=debug
SENTRY_ENVIRONMENT=staging
STRIPE_SECRET_KEY=sk_test_xxx          # Use test keys
```

### Production

```bash
# Production requirements
NODE_ENV=production
LOG_LEVEL=info
DATABASE_SSL=true
SESSION_COOKIE_SECURE=true
CORS_CREDENTIALS=true
```

---

## Secrets Management

### Recommended Tools

| Tool | Best For | Integration |
|------|----------|-------------|
| AWS Secrets Manager | AWS deployments | Native SDK |
| GCP Secret Manager | GCP deployments | Native SDK |
| HashiCorp Vault | Multi-cloud | API/Agent |
| Doppler | All environments | CLI/SDK |
| 1Password | Small teams | CLI |

### Loading Secrets

```javascript
// Example: Loading from AWS Secrets Manager
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

async function loadSecrets() {
  const client = new SecretsManagerClient({ region: "us-east-1" });
  const command = new GetSecretValueCommand({ SecretId: "zygo/production" });
  const response = await client.send(command);
  return JSON.parse(response.SecretString);
}
```

### Secret Rotation

```bash
# Rotation script example
#!/bin/bash
set -e

# Generate new JWT secret
NEW_JWT_SECRET=$(openssl rand -hex 32)

# Update secret manager
aws secretsmanager update-secret \
  --secret-id zygo/production \
  --secret-string "{\"JWT_SECRET\": \"$NEW_JWT_SECRET\"}"

# Trigger rolling restart
kubectl rollout restart deployment/zygo-api
```

---

## Validation Schema

Use this JSON Schema to validate environment configuration:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": [
    "NODE_ENV",
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "JWT_SECRET",
    "ENCRYPTION_KEY"
  ],
  "properties": {
    "NODE_ENV": {
      "type": "string",
      "enum": ["development", "staging", "production", "test"]
    },
    "DATABASE_URL": {
      "type": "string",
      "pattern": "^postgresql://"
    },
    "JWT_SECRET": {
      "type": "string",
      "minLength": 32
    },
    "ENCRYPTION_KEY": {
      "type": "string",
      "minLength": 32
    }
  }
}
```

---

## Changelog

### v2.0.0 (January 26, 2026)

- Added AI/ML configuration section
- Added cloud provider credentials
- Added billing/Stripe configuration
- Added queue configuration
- Removed frontend VITE_* variables (runtime detection)
- Added security guidelines
- Added secret rotation documentation
