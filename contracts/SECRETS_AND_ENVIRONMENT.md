# Zygo Secrets & Environment Variables

**Version:** 1.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready

This document defines the user-managed Secrets and Environment Variables feature within the Zygo platform. This is a **tenant-isolated, user-facing feature** that allows organizations to securely manage credentials, API keys, and configuration variables for their workflows and integrations.

> **Critical Requirement:** Tenant isolation is **mandatory and non-negotiable**. All secrets and environment variables MUST be strictly isolated per tenant with no possibility of cross-tenant access.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tenant Isolation Model](#tenant-isolation-model)
3. [Scoping System](#scoping-system)
4. [Data Structures](#data-structures)
5. [Environment Variable Templates](#environment-variable-templates)
6. [Security Model](#security-model)
7. [Permissions](#permissions)
8. [API Endpoints](#api-endpoints)
9. [Validation Rules](#validation-rules)
10. [Usage in Workflows](#usage-in-workflows)
11. [API Keys Management](#api-keys-management)
12. [Audit Requirements](#audit-requirements)
13. [Implementation Checklist](#implementation-checklist)

---

## Architecture Overview

### Purpose

The Secrets & Environment Variables feature enables tenants to:
- Store and manage credentials for external services (APIs, databases, cloud providers)
- Configure environment-specific settings for workflows and nodes
- Generate and manage API keys for programmatic access
- Use pre-configured templates for popular services (102+ templates)

### Key Principles

1. **Zero Plaintext Storage**: Values are encrypted immediately upon receipt; backend NEVER stores plaintext
2. **One-Time Display**: Full credential values are shown only once at creation/rotation
3. **Tenant Isolation**: Strict data isolation enforced at database and application level
4. **Least Privilege**: Five granular permissions control access to secrets
5. **Audit Trail**: All operations logged with user, timestamp, and action details

### Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        ZYGO PLATFORM                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Tenant A   │  │  Tenant B   │  │  Tenant C   │   ...        │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤              │
│  │ Workspace   │  │ Workspace   │  │ Workspace   │              │
│  │   Secrets   │  │   Secrets   │  │   Secrets   │              │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤              │
│  │  Project    │  │  Project    │  │  Project    │              │
│  │   Secrets   │  │   Secrets   │  │   Secrets   │              │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤              │
│  │  Runtime    │  │  Runtime    │  │  Runtime    │              │
│  │   Vars      │  │   Vars      │  │   Vars      │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              ENCRYPTION LAYER (AES-256-GCM)              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │     ROW-LEVEL SECURITY (tenant_id = current_tenant)      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tenant Isolation Model

### Non-Negotiable Requirements

| Requirement | Implementation | Enforcement |
|-------------|----------------|-------------|
| Data Isolation | Separate rows per tenant_id | Database RLS policies |
| Query Isolation | Automatic tenant_id filtering | Application middleware |
| Encryption Isolation | Per-tenant encryption keys | Key management service |
| API Isolation | JWT tenant_id claims | API gateway validation |
| Audit Isolation | Tenant-scoped audit logs | Separate log streams |

### Database Row-Level Security

```sql
-- RLS Policy for secrets table
ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY secrets_tenant_isolation ON secrets
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);

-- RLS Policy for environment_variables table
ALTER TABLE environment_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY env_vars_tenant_isolation ON environment_variables
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);

-- RLS Policy for api_keys table
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_tenant_isolation ON api_keys
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
```

### Application-Level Enforcement

```typescript
// Middleware that sets tenant context from JWT
async function setTenantContext(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  const decoded = verifyJWT(token);

  // CRITICAL: tenant_id comes from VERIFIED JWT, never from request body/params
  const tenantId = decoded.tenant_id;

  // Set tenant context for RLS
  await db.raw(`SET app.tenant_id = '${tenantId}'`);

  req.tenantId = tenantId;
  next();
}

// NEVER trust client-provided tenant_id
// ALWAYS use the tenant_id from the verified JWT token
```

### Cross-Tenant Access Prevention

The following are **strictly prohibited**:
- Passing tenant_id as a request parameter
- Querying secrets without RLS context
- Bulk operations across tenants
- Admin override of tenant isolation for secrets
- Sharing encryption keys between tenants

---

## Scoping System

Environment variables and secrets are organized into three scope levels:

### Scope Hierarchy

```
┌─────────────────────────────────────────┐
│             WORKSPACE SCOPE             │
│    (Available to ALL projects)          │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │        PROJECT SCOPE            │   │
│  │   (Specific to one project)     │   │
│  │                                 │   │
│  │  ┌─────────────────────────┐   │   │
│  │  │     RUNTIME SCOPE       │   │   │
│  │  │  (Node execution only)  │   │   │
│  │  └─────────────────────────┘   │   │
│  │                                 │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### Scope Definitions

| Scope | Visibility | Use Case |
|-------|------------|----------|
| `workspace` | All projects in tenant | Organization-wide API keys, shared LLM credentials |
| `project` | Single project only | Project-specific database credentials, unique integrations |
| `runtime` | Node execution only | System variables (NODE_ENV), computed values |

### Scope Resolution Order

When a variable is referenced in a workflow, the system resolves it in this order:
1. **Runtime scope** (highest priority)
2. **Project scope**
3. **Workspace scope** (lowest priority)

If the same variable name exists in multiple scopes, the higher-priority scope wins.

---

## Data Structures

### Environment Variable

```typescript
interface EnvironmentVariable {
  id: string;                              // UUID
  tenant_id: string;                       // UUID - MANDATORY for isolation

  // Identity
  name: string;                            // Variable name (e.g., "OPENAI_API_KEY")
  display_name?: string;                   // Human-readable name (e.g., "OpenAI Production")
  description?: string;                    // Usage notes

  // Classification
  service: string;                         // Service identifier (e.g., "openai", "custom")
  type: VariableType;                      // Value type
  category: string;                        // UI category (e.g., "LLM", "Cloud")

  // Scope
  scope: "workspace" | "project" | "runtime";
  project_id?: string;                     // Required if scope is "project"

  // Security (NO plaintext value stored!)
  value_encrypted: string;                 // AES-256-GCM encrypted value
  value_prefix: string;                    // First 6 chars for identification
  value_suffix: string;                    // Last 4 chars for identification
  value_hash: string;                      // SHA-256 hash for verification
  encryption_key_id: string;               // Reference to encryption key

  // Flags
  is_encrypted: boolean;                   // Always true for secrets
  can_rotate: boolean;                     // Whether rotation is supported

  // Template reference
  template_id?: string;                    // If created from template

  // Audit
  created_at: string;                      // ISO8601
  created_by: string;                      // User ID
  updated_at?: string;                     // ISO8601
  updated_by?: string;                     // User ID
  last_accessed_at?: string;               // Last runtime usage
}

type VariableType =
  | "text"       // Plain text
  | "secret"     // Sensitive, masked in UI
  | "multiline"  // Multi-line text
  | "url"        // URL with validation
  | "number"     // Numeric value
  | "json";      // JSON object/array
```

### API Key

```typescript
interface ApiKey {
  id: string;                              // UUID
  tenant_id: string;                       // UUID - MANDATORY for isolation
  user_id: string;                         // Owner user ID

  // Identity
  name: string;                            // Key name (e.g., "Production CI/CD")
  description?: string;                    // Usage notes

  // Key (prefix only stored, full key shown once)
  key_prefix: string;                      // e.g., "zygo_live_sk_12345"
  key_hash: string;                        // SHA-256 hash for verification

  // Permissions
  permissions: string[];                   // e.g., ["servers:read", "workflows:execute"]

  // Status
  status: "active" | "expired" | "revoked";

  // Expiration
  expires_at?: string;                     // ISO8601 or null for never

  // Usage tracking
  usage_count: number;
  last_used_at?: string;                   // ISO8601
  last_used_ip?: string;

  // Audit
  created_at: string;
  revoked_at?: string;
  revoked_by?: string;
}
```

### Template

```typescript
interface Template {
  id: string;
  name: string;                            // Service name (e.g., "OpenAI")
  slug: string;                            // URL-safe identifier
  category: TemplateCategory;
  category_label: string;                  // Human-readable category
  icon?: string;                           // Icon URL or component name

  // Configuration
  credential_fields: CredentialField[];
  additional_fields?: AdditionalField[];

  // Documentation
  documentation: string[];                 // Setup instructions
  documentation_url?: string;              // External docs link
  setup_guide_url?: string;                // Getting started link
  credentials_url?: string;                // Where to get credentials
}

interface CredentialField {
  name: string;                            // Field identifier
  label: string;                           // Display label
  type: "text" | "password" | "email";     // Input type
  required: boolean;
  placeholder?: string;
  help_text?: string;
}

type TemplateCategory =
  | "llm"            // LLM Providers (10)
  | "mcp"            // MCP Servers (1)
  | "cloud"          // Cloud Infrastructure (6)
  | "collaboration"  // Collaboration Tools (10)
  | "development"    // Dev Tools/VCS (6)
  | "payments"       // Payment Providers (6)
  | "support"        // Support/CRM (5)
  | "crm"            // CRM Systems
  | "project"        // Project Management
  | "storage"        // Storage Services (10)
  | "database"       // Databases (10)
  | "monitoring"     // Monitoring/Analytics (10)
  | "authentication" // Auth Providers (10)
  | "social"         // Social Media (9)
  | "marketing"      // Marketing Tools (2)
  | "infrastructure";// CDN/Deployment (8)
```

---

## Environment Variable Templates

### Template Library (102 Templates)

| Category | Count | Examples |
|----------|-------|----------|
| LLM Providers | 10 | OpenAI, Anthropic, Hugging Face, Cohere, Stability AI |
| Cloud Infrastructure | 6 | Hetzner Cloud, AWS, Azure, GCP, MongoDB |
| Development/VCS | 6 | GitHub, GitLab, Docker Hub, CircleCI, Jenkins |
| Collaboration | 10 | Slack, Twilio, SendGrid, Notion, Discord |
| Storage | 10 | Dropbox, Box, Backblaze B2, MinIO, Supabase |
| Payments | 6 | Stripe, PayPal, Square, Shopify, Razorpay |
| Databases | 10 | PostgreSQL, MySQL, Redis, PlanetScale, Elasticsearch |
| Monitoring | 10 | Datadog, Sentry, New Relic, LogRocket, Mixpanel |
| Authentication | 10 | Auth0, Clerk, Okta, Keycloak, WorkOS |
| Social Media | 9 | Twitter/X, Facebook, LinkedIn, YouTube, TikTok |
| Infrastructure | 8 | Cloudflare, Vercel, Netlify, Railway, Fly.io |
| Marketing | 2 | Mailchimp, ConvertKit |
| MCP Servers | 1 | Brave Search |
| **Total** | **102** | |

### Template Configuration Example

```typescript
// OpenAI Template
const openaiTemplate: TemplateConfig = {
  id: "openai",
  name: "OpenAI",
  category: "llm",
  category_label: "LLM Providers",

  credential_fields: [
    {
      name: "api_key",
      label: "API Key",
      type: "password",
      required: true,
      placeholder: "sk-...",
      help_text: "Your OpenAI API key starting with sk-"
    }
  ],

  additional_fields: [
    {
      name: "organization_id",
      label: "Organization ID (Optional)",
      type: "text",
      required: false,
      placeholder: "org-...",
      help_text: "Required if you belong to multiple organizations"
    }
  ],

  documentation: [
    "OpenAI provides access to GPT-4, GPT-3.5, DALL-E, and other models.",
    "API keys can be created in the OpenAI Dashboard under API Keys.",
    "Keep your API key secure - it provides full access to your account."
  ],

  documentation_url: "https://platform.openai.com/docs",
  setup_guide_url: "https://platform.openai.com/docs/quickstart",
  credentials_url: "https://platform.openai.com/api-keys"
};
```

### Creating Variable from Template

1. User selects template from library
2. Configuration modal opens with:
   - Variable name input
   - Description textarea
   - Dynamic credential fields from template
   - Additional optional fields
3. User fills in credentials
4. System creates variable with:
   - `template_id` reference
   - `service` set to template slug
   - All credentials encrypted immediately
5. One-time display modal shows full values
6. User must copy before closing

---

## Security Model

### Encryption Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    VALUE SUBMISSION                            │
│                                                                │
│  Client ──────► API Gateway ──────► Encryption Service        │
│  (HTTPS)        (TLS 1.3)           (AES-256-GCM)             │
│                                                                │
│                                     │                          │
│                                     ▼                          │
│                              ┌─────────────┐                   │
│                              │   KMS       │                   │
│                              │ (Per-tenant │                   │
│                              │   DEKs)     │                   │
│                              └─────────────┘                   │
│                                     │                          │
│                                     ▼                          │
│                              ┌─────────────┐                   │
│                              │  Database   │                   │
│                              │ (Encrypted  │                   │
│                              │   values)   │                   │
│                              └─────────────┘                   │
└────────────────────────────────────────────────────────────────┘
```

### Encryption Details

| Aspect | Implementation |
|--------|----------------|
| Algorithm | AES-256-GCM |
| Key Derivation | PBKDF2 with per-tenant salt |
| Key Storage | Hardware Security Module (HSM) or KMS |
| Key Rotation | Automated quarterly, manual on-demand |
| IV Generation | Cryptographically random per encryption |

### One-Time Display Pattern

```typescript
// Create variable flow
async function createVariable(data: CreateVariableRequest): Promise<CreateVariableResponse> {
  // 1. Encrypt the value immediately
  const encrypted = await encryptValue(data.value, tenantId);

  // 2. Store encrypted value (plaintext never persisted)
  const variable = await db.insert({
    ...data,
    value_encrypted: encrypted.ciphertext,
    value_prefix: data.value.substring(0, 6),
    value_suffix: data.value.substring(data.value.length - 4),
    value_hash: sha256(data.value),
    encryption_key_id: encrypted.keyId
  });

  // 3. Return with plaintext for ONE-TIME display
  return {
    ...variable,
    value: data.value  // Shown ONCE, then discarded
  };
}

// Get variable flow - NEVER returns plaintext
async function getVariable(id: string): Promise<Variable> {
  const variable = await db.findOne({ id });
  // Note: value_encrypted is NOT decrypted or returned
  return {
    ...variable,
    // Only prefix/suffix for identification
    value_preview: `${variable.value_prefix}••••••••••••${variable.value_suffix}`
  };
}
```

### Value Preview Format

Full values are NEVER displayed after creation. Users see only:

```
BSA_xx••••••••••••••••••••a7f2
```

- **Prefix**: First 6 characters
- **Masked**: 20 `•` characters
- **Suffix**: Last 4 characters

---

## Permissions

### Five Granular Permissions

| Permission | Description | Critical | MFA Required |
|------------|-------------|----------|--------------|
| `canViewSecrets` | View configured secrets (metadata only, prefix/suffix) | No | No |
| `canManageSecrets` | Create, edit, delete secrets and env vars | No | No |
| `canManageTemplates` | Access template library, create from templates | No | No |
| `canRotateSecrets` | Regenerate/rotate credentials | No | No |
| `canExportSecrets` | Export all secrets (bulk download) | **Yes** | **Yes** |

### Role Permission Matrix

| Permission | Owner | Admin | Developer | Member | Viewer |
|------------|-------|-------|-----------|--------|--------|
| `canViewSecrets` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `canManageSecrets` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `canManageTemplates` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `canRotateSecrets` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `canExportSecrets` | ✓ | ✗ | ✗ | ✗ | ✗ |

### UI Behavior by Permission

| User Permission | UI Behavior |
|-----------------|-------------|
| View only | See variables list, no action buttons, read-only banner |
| Manage | Full CRUD, template access, no export |
| Export (Owner) | Export button visible, requires MFA |

---

## API Endpoints

### Environment Variables

#### List Variables
```
GET /api/v1/environment-variables
Authorization: Bearer {token}

Query Parameters:
  - scope: "workspace" | "project" | "runtime" (optional)
  - project_id: UUID (required if scope=project)
  - category: string (optional filter)
  - search: string (optional name search)

Response: {
  data: EnvironmentVariable[],  // Metadata only, no values
  total: number
}
```

#### Create Variable
```
POST /api/v1/environment-variables
Authorization: Bearer {token}
Content-Type: application/json

Request: {
  name: string,           // Required, validated
  value: string,          // Required, will be encrypted
  scope: string,          // Required
  project_id?: string,    // Required if scope=project
  type: string,           // Required
  service?: string,
  description?: string
}

Response: {
  id: string,
  name: string,
  value: string,          // ONE-TIME DISPLAY - full plaintext
  value_prefix: string,
  value_suffix: string,
  scope: string,
  created_at: string,
  ...
}
```

#### Create from Template
```
POST /api/v1/environment-variables/from-template
Authorization: Bearer {token}
Content-Type: application/json

Request: {
  template_id: string,
  variable_name: string,
  description?: string,
  scope: string,
  project_id?: string,
  credentials: Record<string, string>,
  additional_fields?: Record<string, string>
}

Response: {
  id: string,
  name: string,
  credentials: Record<string, string>,  // ONE-TIME DISPLAY
  ...
}
```

#### Update Variable
```
PATCH /api/v1/environment-variables/{id}
Authorization: Bearer {token}
Content-Type: application/json

Request: {
  value?: string,         // New value (will be encrypted)
  scope?: string,         // Can change scope
  description?: string
}

Response: {
  id: string,
  value: string,          // ONE-TIME DISPLAY if value changed
  updated_at: string,
  updated_by: string
}
```

#### Delete Variable
```
DELETE /api/v1/environment-variables/{id}
Authorization: Bearer {token}

Response: {
  success: true,
  deleted_id: string
}
```

#### Rotate Variable
```
POST /api/v1/environment-variables/{id}/rotate
Authorization: Bearer {token}

Response: {
  id: string,
  new_value: string,      // ONE-TIME DISPLAY
  value_prefix: string,
  value_suffix: string,
  rotated_at: string,
  rotated_by: string
}
```

#### Export Variables (MFA Required)
```
POST /api/v1/environment-variables/export
Authorization: Bearer {token}
X-MFA-Code: {6-digit code}

Request: {
  format: "json" | "env" | "csv",
  scope?: string,
  include_values: boolean  // Must be explicitly true
}

Response: {
  download_url: string,    // Signed URL, expires in 5 minutes
  expires_at: string
}
```

#### Import Variables
```
POST /api/v1/environment-variables/import
Authorization: Bearer {token}
Content-Type: multipart/form-data

Form Data: {
  file: File,             // .env, .json, or .csv
  scope: string,
  overwrite: boolean
}

Response: {
  imported: number,
  skipped: number,
  errors: Array<{line: number, error: string}>
}
```

### API Keys

#### List API Keys
```
GET /api/v1/api-keys
Authorization: Bearer {token}

Response: {
  data: ApiKey[]  // Prefix only, no full keys
}
```

#### Create API Key
```
POST /api/v1/api-keys
Authorization: Bearer {token}
Content-Type: application/json

Request: {
  name: string,
  permissions: string[],
  expires_in?: number      // Days, or null for never
}

Response: {
  id: string,
  key: string,             // ONE-TIME DISPLAY - full key
  prefix: string,
  permissions: string[],
  created_at: string,
  expires_at?: string
}
```

#### Revoke API Key
```
DELETE /api/v1/api-keys/{id}
Authorization: Bearer {token}

Response: {
  id: string,
  status: "revoked",
  revoked_at: string
}
```

#### Regenerate API Key
```
POST /api/v1/api-keys/{id}/regenerate
Authorization: Bearer {token}

Response: {
  id: string,
  key: string,             // ONE-TIME DISPLAY - new full key
  prefix: string,
  created_at: string       // New timestamp
}
```

### Templates

#### List Templates
```
GET /api/v1/templates
Authorization: Bearer {token}

Query Parameters:
  - category: string (optional filter)
  - search: string (optional name search)

Response: {
  data: Template[],
  categories: Array<{name: string, count: number}>
}
```

#### Get Template Config
```
GET /api/v1/templates/{id}/config
Authorization: Bearer {token}

Response: TemplateConfig
```

---

## Validation Rules

### Variable Name Validation

```typescript
const RESERVED_PREFIXES = [
  'ZYGO_',        // System variables
  'SYSTEM_',      // System variables
  'INTERNAL_',    // Internal use
  'NODE_',        // Node.js reserved
  'REACT_APP_'    // React reserved
];

function validateVariableName(name: string): ValidationResult {
  // Must not be empty
  if (!name) return { valid: false, error: "Name is required" };

  // Must match pattern: uppercase, underscores, numbers
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    return { valid: false, error: "Name must be uppercase with underscores" };
  }

  // Cannot start with reserved prefix
  for (const prefix of RESERVED_PREFIXES) {
    if (name.startsWith(prefix)) {
      return { valid: false, error: `Cannot start with reserved prefix: ${prefix}` };
    }
  }

  // Length limits
  if (name.length < 3) return { valid: false, error: "Minimum 3 characters" };
  if (name.length > 64) return { valid: false, error: "Maximum 64 characters" };

  return { valid: true };
}
```

### Type-Specific Validation

| Type | Validation |
|------|------------|
| `url` | Must be valid URL with http:// or https:// |
| `json` | Must be valid JSON syntax |
| `number` | Must be valid numeric value |
| `text` | Any string value |
| `secret` | Any string value (treated as sensitive) |
| `multiline` | Any string value (may contain newlines) |

### Duplicate Detection

- Duplicates checked within same scope only
- Same name allowed in different scopes (scope resolution applies)
- Import with `overwrite=false` skips duplicates

---

## Usage in Workflows

### Variable Interpolation Syntax

Variables can be referenced in workflows and node configurations using:

```
${VARIABLE_NAME}
```

or

```
{{VARIABLE_NAME}}
```

### Resolution Example

```yaml
# Workflow configuration
nodes:
  - id: openai_call
    type: llm/openai
    config:
      api_key: ${OPENAI_API_KEY}
      model: gpt-4

  - id: database_query
    type: database/postgres
    config:
      connection_string: ${DATABASE_URL}
      query: "SELECT * FROM users"
```

### Runtime Injection

At workflow execution time:
1. System identifies all `${VAR}` and `{{VAR}}` references
2. Resolves variables using scope priority (runtime > project > workspace)
3. Decrypts values using tenant's encryption key
4. Injects plaintext values into node execution context
5. Plaintext values are **never logged** or **persisted**

---

## API Keys Management

### API Key Format

```
zygo_live_sk_1234567890abcdef
│     │    │  └── Random suffix (16+ chars)
│     │    └── Key type (sk = secret key)
│     └── Environment (live/test)
└── Platform prefix
```

### Available Permissions for API Keys

```typescript
const API_KEY_PERMISSIONS = [
  // Servers
  "servers:read",
  "servers:create",
  "servers:manage",
  "servers:delete",

  // Workflows
  "workflows:read",
  "workflows:execute",
  "workflows:manage",

  // Secrets
  "secrets:read",
  "secrets:manage",

  // Nodes
  "nodes:read",
  "nodes:execute",

  // Audit
  "audit:read"
];
```

### API Key Security

- Full key shown **once** at creation
- Only `key_prefix` stored and displayed afterward
- `key_hash` (SHA-256) used for verification
- IP allowlist support (optional)
- Rate limiting per key
- Auto-revoke on suspicious activity

---

## Audit Requirements

### Events to Log

| Event | Severity | Data Logged |
|-------|----------|-------------|
| `secret.created` | medium | name, scope, service, user, timestamp |
| `secret.updated` | medium | name, fields_changed, user, timestamp |
| `secret.deleted` | high | name, scope, user, timestamp |
| `secret.rotated` | medium | name, user, timestamp |
| `secret.accessed` | low | name, accessor (user/workflow), timestamp |
| `secret.exported` | critical | user, scope, format, mfa_verified, timestamp |
| `apikey.created` | medium | name, permissions, user, timestamp |
| `apikey.revoked` | high | name, user, timestamp |
| `apikey.regenerated` | medium | name, user, timestamp |
| `apikey.used` | low | key_prefix, endpoint, ip, timestamp |

### Audit Log Schema

```typescript
interface SecretAuditLog {
  id: string;
  tenant_id: string;
  event_type: string;
  severity: "low" | "medium" | "high" | "critical";

  actor: {
    type: "user" | "api_key" | "workflow";
    id: string;
    email?: string;
    ip_address: string;
  };

  target: {
    type: "secret" | "environment_variable" | "api_key";
    id: string;
    name: string;
  };

  metadata: {
    scope?: string;
    service?: string;
    fields_changed?: string[];
    mfa_verified?: boolean;
  };

  timestamp: string;
}
```

---

## Implementation Checklist

### Database Requirements

- [ ] `environment_variables` table with RLS
- [ ] `api_keys` table with RLS
- [ ] `templates` table (global, read-only)
- [ ] `template_configs` table (global, read-only)
- [ ] `secret_audit_logs` table with RLS
- [ ] Encryption key management tables
- [ ] Tenant-scoped indexes

### Backend Requirements

- [ ] Encryption service (AES-256-GCM)
- [ ] Key management service integration
- [ ] Tenant context middleware
- [ ] Permission enforcement middleware
- [ ] MFA verification for export
- [ ] Rate limiting per tenant
- [ ] Audit logging service

### API Requirements

- [ ] All CRUD endpoints for variables
- [ ] Template endpoints
- [ ] API key endpoints
- [ ] Export/import endpoints
- [ ] Proper error responses

### Security Requirements

- [ ] Zero plaintext storage
- [ ] One-time display implementation
- [ ] Per-tenant encryption keys
- [ ] RLS policies enabled
- [ ] MFA for critical operations
- [ ] Audit trail for all operations

### Frontend Requirements

- [ ] Environment Variables page
- [ ] Templates browser page
- [ ] Template configuration modal
- [ ] One-time display modal
- [ ] Permission-based UI
- [ ] Read-only mode for viewers

---

## Database Schema

### environment_variables Table

```sql
CREATE TABLE environment_variables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  display_name TEXT,
  description TEXT,

  -- Classification
  service TEXT NOT NULL DEFAULT 'custom',
  type TEXT NOT NULL DEFAULT 'secret',
  category TEXT NOT NULL DEFAULT 'Custom',

  -- Scope
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'project', 'runtime')),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

  -- Encrypted Value (NEVER store plaintext)
  value_encrypted TEXT NOT NULL,
  value_prefix TEXT NOT NULL,
  value_suffix TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  encryption_key_id UUID NOT NULL,

  -- Flags
  is_encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  can_rotate BOOLEAN NOT NULL DEFAULT TRUE,

  -- Template Reference
  template_id TEXT,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id),
  last_accessed_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT unique_name_per_scope UNIQUE (tenant_id, name, scope, project_id),
  CONSTRAINT project_required_for_project_scope
    CHECK (scope != 'project' OR project_id IS NOT NULL)
);

-- Indexes
CREATE INDEX idx_env_vars_tenant ON environment_variables(tenant_id);
CREATE INDEX idx_env_vars_scope ON environment_variables(tenant_id, scope);
CREATE INDEX idx_env_vars_project ON environment_variables(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_env_vars_service ON environment_variables(tenant_id, service);

-- RLS
ALTER TABLE environment_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY env_vars_tenant_isolation ON environment_variables
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
```

### api_keys Table

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,

  -- Key (hash only, never store plaintext)
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,

  -- Permissions
  permissions TEXT[] NOT NULL DEFAULT '{}',

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),

  -- Expiration
  expires_at TIMESTAMPTZ,

  -- Usage
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  last_used_ip INET,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),

  -- Constraints
  CONSTRAINT unique_key_name_per_tenant UNIQUE (tenant_id, name)
);

-- Indexes
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_status ON api_keys(tenant_id, status);

-- RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_tenant_isolation ON api_keys
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
```

---

## Contact

- **Backend Team:** backend@zygo.tech
- **Security Team:** security@zygo.tech
- **Documentation:** docs@zygo.tech
