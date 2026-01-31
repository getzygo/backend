# Zygo Data Protection & Compliance

**Version:** 2.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready
**Compliance:** GDPR, CCPA, CPRA, APPI

This document defines the data protection requirements and compliance implementation for the Zygo platform.

---

## Table of Contents

1. [Overview](#overview)
2. [Regulatory Framework](#regulatory-framework)
3. [Data Subject Rights](#data-subject-rights)
4. [Consent Management](#consent-management)
5. [Data Export (Portability)](#data-export-portability)
6. [Data Deletion (Erasure)](#data-deletion-erasure)
7. [Data Correction (Rectification)](#data-correction-rectification)
8. [Privacy Settings](#privacy-settings)
9. [Audit Logging](#audit-logging)
10. [API Endpoints](#api-endpoints)
11. [UI Components](#ui-components)
12. [Implementation Checklist](#implementation-checklist)

---

## Overview

### Compliance Scope

| Regulation | Jurisdiction | Key Requirements |
|------------|--------------|------------------|
| GDPR | European Union | Consent, Rights, DPO, 72h breach notification |
| CCPA | California, USA | Opt-out, Do Not Sell, Disclosure |
| CPRA | California, USA | Sensitive data, Corrections, Sharing |
| APPI | Japan | Consent, Cross-border transfer |

### Data Classification

| Category | Examples | Sensitivity | Retention |
|----------|----------|-------------|-----------|
| Account Data | Email, name, avatar | Medium | Until deletion |
| Authentication | Passwords, MFA secrets | Critical | Until deletion |
| Activity Data | Logins, actions, usage | Low | 90 days |
| Payment Data | Card details, invoices | High | 7 years (tax) |
| Infrastructure Data | Servers, configs | Medium | Until deletion |
| Audit Logs | All logged events | Medium | 7 years |

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Data Subject                          │
│                   (User / Customer)                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐
   │  Consent   │  │   Rights   │  │  Privacy   │
   │  Banner    │  │  Portal    │  │  Settings  │
   └────────────┘  └────────────┘  └────────────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
                          ▼
              ┌────────────────────┐
              │    Zygo Backend    │
              │  (Data Processor)  │
              └─────────┬──────────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
          ▼             ▼             ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │  Database  │ │  Storage   │ │  3rd Party │
   │ (Primary)  │ │   (S3)     │ │ (Stripe)   │
   └────────────┘ └────────────┘ └────────────┘
```

---

## Regulatory Framework

### GDPR Requirements

| Requirement | Article | Implementation |
|-------------|---------|----------------|
| Lawful Basis | Art. 6 | Consent tracking, legitimate interest documentation |
| Consent | Art. 7 | Explicit opt-in, granular choices, easy withdrawal |
| Right to Access | Art. 15 | Data export within 30 days |
| Right to Rectification | Art. 16 | Self-service corrections, admin review |
| Right to Erasure | Art. 17 | 30-day grace period, complete deletion |
| Right to Portability | Art. 20 | Machine-readable export (JSON/CSV) |
| Data Protection Officer | Art. 37 | Contact: dpo@zygo.tech |
| Breach Notification | Art. 33 | 72-hour notification process |

### CCPA/CPRA Requirements

| Requirement | Section | Implementation |
|-------------|---------|----------------|
| Right to Know | 1798.100 | Privacy disclosures, categories |
| Right to Delete | 1798.105 | Deletion request handling |
| Right to Opt-Out | 1798.120 | "Do Not Sell My Info" |
| Right to Non-Discrimination | 1798.125 | Equal service regardless of rights |
| Right to Correct | 1798.106 (CPRA) | Inaccurate data correction |
| Right to Limit | 1798.121 (CPRA) | Sensitive data usage limits |

### APPI Requirements

| Requirement | Implementation |
|-------------|----------------|
| Purpose Specification | Clear purpose statements |
| Consent for Sensitive | Explicit consent for sensitive data |
| Cross-Border Transfer | Documented transfer mechanisms |
| Access Rights | Export functionality |

---

## Data Subject Rights

### Rights Matrix

| Right | GDPR | CCPA | CPRA | APPI | Implementation |
|-------|------|------|------|------|----------------|
| Access | ✅ | ✅ | ✅ | ✅ | Export portal |
| Rectification | ✅ | ❌ | ✅ | ❌ | Correction requests |
| Erasure | ✅ | ✅ | ✅ | ❌ | Deletion workflow |
| Portability | ✅ | ❌ | ❌ | ❌ | JSON/CSV export |
| Object to Processing | ✅ | ❌ | ❌ | ❌ | Consent withdrawal |
| Opt-Out of Sale | ❌ | ✅ | ✅ | ❌ | Privacy settings |
| Limit Sensitive | ❌ | ❌ | ✅ | ✅ | Privacy settings |

### Request Handling SLAs

| Request Type | Acknowledgment | Completion | Extension |
|--------------|----------------|------------|-----------|
| Access/Export | 24 hours | 30 days | +30 days if complex |
| Deletion | 24 hours | 30 days | N/A |
| Correction | 24 hours | 14 days | N/A |
| Opt-Out | Immediate | Immediate | N/A |

---

## Consent Management

### Consent Types

```typescript
enum ConsentType {
  TERMS_OF_SERVICE = 'terms_of_service',
  PRIVACY_POLICY = 'privacy_policy',
  MARKETING_EMAILS = 'marketing_emails',
  ANALYTICS = 'analytics',
  THIRD_PARTY_SHARING = 'third_party_sharing',
  COOKIES_ESSENTIAL = 'cookies_essential',
  COOKIES_ANALYTICS = 'cookies_analytics',
  COOKIES_MARKETING = 'cookies_marketing',
}
```

### Consent Record Schema

```typescript
interface ConsentRecord {
  id: string;
  userId: string;
  tenantId: string;
  consentType: ConsentType;
  granted: boolean;
  version: string;           // Policy version consented to
  grantedAt?: Date;
  withdrawnAt?: Date;
  expiresAt?: Date;
  collectionContext: {
    ipAddress: string;
    userAgent: string;
    method: 'explicit' | 'implicit' | 'checkbox';
  };
}
```

### Consent Collection Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Banner    │────▶│   Modal     │────▶│   Record    │
│   Display   │     │   Choices   │     │   Storage   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │    User clicks    │   User submits    │
       │    "Manage"       │   preferences     │
       ▼                   ▼                   ▼
  Show banner        Show granular       Store consent
  on first visit     toggle options      with metadata
```

### Consent API

```typescript
// POST /api/v1/compliance/consent
interface ConsentRequest {
  consents: {
    type: ConsentType;
    granted: boolean;
  }[];
}

// Response
interface ConsentResponse {
  success: boolean;
  consents: ConsentRecord[];
}
```

---

## Data Export (Portability)

### Exportable Data Categories

| Category | Included | Format |
|----------|----------|--------|
| Profile | Name, email, avatar | JSON |
| Preferences | Theme, notifications | JSON |
| Activity | Login history, actions | CSV |
| Infrastructure | Servers, volumes | JSON |
| Workflows | Workflow definitions | JSON |
| Audit Logs | User-related logs | JSON |

### Export Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. User requests export via Privacy Portal                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  2. System sends verification email                         │
│     (prevents unauthorized exports)                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  3. User clicks verification link                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Background job collects data from all sources           │
│     - Database tables                                       │
│     - File storage                                          │
│     - Audit logs                                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Generate encrypted archive (ZIP)                        │
│     - JSON files per category                               │
│     - CSV for tabular data                                  │
│     - README with schema                                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  6. Upload to secure storage, generate download link        │
│     (expires in 7 days, max 3 downloads)                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  7. Notify user via email with download link                │
└─────────────────────────────────────────────────────────────┘
```

### Export File Structure

```
user_export_2026-01-26.zip
├── README.txt                    # Export metadata and instructions
├── profile.json                  # User profile data
├── preferences.json              # User preferences
├── activity/
│   ├── logins.csv               # Login history
│   └── actions.csv              # User actions
├── infrastructure/
│   ├── servers.json             # Server configurations
│   └── volumes.json             # Volume data
├── workflows/
│   └── workflows.json           # Workflow definitions
└── audit/
    └── audit_logs.json          # Related audit entries
```

### Export API

```typescript
// POST /api/v1/compliance/export/request
interface ExportRequest {
  format: 'json' | 'csv';
  categories?: string[];         // Optional filter
}

// Response
interface ExportRequestResponse {
  requestId: string;
  status: 'pending';
  verificationRequired: true;
  estimatedCompletionTime: string;
}

// GET /api/v1/compliance/export/{requestId}
interface ExportStatus {
  requestId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';
  downloadUrl?: string;
  expiresAt?: string;
  downloadCount?: number;
  maxDownloads: number;
}
```

---

## Data Deletion (Erasure)

### Deletion Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  1. User requests deletion via Privacy Portal               │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  2. System sends verification email                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  3. User verifies → Request enters PENDING state            │
│     - Grace period starts (30 days)                         │
│     - User can cancel within 14 days                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Admin reviews (optional for high-value accounts)        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Grace period expires → PROCESSING state                 │
│     - Account deactivated                                   │
│     - Data anonymization begins                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  6. Data deletion executed                                  │
│     - Profile data deleted                                  │
│     - Files removed from storage                            │
│     - Audit logs anonymized (not deleted)                   │
│     - Third parties notified                                │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  7. Confirmation email sent → COMPLETED state               │
└─────────────────────────────────────────────────────────────┘
```

### Data Retention Exceptions

| Data Type | Retention Reason | Duration |
|-----------|------------------|----------|
| Invoices | Tax/legal requirements | 7 years |
| Audit logs | Compliance requirements | 7 years (anonymized) |
| Support tickets | Legal disputes | 3 years |
| Consent records | Proof of consent | 7 years |

### Deletion API

```typescript
// POST /api/v1/compliance/deletion/request
interface DeletionRequest {
  type: 'full' | 'partial';
  categories?: string[];         // For partial deletion
  reason?: string;
}

// Response
interface DeletionRequestResponse {
  requestId: string;
  status: 'pending';
  verificationRequired: true;
  gracePeriodEnds: string;       // ISO date
  canCancelUntil: string;        // ISO date
}

// DELETE /api/v1/compliance/deletion/{requestId}
// Cancels pending deletion request
```

---

## Data Correction (Rectification)

### Correctable Fields

| Field | Self-Service | Admin Review |
|-------|--------------|--------------|
| Display Name | ✅ | ❌ |
| Avatar | ✅ | ❌ |
| Timezone | ✅ | ❌ |
| Email | ❌ | ✅ |
| Company Name | ❌ | ✅ |
| Billing Address | ❌ | ✅ |

### Correction Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. User submits correction request                         │
│     - Field name                                            │
│     - Current value                                         │
│     - Requested value                                       │
│     - Reason (optional)                                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ▼                               ▼
┌─────────────────────┐       ┌─────────────────────┐
│   Self-Service      │       │   Admin Review      │
│   (Immediate)       │       │   (24-48 hours)     │
└─────────────────────┘       └─────────────────────┘
          │                               │
          └───────────────┬───────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Update applied, audit log created                          │
└─────────────────────────────────────────────────────────────┘
```

### Correction API

```typescript
// POST /api/v1/compliance/correction/request
interface CorrectionRequest {
  fieldName: string;
  currentValue: string;
  requestedValue: string;
  reason?: string;
}

// Response
interface CorrectionRequestResponse {
  requestId: string;
  status: 'pending' | 'approved' | 'rejected';
  requiresReview: boolean;
  estimatedCompletion?: string;
}
```

---

## Privacy Settings

### CCPA/CPRA Settings

```typescript
interface PrivacySettings {
  // CCPA: Right to Opt-Out of Sale
  doNotSell: boolean;

  // CPRA: Right to Limit Use of Sensitive Data
  doNotShare: boolean;
  limitSensitiveData: boolean;

  // Communication
  optOutMarketing: boolean;
  optOutAnalytics: boolean;
  optOutProfiling: boolean;

  // Global Privacy Control
  gpcEnabled: boolean;
}
```

### Privacy Settings UI

```
┌─────────────────────────────────────────────────────────────┐
│  Privacy Settings                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Sale of Personal Information                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Do Not Sell My Personal Information      [Toggle ON]│   │
│  │ We will not sell your data to third parties         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Sharing of Personal Information                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Do Not Share My Personal Information     [Toggle ON]│   │
│  │ We will not share your data for cross-context ads   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Sensitive Data                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Limit Use of Sensitive Data            [Toggle OFF]│   │
│  │ Restrict processing of sensitive personal data      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Marketing & Communications                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ☐ Product updates and announcements                 │   │
│  │ ☐ Tips and best practices                           │   │
│  │ ☐ Partner offers                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│                            [Save Changes]                   │
└─────────────────────────────────────────────────────────────┘
```

### Global Privacy Control (GPC)

```typescript
// Detect GPC signal
function detectGPC(): boolean {
  return navigator.globalPrivacyControl === true;
}

// Auto-apply GPC preferences
if (detectGPC()) {
  await updatePrivacySettings({
    doNotSell: true,
    doNotShare: true,
    gpcEnabled: true,
  });
}
```

---

## Audit Logging

### Compliance-Related Audit Events

| Event Type | Severity | Legal Basis Required |
|------------|----------|---------------------|
| `consent.granted` | Low | Yes |
| `consent.withdrawn` | Medium | Yes |
| `export.requested` | Medium | Yes |
| `export.completed` | Low | Yes |
| `deletion.requested` | High | Yes |
| `deletion.completed` | Critical | Yes |
| `correction.requested` | Medium | Yes |
| `privacy.settings_updated` | Medium | Yes |

### Audit Log Schema

```typescript
interface ComplianceAuditLog {
  id: string;
  timestamp: Date;
  eventType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';

  // Actor
  actorUserId: string;
  actorEmail: string;
  actorIpAddress: string;

  // Subject (for GDPR)
  dataSubjectId?: string;

  // Legal Basis (GDPR Article 6)
  legalBasis: 'consent' | 'contract_performance' | 'legal_obligation' |
              'vital_interests' | 'public_task' | 'legitimate_interest';
  purpose: string;  // Min 20 characters

  // Details
  action: string;
  description: string;
  metadata: Record<string, any>;

  // Integrity
  entryHash: string;
  previousHash: string;
  signature: string;
}
```

### Audit Log Integrity

```typescript
// Hash chain for tamper detection
function computeEntryHash(log: AuditLog, previousHash: string): string {
  const data = JSON.stringify({
    timestamp: log.timestamp,
    eventType: log.eventType,
    actorUserId: log.actorUserId,
    action: log.action,
    previousHash,
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

// HMAC signature for authenticity
function signEntry(entryHash: string, secretKey: string): string {
  return crypto.createHmac('sha256', secretKey)
    .update(entryHash)
    .digest('hex');
}
```

---

## API Endpoints

### Compliance API Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/compliance/consent` | GET | Get user's consent records |
| `/api/v1/compliance/consent` | POST | Update consent preferences |
| `/api/v1/compliance/export/request` | POST | Request data export |
| `/api/v1/compliance/export/{id}` | GET | Get export status |
| `/api/v1/compliance/export/{id}/verify` | POST | Verify export request |
| `/api/v1/compliance/deletion/request` | POST | Request account deletion |
| `/api/v1/compliance/deletion/{id}` | GET | Get deletion status |
| `/api/v1/compliance/deletion/{id}` | DELETE | Cancel deletion |
| `/api/v1/compliance/deletion/{id}/verify` | POST | Verify deletion request |
| `/api/v1/compliance/correction/request` | POST | Request data correction |
| `/api/v1/compliance/correction/{id}` | GET | Get correction status |
| `/api/v1/compliance/privacy-settings` | GET | Get privacy settings |
| `/api/v1/compliance/privacy-settings` | PUT | Update privacy settings |
| `/api/v1/compliance/rights-portal` | GET | Get rights portal data |

---

## UI Components

### Required Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ConsentBanner` | Global | Cookie/tracking consent |
| `ConsentManager` | Settings | Granular consent management |
| `DataExportPanel` | Privacy Portal | Request/download exports |
| `DeletionRequestPanel` | Privacy Portal | Request account deletion |
| `CorrectionRequestPanel` | Privacy Portal | Request data corrections |
| `PrivacySettingsPanel` | Settings | CCPA/CPRA toggles |
| `RightsPortal` | Dedicated page | Central privacy dashboard |
| `ConsentHistory` | Privacy Portal | View consent history |

### Privacy Portal Structure

```
/settings/privacy
├── Overview
│   ├── Your Rights Summary
│   └── Quick Actions
├── Data & Privacy
│   ├── Export Your Data
│   ├── Delete Your Account
│   └── Correct Your Data
├── Consent Management
│   ├── Current Consents
│   └── Consent History
└── Privacy Controls
    ├── Sale/Sharing Opt-Out
    ├── Marketing Preferences
    └── Cookie Preferences
```

---

## Implementation Checklist

### Backend

- [ ] Consent management tables created
- [ ] Export job queue implemented
- [ ] Deletion workflow with grace period
- [ ] Correction request handling
- [ ] Privacy settings storage
- [ ] Audit logging with integrity
- [ ] GPC header detection
- [ ] Third-party notification system
- [ ] Data retention policies enforced

### Frontend

- [ ] Consent banner component
- [ ] Privacy portal pages
- [ ] Export request UI
- [ ] Deletion request UI with warnings
- [ ] Correction request forms
- [ ] Privacy settings toggles
- [ ] Consent history view
- [ ] Progress indicators for requests

### Operational

- [ ] DPO contact established
- [ ] Breach notification process
- [ ] Privacy policy updated
- [ ] Cookie policy updated
- [ ] Staff training completed
- [ ] Regular audit schedule

---

## Changelog

### v2.0.0 (January 26, 2026)

- Added CPRA compliance requirements
- Added APPI compliance requirements
- Added Global Privacy Control support
- Added data correction workflow
- Added grace period for deletions
- Enhanced audit logging with integrity
- Added UI component specifications
