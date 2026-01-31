# Background Jobs & Data Lifecycle Management

**Version:** 1.0.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready
**Related:** DATA_PROTECTION.md, RLS_AUDIT_LOGGING.md

---

## Table of Contents

1. [Overview](#overview)
2. [Data Lifecycle Stages](#data-lifecycle-stages)
3. [Policy-Based Processing](#policy-based-processing)
4. [Job Definitions](#job-definitions)
5. [Tenant Deletion Process](#tenant-deletion-process)
6. [User Deletion Process](#user-deletion-process)
7. [Data Archival](#data-archival)
8. [Cold Storage](#cold-storage)
9. [Job Queue Architecture](#job-queue-architecture)
10. [Monitoring & Observability](#monitoring--observability)
11. [Database Schema](#database-schema)
12. [API Endpoints](#api-endpoints)

---

## Overview

This document defines all background jobs and data lifecycle management processes for the Zygo platform. All operations respect the data protection policies selected by tenants and follow incremental processing patterns.

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| Policy-Driven | Operations respect tenant's selected data protection policy |
| Soft Delete First | All deletions are soft deletes with archival |
| Incremental Processing | Large operations processed in batches |
| Idempotent | Jobs can be safely retried |
| Observable | Progress tracking and audit logging |
| Recoverable | Grace periods allow restoration |

### Data Protection Policy Integration

Background jobs respect the tenant's selected compliance framework:

| Policy | Deletion Grace Period | Archive Retention | Cold Storage | Hard Delete |
|--------|----------------------|-------------------|--------------|-------------|
| GDPR | 30 days | 90 days | 7 years | After retention |
| CCPA | 45 days | 90 days | 7 years | After retention |
| HIPAA | 30 days | 6 years | 10 years | After retention |
| SOC2 | 30 days | 1 year | 7 years | After retention |
| Custom | Configurable | Configurable | Configurable | Configurable |

---

## Data Lifecycle Stages

### Lifecycle Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LIFECYCLE STAGES                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐│
│  │  ACTIVE  │───▶│  SOFT    │───▶│ ARCHIVED │───▶│   COLD   │───▶│ PURGED ││
│  │          │    │ DELETED  │    │          │    │ STORAGE  │    │        ││
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └────────┘│
│       │               │               │               │               │     │
│       │               │               │               │               │     │
│       ▼               ▼               ▼               ▼               ▼     │
│   Normal Use    Grace Period     Compressed      Encrypted        Gone     │
│   Full Access   Can Restore      Read-Only       Compliance       Forever  │
│   Hot Storage   Hot Storage      Warm Storage    Archive Only              │
│                                                                              │
│  Duration:      Duration:        Duration:       Duration:        Final    │
│  Indefinite     30 days*         90 days*        7 years*                   │
│                 (policy-based)   (policy-based)  (policy-based)             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Stage Definitions

| Stage | Status | Access | Storage | Reversible |
|-------|--------|--------|---------|------------|
| **Active** | `active` | Full CRUD | Hot (Primary DB) | N/A |
| **Soft Deleted** | `deleted` | Read-only (admin) | Hot (Primary DB) | Yes |
| **Archived** | `archived` | Read-only (export) | Warm (Archive DB) | Limited |
| **Cold Storage** | `cold` | Compliance only | Cold (S3 Glacier) | No |
| **Purged** | N/A | None | None | No |

### Stage Transitions

```typescript
interface DataLifecycleTransition {
  fromStage: DataStage;
  toStage: DataStage;
  trigger: TransitionTrigger;
  delay: Duration;
  reversible: boolean;
  requiresApproval: boolean;
  notifyUser: boolean;
}

enum DataStage {
  ACTIVE = 'active',
  SOFT_DELETED = 'deleted',
  ARCHIVED = 'archived',
  COLD_STORAGE = 'cold',
  PURGED = 'purged'
}

enum TransitionTrigger {
  USER_REQUEST = 'user_request',
  ADMIN_REQUEST = 'admin_request',
  SCHEDULED = 'scheduled',
  POLICY_ENFORCEMENT = 'policy_enforcement',
  RETENTION_EXPIRY = 'retention_expiry'
}
```

---

## Policy-Based Processing

### Tenant Data Protection Settings

Each tenant selects their compliance requirements during onboarding:

```typescript
interface TenantDataProtectionPolicy {
  tenantId: string;

  // Selected compliance frameworks
  frameworks: ComplianceFramework[];

  // Deletion settings
  deletion: {
    gracePeriodDays: number;        // 30-90 days
    requireMfaConfirmation: boolean;
    requireOwnerApproval: boolean;
    notifyUsers: boolean;
    notifyDaysBeforePurge: number[];  // e.g., [7, 3, 1]
  };

  // Archive settings
  archive: {
    retentionDays: number;          // 90-365 days
    compressionEnabled: boolean;
    encryptionKeyId: string;
  };

  // Cold storage settings
  coldStorage: {
    retentionYears: number;         // 1-10 years
    storageClass: 'GLACIER' | 'DEEP_ARCHIVE';
    region: string;
  };

  // Data categories with custom retention
  categoryOverrides: {
    [category: string]: {
      retentionDays?: number;
      skipArchive?: boolean;
      skipColdStorage?: boolean;
    };
  };
}

enum ComplianceFramework {
  GDPR = 'gdpr',
  CCPA = 'ccpa',
  CPRA = 'cpra',
  HIPAA = 'hipaa',
  SOC2 = 'soc2',
  PCI_DSS = 'pci_dss',
  ISO_27001 = 'iso_27001',
  CUSTOM = 'custom'
}
```

### Policy Resolution

```typescript
function resolveRetentionPolicy(
  tenant: Tenant,
  dataCategory: string
): RetentionPolicy {
  const policy = tenant.dataProtectionPolicy;

  // Check category-specific override
  if (policy.categoryOverrides[dataCategory]) {
    return policy.categoryOverrides[dataCategory];
  }

  // Apply most restrictive framework requirement
  const frameworks = policy.frameworks;

  if (frameworks.includes('HIPAA')) {
    return HIPAA_RETENTION_POLICY;
  }
  if (frameworks.includes('SOC2')) {
    return SOC2_RETENTION_POLICY;
  }
  if (frameworks.includes('GDPR')) {
    return GDPR_RETENTION_POLICY;
  }

  return DEFAULT_RETENTION_POLICY;
}
```

---

## Job Definitions

### Job Registry

| Job ID | Name | Trigger | Frequency | Batch Size |
|--------|------|---------|-----------|------------|
| `tenant.soft_delete` | Tenant Soft Deletion | User Request | On-demand | 1 |
| `tenant.archive` | Tenant Archival | Scheduled | Daily | 10 |
| `tenant.cold_migrate` | Tenant Cold Migration | Scheduled | Weekly | 5 |
| `tenant.purge` | Tenant Purge | Scheduled | Monthly | 5 |
| `user.soft_delete` | User Soft Deletion | User Request | On-demand | 1 |
| `user.archive` | User Archival | Scheduled | Daily | 100 |
| `data.export` | Data Export | User Request | On-demand | 1 |
| `audit.archive` | Audit Log Archival | Scheduled | Daily | 10000 |
| `workflow.cleanup` | Workflow Execution Cleanup | Scheduled | Daily | 1000 |
| `server.cleanup` | Orphaned Server Cleanup | Scheduled | Daily | 50 |
| `secret.rotation` | Secret Rotation | Scheduled | Configurable | 100 |
| `notification.cleanup` | Notification Cleanup | Scheduled | Daily | 5000 |

### Job Definition Schema

```typescript
interface BackgroundJob {
  id: string;
  name: string;
  description: string;

  // Trigger configuration
  trigger: {
    type: 'scheduled' | 'event' | 'manual';
    schedule?: string;            // Cron expression
    event?: string;               // Event name
  };

  // Processing configuration
  processing: {
    batchSize: number;
    maxRetries: number;
    retryDelayMs: number;
    timeoutMs: number;
    concurrency: number;
  };

  // Dependencies
  dependencies: {
    requiredJobs?: string[];      // Must complete first
    blockedByJobs?: string[];     // Cannot run while these run
  };

  // Policy integration
  policy: {
    respectsTenantPolicy: boolean;
    requiresApproval: boolean;
    auditLogged: boolean;
  };

  // Steps
  steps: JobStep[];
}

interface JobStep {
  id: string;
  name: string;
  action: string;
  order: number;
  required: boolean;
  rollbackAction?: string;
  onFailure: 'stop' | 'continue' | 'retry';
}
```

---

## Tenant Deletion Process

### Overview

Tenant deletion is a multi-stage process that respects data protection policies and ensures proper archival before any data removal.

### Deletion Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TENANT DELETION WORKFLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐                                                            │
│  │ Owner Request│──┐                                                         │
│  │   Deletion   │  │                                                         │
│  └──────────────┘  │                                                         │
│                    ▼                                                         │
│           ┌───────────────┐                                                  │
│           │ Verify Owner  │                                                  │
│           │ + MFA Check   │                                                  │
│           └───────┬───────┘                                                  │
│                   │                                                          │
│                   ▼                                                          │
│           ┌───────────────┐     ┌──────────────┐                            │
│           │ Create Delete │────▶│ Notify Users │                            │
│           │    Request    │     │ + Admins     │                            │
│           └───────┬───────┘     └──────────────┘                            │
│                   │                                                          │
│                   ▼                                                          │
│           ┌───────────────┐                                                  │
│           │  Soft Delete  │◀── Immediate                                     │
│           │    Tenant     │                                                  │
│           └───────┬───────┘                                                  │
│                   │                                                          │
│                   │  Grace Period (30 days)                                  │
│                   │  [Can be restored during this period]                    │
│                   ▼                                                          │
│           ┌───────────────┐                                                  │
│           │ Create Cold   │                                                  │
│           │   Archive     │                                                  │
│           └───────┬───────┘                                                  │
│                   │                                                          │
│                   ▼                                                          │
│   ┌───────────────────────────────────────────────────────┐                 │
│   │              INCREMENTAL DATA PROCESSING               │                 │
│   ├───────────────────────────────────────────────────────┤                 │
│   │  Step 1: Archive & Delete Workflow Executions (batch) │                 │
│   │  Step 2: Archive & Delete Workflows (batch)           │                 │
│   │  Step 3: Archive & Delete Secrets (encrypted)         │                 │
│   │  Step 4: Cleanup Cloud Resources (async)              │                 │
│   │  Step 5: Archive & Delete Users (batch)               │                 │
│   │  Step 6: Archive & Delete Audit Logs (batch)          │                 │
│   │  Step 7: Archive & Delete Tenant Config               │                 │
│   │  Step 8: Mark Tenant as Archived                      │                 │
│   └───────────────────────────────────────────────────────┘                 │
│                   │                                                          │
│                   │  Retention Period (7 years)                              │
│                   ▼                                                          │
│           ┌───────────────┐                                                  │
│           │  Final Purge  │◀── After compliance period                       │
│           │   (Optional)  │                                                  │
│           └───────────────┘                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tenant Deletion Job Definition

```typescript
const tenantDeletionJob: BackgroundJob = {
  id: 'tenant.soft_delete',
  name: 'Tenant Soft Deletion',
  description: 'Initiates tenant deletion with soft delete and archival',

  trigger: {
    type: 'event',
    event: 'tenant.deletion.requested'
  },

  processing: {
    batchSize: 1,
    maxRetries: 3,
    retryDelayMs: 60000,
    timeoutMs: 3600000,  // 1 hour max
    concurrency: 1
  },

  dependencies: {
    blockedByJobs: ['tenant.restore']
  },

  policy: {
    respectsTenantPolicy: true,
    requiresApproval: true,  // Owner + MFA
    auditLogged: true
  },

  steps: [
    {
      id: 'verify_owner',
      name: 'Verify Owner Authorization',
      action: 'tenant.deletion.verify_owner',
      order: 1,
      required: true,
      onFailure: 'stop'
    },
    {
      id: 'notify_stakeholders',
      name: 'Notify Users and Admins',
      action: 'tenant.deletion.notify',
      order: 2,
      required: true,
      onFailure: 'continue'
    },
    {
      id: 'soft_delete',
      name: 'Soft Delete Tenant',
      action: 'tenant.deletion.soft_delete',
      order: 3,
      required: true,
      rollbackAction: 'tenant.deletion.restore',
      onFailure: 'stop'
    },
    {
      id: 'revoke_access',
      name: 'Revoke All User Access',
      action: 'tenant.deletion.revoke_access',
      order: 4,
      required: true,
      onFailure: 'stop'
    },
    {
      id: 'schedule_archive',
      name: 'Schedule Archive Job',
      action: 'tenant.deletion.schedule_archive',
      order: 5,
      required: true,
      onFailure: 'continue'
    }
  ]
};
```

### Tenant Archive Job Definition

```typescript
const tenantArchiveJob: BackgroundJob = {
  id: 'tenant.archive',
  name: 'Tenant Archival',
  description: 'Archives soft-deleted tenant data after grace period',

  trigger: {
    type: 'scheduled',
    schedule: '0 2 * * *'  // Daily at 2 AM
  },

  processing: {
    batchSize: 10,
    maxRetries: 5,
    retryDelayMs: 300000,
    timeoutMs: 14400000,  // 4 hours max
    concurrency: 2
  },

  policy: {
    respectsTenantPolicy: true,
    requiresApproval: false,
    auditLogged: true
  },

  steps: [
    {
      id: 'find_eligible',
      name: 'Find Tenants Past Grace Period',
      action: 'tenant.archive.find_eligible',
      order: 1,
      required: true,
      onFailure: 'stop'
    },
    {
      id: 'create_archive_manifest',
      name: 'Create Archive Manifest',
      action: 'tenant.archive.create_manifest',
      order: 2,
      required: true,
      onFailure: 'stop'
    },
    {
      id: 'archive_workflows',
      name: 'Archive Workflow Data',
      action: 'tenant.archive.workflows',
      order: 3,
      required: true,
      onFailure: 'retry'
    },
    {
      id: 'archive_executions',
      name: 'Archive Execution History',
      action: 'tenant.archive.executions',
      order: 4,
      required: true,
      onFailure: 'retry'
    },
    {
      id: 'archive_secrets',
      name: 'Archive Encrypted Secrets',
      action: 'tenant.archive.secrets',
      order: 5,
      required: true,
      onFailure: 'stop'
    },
    {
      id: 'cleanup_cloud_resources',
      name: 'Cleanup Cloud Resources',
      action: 'tenant.archive.cleanup_cloud',
      order: 6,
      required: true,
      onFailure: 'retry'
    },
    {
      id: 'archive_users',
      name: 'Archive User Data',
      action: 'tenant.archive.users',
      order: 7,
      required: true,
      onFailure: 'retry'
    },
    {
      id: 'archive_audit_logs',
      name: 'Archive Audit Logs',
      action: 'tenant.archive.audit_logs',
      order: 8,
      required: true,
      onFailure: 'retry'
    },
    {
      id: 'generate_archive_package',
      name: 'Generate Encrypted Archive Package',
      action: 'tenant.archive.package',
      order: 9,
      required: true,
      onFailure: 'stop'
    },
    {
      id: 'upload_to_cold_storage',
      name: 'Upload to Cold Storage',
      action: 'tenant.archive.upload_cold',
      order: 10,
      required: true,
      onFailure: 'retry'
    },
    {
      id: 'delete_hot_data',
      name: 'Delete Data from Primary Database',
      action: 'tenant.archive.delete_hot',
      order: 11,
      required: true,
      onFailure: 'stop'
    },
    {
      id: 'update_tenant_status',
      name: 'Mark Tenant as Archived',
      action: 'tenant.archive.update_status',
      order: 12,
      required: true,
      onFailure: 'stop'
    }
  ]
};
```

### Resource Cleanup Order

To respect foreign key constraints and dependencies:

```
┌─────────────────────────────────────────────────────────────────┐
│                 DELETION ORDER (Dependencies)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Level 1 (Leaf nodes - no dependents):                          │
│    ├── workflow_execution_logs                                   │
│    ├── node_executions                                           │
│    ├── notification_log                                          │
│    └── api_request_log                                           │
│                                                                  │
│  Level 2:                                                        │
│    ├── workflow_executions                                       │
│    ├── webhook_deliveries                                        │
│    └── audit_logs (archive, don't delete)                        │
│                                                                  │
│  Level 3:                                                        │
│    ├── workflows                                                 │
│    ├── workflow_templates                                        │
│    └── webhooks                                                  │
│                                                                  │
│  Level 4:                                                        │
│    ├── servers (+ cloud provider cleanup)                        │
│    ├── volumes                                                   │
│    ├── networks                                                  │
│    └── firewalls                                                 │
│                                                                  │
│  Level 5:                                                        │
│    ├── secrets                                                   │
│    ├── environment_variables                                     │
│    └── api_keys                                                  │
│                                                                  │
│  Level 6:                                                        │
│    ├── user_roles                                                │
│    ├── user_permissions                                          │
│    └── user_sessions                                             │
│                                                                  │
│  Level 7:                                                        │
│    ├── users                                                     │
│    └── invitations                                               │
│                                                                  │
│  Level 8:                                                        │
│    ├── roles (custom only)                                       │
│    └── tenant_settings                                           │
│                                                                  │
│  Level 9 (Root):                                                 │
│    └── tenant (mark as archived)                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## User Deletion Process

### User Deletion Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER DELETION WORKFLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [User Request] ──▶ [MFA Verify] ──▶ [Soft Delete]              │
│                                            │                     │
│                                            ▼                     │
│                                    [Grace Period: 30 days]       │
│                                    [User can restore via email]  │
│                                            │                     │
│                                            ▼                     │
│                                    [Archive User Data]           │
│                                    - Profile                     │
│                                    - Activity history            │
│                                    - Created resources           │
│                                            │                     │
│                                            ▼                     │
│                                    [Anonymize References]        │
│                                    - Audit logs → "Deleted User" │
│                                    - Created_by → NULL           │
│                                            │                     │
│                                            ▼                     │
│                                    [Cold Storage Archive]        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### User Deletion Job

```typescript
const userDeletionJob: BackgroundJob = {
  id: 'user.soft_delete',
  name: 'User Soft Deletion',
  description: 'Soft deletes user with grace period',

  trigger: {
    type: 'event',
    event: 'user.deletion.requested'
  },

  processing: {
    batchSize: 1,
    maxRetries: 3,
    retryDelayMs: 30000,
    timeoutMs: 300000,
    concurrency: 5
  },

  policy: {
    respectsTenantPolicy: true,
    requiresApproval: true,  // Self + MFA
    auditLogged: true
  },

  steps: [
    {
      id: 'verify_user',
      name: 'Verify User Identity',
      action: 'user.deletion.verify',
      order: 1,
      required: true,
      onFailure: 'stop'
    },
    {
      id: 'check_constraints',
      name: 'Check Deletion Constraints',
      action: 'user.deletion.check_constraints',
      order: 2,
      required: true,
      onFailure: 'stop'
      // Fails if: user is tenant owner, has pending approvals, etc.
    },
    {
      id: 'soft_delete',
      name: 'Soft Delete User',
      action: 'user.deletion.soft_delete',
      order: 3,
      required: true,
      rollbackAction: 'user.deletion.restore',
      onFailure: 'stop'
    },
    {
      id: 'revoke_sessions',
      name: 'Revoke All Sessions',
      action: 'user.deletion.revoke_sessions',
      order: 4,
      required: true,
      onFailure: 'continue'
    },
    {
      id: 'send_confirmation',
      name: 'Send Deletion Confirmation',
      action: 'user.deletion.send_confirmation',
      order: 5,
      required: false,
      onFailure: 'continue'
    }
  ]
};
```

---

## Data Archival

### Archive Package Structure

```
tenant_archive_{tenant_id}_{timestamp}/
├── manifest.json                 # Archive metadata
├── encryption_metadata.json      # Key references (not keys)
├── tenant/
│   ├── config.json.enc          # Encrypted tenant config
│   └── settings.json.enc
├── users/
│   ├── users.json.enc           # Encrypted user data
│   └── roles.json.enc
├── workflows/
│   ├── definitions/
│   │   └── *.json.enc
│   └── executions/
│       └── *.json.enc
├── infrastructure/
│   ├── servers.json.enc
│   ├── volumes.json.enc
│   └── networks.json.enc
├── secrets/
│   └── secrets.json.enc         # Double-encrypted
├── audit_logs/
│   └── audit_log_*.json.enc     # Compressed + encrypted
└── checksum.sha256              # Integrity verification
```

### Archive Manifest

```typescript
interface ArchiveManifest {
  archiveId: string;
  tenantId: string;
  tenantName: string;

  // Archive metadata
  createdAt: string;
  createdBy: string;
  reason: 'deletion' | 'compliance' | 'migration';

  // Policy reference
  policy: {
    framework: ComplianceFramework;
    retentionYears: number;
    purgeAfter: string;
  };

  // Contents summary
  contents: {
    users: { count: number; sizeBytes: number };
    workflows: { count: number; sizeBytes: number };
    executions: { count: number; sizeBytes: number };
    servers: { count: number; sizeBytes: number };
    secrets: { count: number; sizeBytes: number };
    auditLogs: { count: number; sizeBytes: number };
  };

  // Encryption
  encryption: {
    algorithm: 'AES-256-GCM';
    keyId: string;
    keyVersion: number;
  };

  // Integrity
  checksum: {
    algorithm: 'SHA-256';
    value: string;
  };

  // Recovery
  recovery: {
    possibleUntil: string;
    contactEmail: string;
    supportTicketUrl: string;
  };
}
```

---

## Cold Storage

### Cold Storage Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      COLD STORAGE TIERS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐   │
│  │   S3 GLACIER   │   │  S3 DEEP       │   │   COMPLIANCE   │   │
│  │   INSTANT      │   │  ARCHIVE       │   │   VAULT        │   │
│  ├────────────────┤   ├────────────────┤   ├────────────────┤   │
│  │ Retrieval: Min │   │ Retrieval: 12h │   │ Retrieval: 48h │   │
│  │ Cost: Medium   │   │ Cost: Low      │   │ Cost: Lowest   │   │
│  │ Use: Recent    │   │ Use: Older     │   │ Use: Legal     │   │
│  │ (0-1 year)     │   │ (1-3 years)    │   │ (3+ years)     │   │
│  └────────────────┘   └────────────────┘   └────────────────┘   │
│                                                                  │
│  Auto-tiering based on archive age:                              │
│  • 0-12 months:  Glacier Instant Retrieval                       │
│  • 1-3 years:    Glacier Deep Archive                            │
│  • 3+ years:     Compliance Vault (WORM)                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Cold Storage Configuration

```typescript
interface ColdStorageConfig {
  provider: 'aws' | 'gcp' | 'azure';

  // AWS S3 configuration
  aws?: {
    bucket: string;
    region: string;
    storageClass: 'GLACIER_IR' | 'DEEP_ARCHIVE';
    objectLockEnabled: boolean;  // WORM compliance
    objectLockRetention: {
      mode: 'GOVERNANCE' | 'COMPLIANCE';
      years: number;
    };
  };

  // Encryption
  encryption: {
    type: 'SSE-S3' | 'SSE-KMS' | 'SSE-C';
    kmsKeyId?: string;
  };

  // Lifecycle rules
  lifecycle: {
    transitionToDeepArchive: { days: 365 };
    expiration: { years: 10 };  // Must exceed max retention
  };

  // Access logging
  accessLogging: {
    enabled: boolean;
    bucket: string;
    prefix: string;
  };
}
```

### Archive Retrieval Process

For compliance/legal requests:

```typescript
interface ArchiveRetrievalRequest {
  requestId: string;
  archiveId: string;
  tenantId: string;

  // Request details
  requestedBy: string;
  reason: 'legal_hold' | 'compliance_audit' | 'data_subject_request';
  legalReference?: string;

  // Authorization
  approvedBy: string[];  // Requires 2 approvals
  approvalTimestamp: string;

  // Retrieval options
  tier: 'expedited' | 'standard' | 'bulk';
  notifyEmail: string;
  expiresAt: string;  // Retrieved data access window
}
```

---

## Job Queue Architecture

### Queue System

```
┌─────────────────────────────────────────────────────────────────┐
│                      JOB QUEUE ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Producer   │───▶│  Job Queue   │───▶│   Consumer   │       │
│  │  (API/Event) │    │   (Redis)    │    │  (Workers)   │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│                             │                    │               │
│                             ▼                    ▼               │
│                      ┌──────────────┐    ┌──────────────┐       │
│                      │ Dead Letter  │    │   Results    │       │
│                      │    Queue     │    │    Store     │       │
│                      └──────────────┘    └──────────────┘       │
│                                                                  │
│  Queues:                                                         │
│  • high_priority   (tenant deletion, security)                   │
│  • default         (archival, cleanup)                           │
│  • low_priority    (analytics, reports)                          │
│  • scheduled       (cron jobs)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Job Status Tracking

```typescript
interface JobExecution {
  id: string;
  jobId: string;

  // Context
  tenantId?: string;
  userId?: string;
  resourceId?: string;
  resourceType?: string;

  // Status
  status: JobStatus;
  progress: {
    current: number;
    total: number;
    percentage: number;
    currentStep: string;
  };

  // Timing
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedCompletion?: string;

  // Results
  result?: any;
  error?: {
    code: string;
    message: string;
    step: string;
    retryable: boolean;
  };

  // Retry tracking
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string;

  // Audit
  logs: JobLog[];
}

enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying',
  PAUSED = 'paused'
}

interface JobLog {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  step: string;
  message: string;
  data?: Record<string, any>;
}
```

---

## Monitoring & Observability

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `jobs_queued_total` | Counter | Total jobs added to queue |
| `jobs_completed_total` | Counter | Successfully completed jobs |
| `jobs_failed_total` | Counter | Failed jobs |
| `jobs_retried_total` | Counter | Retried jobs |
| `job_duration_seconds` | Histogram | Job execution duration |
| `job_queue_depth` | Gauge | Current queue depth |
| `archive_size_bytes` | Gauge | Total archived data size |
| `cold_storage_size_bytes` | Gauge | Cold storage usage |

### Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| Job Queue Backup | Queue depth > 1000 for 15min | Warning |
| High Job Failure Rate | Failure rate > 10% | Warning |
| Critical Job Failed | Tenant deletion failed | Critical |
| Archive Job Stalled | No progress for 1 hour | Warning |
| Cold Storage Upload Failed | Upload retry exhausted | Critical |

### Dashboard Queries

```sql
-- Jobs by status (last 24 hours)
SELECT
  job_id,
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration
FROM job_executions
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY job_id, status;

-- Pending tenant deletions
SELECT
  t.id,
  t.name,
  dr.created_at as deletion_requested,
  dr.grace_period_ends
FROM deletion_requests dr
JOIN tenants t ON t.id = dr.resource_id
WHERE dr.resource_type = 'tenant'
  AND dr.status = 'pending';
```

---

## Database Schema

### job_definitions Table

```sql
CREATE TABLE job_definitions (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Configuration (JSONB)
  trigger_config JSONB NOT NULL,
  processing_config JSONB NOT NULL,
  dependencies JSONB,
  policy JSONB NOT NULL,
  steps JSONB NOT NULL,

  -- Status
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### job_executions Table

```sql
CREATE TABLE job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(100) NOT NULL REFERENCES job_definitions(id),

  -- Context
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  resource_id UUID,
  resource_type VARCHAR(50),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  progress JSONB NOT NULL DEFAULT '{}',

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  result JSONB,
  error JSONB,

  -- Retry
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_retry_at TIMESTAMPTZ,

  -- Logs
  logs JSONB NOT NULL DEFAULT '[]',

  CONSTRAINT valid_status CHECK (status IN (
    'pending', 'running', 'completed', 'failed', 'cancelled', 'retrying', 'paused'
  ))
);

CREATE INDEX idx_job_executions_status ON job_executions(status, created_at);
CREATE INDEX idx_job_executions_tenant ON job_executions(tenant_id);
CREATE INDEX idx_job_executions_resource ON job_executions(resource_type, resource_id);
```

### deletion_requests Table

```sql
CREATE TABLE deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  -- Target
  resource_type VARCHAR(50) NOT NULL,  -- 'tenant', 'user'
  resource_id UUID NOT NULL,

  -- Request details
  requested_by UUID NOT NULL REFERENCES users(id),
  reason TEXT,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- pending, grace_period, archiving, archived, cancelled, restored

  -- Policy
  policy_framework VARCHAR(20) NOT NULL,
  grace_period_days INTEGER NOT NULL,
  grace_period_ends TIMESTAMPTZ NOT NULL,

  -- Archive reference
  archive_id UUID REFERENCES tenant_archives(id),

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,

  CONSTRAINT valid_resource_type CHECK (resource_type IN ('tenant', 'user'))
);
```

### tenant_archives Table

```sql
CREATE TABLE tenant_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,  -- No FK - tenant may be deleted
  tenant_name VARCHAR(255) NOT NULL,

  -- Archive details
  manifest JSONB NOT NULL,
  storage_location TEXT NOT NULL,
  storage_class VARCHAR(50) NOT NULL,
  size_bytes BIGINT NOT NULL,

  -- Encryption
  encryption_key_id UUID NOT NULL,
  encryption_algorithm VARCHAR(20) NOT NULL,

  -- Integrity
  checksum VARCHAR(64) NOT NULL,
  checksum_algorithm VARCHAR(20) NOT NULL,

  -- Policy
  policy_framework VARCHAR(20) NOT NULL,
  retention_until TIMESTAMPTZ NOT NULL,
  purge_after TIMESTAMPTZ NOT NULL,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- active, retrieved, purged

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  last_accessed_at TIMESTAMPTZ,
  purged_at TIMESTAMPTZ
);

CREATE INDEX idx_tenant_archives_retention ON tenant_archives(retention_until)
  WHERE status = 'active';
```

---

## API Endpoints

### Deletion Requests

```
POST   /api/v1/deletion-requests
GET    /api/v1/deletion-requests
GET    /api/v1/deletion-requests/{id}
POST   /api/v1/deletion-requests/{id}/cancel
POST   /api/v1/deletion-requests/{id}/restore
```

### Job Management

```
GET    /api/v1/jobs
GET    /api/v1/jobs/{id}
GET    /api/v1/jobs/{id}/executions
GET    /api/v1/job-executions/{id}
GET    /api/v1/job-executions/{id}/logs
POST   /api/v1/job-executions/{id}/cancel
POST   /api/v1/job-executions/{id}/retry
```

### Archives (Admin Only)

```
GET    /api/v1/admin/archives
GET    /api/v1/admin/archives/{id}
POST   /api/v1/admin/archives/{id}/retrieve
GET    /api/v1/admin/archives/{id}/download
```

---

## Changelog

### v1.0.0 (January 26, 2026)
- Initial background jobs specification
- Policy-based data lifecycle management
- Tenant and user deletion workflows
- Cold storage archival process
- Job queue architecture
- Monitoring and observability
