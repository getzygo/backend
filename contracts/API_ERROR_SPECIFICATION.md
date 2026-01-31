# API Error Specification

**Version:** 1.0.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Error Response Schema](#error-response-schema)
3. [HTTP Status Code Reference](#http-status-code-reference)
4. [Error Code Catalog](#error-code-catalog)
5. [Domain-Specific Errors](#domain-specific-errors)
6. [Validation Errors](#validation-errors)
7. [Rate Limiting Errors](#rate-limiting-errors)
8. [Implementation Guidelines](#implementation-guidelines)

---

## Overview

This document defines the standardized error handling contract for all Zygo API endpoints. All errors follow a consistent schema to enable predictable client-side error handling.

### Design Principles

1. **Consistency**: All errors use the same response schema
2. **Actionability**: Error codes are machine-readable for programmatic handling
3. **Clarity**: Messages are human-readable for debugging
4. **Security**: Errors never expose sensitive system information
5. **Localization**: Message keys support i18n translation

---

## Error Response Schema

### Standard Error Response

```typescript
interface ErrorResponse {
  error: string;           // Machine-readable error code (SCREAMING_SNAKE_CASE)
  message: string;         // Human-readable description
  statusCode: number;      // HTTP status code (redundant but useful)
  timestamp: string;       // ISO 8601 timestamp
  requestId: string;       // Unique request identifier for tracing
  path: string;            // Request path that caused the error
  details?: ErrorDetails;  // Additional context (optional)
}

interface ErrorDetails {
  field?: string;                    // Field that caused the error
  value?: any;                       // Invalid value (sanitized)
  constraints?: Record<string, string>;  // Validation constraints
  allowedValues?: string[];          // Valid options for enum fields
  minValue?: number;                 // Minimum allowed value
  maxValue?: number;                 // Maximum allowed value
  retryAfter?: number;               // Seconds until retry (rate limits)
  requiredPermission?: string;       // Permission needed (403 errors)
  requiredMfa?: boolean;             // MFA requirement flag
  resourceType?: string;             // Type of resource not found
  resourceId?: string;               // ID of resource not found
}
```

### Example Error Responses

**400 Bad Request - Validation Error:**
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "statusCode": 400,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123def456",
  "path": "/api/v1/users",
  "details": {
    "field": "email",
    "value": "invalid-email",
    "constraints": {
      "isEmail": "Must be a valid email address"
    }
  }
}
```

**401 Unauthorized - Authentication Error:**
```json
{
  "error": "TOKEN_EXPIRED",
  "message": "Your session has expired. Please log in again.",
  "statusCode": 401,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123def456",
  "path": "/api/v1/workflows"
}
```

**403 Forbidden - Permission Error:**
```json
{
  "error": "PERMISSION_DENIED",
  "message": "You do not have permission to perform this action",
  "statusCode": 403,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123def456",
  "path": "/api/v1/roles/role_123",
  "details": {
    "requiredPermission": "canManageRoles"
  }
}
```

**403 Forbidden - MFA Required:**
```json
{
  "error": "MFA_REQUIRED",
  "message": "This action requires multi-factor authentication",
  "statusCode": 403,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123def456",
  "path": "/api/v1/secrets/export",
  "details": {
    "requiredMfa": true,
    "mfaEndpoint": "/api/v1/auth/mfa/verify"
  }
}
```

**404 Not Found:**
```json
{
  "error": "RESOURCE_NOT_FOUND",
  "message": "The requested resource was not found",
  "statusCode": 404,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123def456",
  "path": "/api/v1/servers/srv_nonexistent",
  "details": {
    "resourceType": "server",
    "resourceId": "srv_nonexistent"
  }
}
```

**429 Too Many Requests:**
```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Please try again later.",
  "statusCode": 429,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123def456",
  "path": "/api/v1/auth/login",
  "details": {
    "retryAfter": 900,
    "limit": 5,
    "window": "15 minutes"
  }
}
```

---

## HTTP Status Code Reference

### Success Codes (2xx)

| Code | Name | Usage |
|------|------|-------|
| 200 | OK | Successful GET, PUT, PATCH, DELETE |
| 201 | Created | Successful POST creating a resource |
| 202 | Accepted | Async operation accepted (workflow execution) |
| 204 | No Content | Successful DELETE with no response body |

### Client Error Codes (4xx)

| Code | Name | Usage |
|------|------|-------|
| 400 | Bad Request | Validation errors, malformed JSON |
| 401 | Unauthorized | Missing/invalid/expired token |
| 403 | Forbidden | Permission denied, MFA required, tenant isolation |
| 404 | Not Found | Resource does not exist |
| 405 | Method Not Allowed | HTTP method not supported |
| 409 | Conflict | Resource conflict (duplicate, in-use) |
| 410 | Gone | Resource permanently deleted |
| 413 | Payload Too Large | Request body exceeds limit |
| 415 | Unsupported Media Type | Invalid Content-Type |
| 422 | Unprocessable Entity | Semantic validation failure |
| 429 | Too Many Requests | Rate limit exceeded |

### Server Error Codes (5xx)

| Code | Name | Usage |
|------|------|-------|
| 500 | Internal Server Error | Unexpected server error |
| 502 | Bad Gateway | Upstream service failure |
| 503 | Service Unavailable | Service temporarily unavailable |
| 504 | Gateway Timeout | Upstream service timeout |

---

## Error Code Catalog

### Authentication Errors (AUTH_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `AUTH_TOKEN_MISSING` | 401 | No authorization token provided | Include Bearer token in header |
| `AUTH_TOKEN_INVALID` | 401 | Token format invalid or corrupted | Obtain new token via login |
| `AUTH_TOKEN_EXPIRED` | 401 | Token has expired | Refresh token or re-login |
| `AUTH_TOKEN_REVOKED` | 401 | Token has been revoked | Re-login required |
| `AUTH_CREDENTIALS_INVALID` | 401 | Email/password combination incorrect | Check credentials |
| `AUTH_ACCOUNT_LOCKED` | 403 | Account locked due to failed attempts | Wait or contact support |
| `AUTH_ACCOUNT_SUSPENDED` | 403 | Account suspended by admin | Contact support |
| `AUTH_ACCOUNT_DELETED` | 410 | Account has been deleted | Account unrecoverable |
| `AUTH_EMAIL_NOT_VERIFIED` | 403 | Email address not verified | Complete email verification |
| `AUTH_MFA_REQUIRED` | 403 | MFA verification needed | Complete MFA challenge |
| `AUTH_MFA_INVALID` | 401 | MFA code incorrect | Enter correct code |
| `AUTH_MFA_EXPIRED` | 401 | MFA code has expired | Request new code |
| `AUTH_OAUTH_FAILED` | 401 | OAuth authentication failed | Retry OAuth flow |
| `AUTH_SESSION_INVALID` | 401 | Session no longer valid | Re-login required |

### Authorization Errors (AUTHZ_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `AUTHZ_PERMISSION_DENIED` | 403 | User lacks required permission | Request permission from admin |
| `AUTHZ_ROLE_INSUFFICIENT` | 403 | Role hierarchy insufficient | Request higher role |
| `AUTHZ_TENANT_MISMATCH` | 403 | Resource belongs to different tenant | Access own tenant resources |
| `AUTHZ_RESOURCE_LOCKED` | 403 | Resource locked by another user | Wait for lock release |
| `AUTHZ_MFA_SESSION_EXPIRED` | 403 | MFA session expired for sensitive op | Re-verify MFA |
| `AUTHZ_IP_NOT_ALLOWED` | 403 | IP address not in allowlist | Use allowed network |
| `AUTHZ_FEATURE_DISABLED` | 403 | Feature disabled for tenant/plan | Upgrade plan |

### Validation Errors (VALIDATION_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `VALIDATION_FAILED` | 400 | One or more fields invalid | Check details.constraints |
| `VALIDATION_REQUIRED_FIELD` | 400 | Required field missing | Provide required field |
| `VALIDATION_INVALID_FORMAT` | 400 | Field format incorrect | Match expected format |
| `VALIDATION_OUT_OF_RANGE` | 400 | Value outside allowed range | Use value within range |
| `VALIDATION_INVALID_ENUM` | 400 | Value not in allowed set | Use allowed value |
| `VALIDATION_STRING_TOO_LONG` | 400 | String exceeds max length | Shorten string |
| `VALIDATION_STRING_TOO_SHORT` | 400 | String below min length | Lengthen string |
| `VALIDATION_INVALID_JSON` | 400 | JSON body malformed | Fix JSON syntax |
| `VALIDATION_INVALID_UUID` | 400 | UUID format invalid | Use valid UUID |
| `VALIDATION_INVALID_EMAIL` | 400 | Email format invalid | Use valid email |
| `VALIDATION_INVALID_URL` | 400 | URL format invalid | Use valid URL |
| `VALIDATION_INVALID_DATE` | 400 | Date format invalid | Use ISO 8601 format |

### Resource Errors (RESOURCE_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `RESOURCE_NOT_FOUND` | 404 | Resource does not exist | Verify resource ID |
| `RESOURCE_ALREADY_EXISTS` | 409 | Resource with identifier exists | Use different identifier |
| `RESOURCE_DELETED` | 410 | Resource was permanently deleted | Resource unrecoverable |
| `RESOURCE_IN_USE` | 409 | Resource referenced by others | Remove references first |
| `RESOURCE_LOCKED` | 423 | Resource locked for editing | Wait for unlock |
| `RESOURCE_LIMIT_REACHED` | 403 | Resource quota exceeded | Delete resources or upgrade |

### Tenant Errors (TENANT_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `TENANT_NOT_FOUND` | 404 | Tenant does not exist | Check tenant ID/slug |
| `TENANT_SUSPENDED` | 403 | Tenant account suspended | Contact support |
| `TENANT_QUOTA_EXCEEDED` | 403 | Tenant resource quota exceeded | Upgrade plan |
| `TENANT_ISOLATION_VIOLATION` | 403 | Cross-tenant access attempted | Access own resources |
| `TENANT_SUBDOMAIN_TAKEN` | 409 | Subdomain already in use | Choose different subdomain |

### User Management Errors (USER_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `USER_NOT_FOUND` | 404 | User does not exist | Verify user ID |
| `USER_EMAIL_EXISTS` | 409 | Email already registered | Use different email |
| `USER_INVITE_EXPIRED` | 410 | Invitation has expired | Request new invitation |
| `USER_INVITE_INVALID` | 400 | Invitation token invalid | Request new invitation |
| `USER_CANNOT_DELETE_SELF` | 400 | Cannot delete own account here | Use account settings |
| `USER_CANNOT_MODIFY_OWNER` | 403 | Cannot modify tenant owner | Owner is immutable |
| `USER_IN_RECOVERY` | 409 | User pending deletion recovery | Restore or wait 30 days |

### Role Management Errors (ROLE_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `ROLE_NOT_FOUND` | 404 | Role does not exist | Verify role ID |
| `ROLE_NAME_EXISTS` | 409 | Role name already exists | Use different name |
| `ROLE_HAS_MEMBERS` | 409 | Cannot delete role with members | Reassign members first |
| `ROLE_IS_SYSTEM` | 403 | Cannot modify system role | Create custom role |
| `ROLE_HIERARCHY_VIOLATION` | 403 | Cannot assign higher-privilege role | Use allowed role |
| `ROLE_CIRCULAR_REFERENCE` | 400 | Role hierarchy creates loop | Fix hierarchy |

### Billing Errors (BILLING_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `BILLING_PAYMENT_FAILED` | 402 | Payment processing failed | Update payment method |
| `BILLING_CARD_DECLINED` | 402 | Card was declined | Use different card |
| `BILLING_CARD_EXPIRED` | 402 | Card has expired | Update card details |
| `BILLING_INSUFFICIENT_FUNDS` | 402 | Insufficient funds | Use different payment |
| `BILLING_3DS_REQUIRED` | 402 | 3D Secure authentication needed | Complete 3DS flow |
| `BILLING_SUBSCRIPTION_CANCELLED` | 403 | Subscription is cancelled | Reactivate subscription |
| `BILLING_INVOICE_NOT_FOUND` | 404 | Invoice does not exist | Verify invoice ID |
| `BILLING_DOWNGRADE_RESTRICTED` | 403 | Cannot downgrade (usage exceeds) | Reduce usage first |

### Infrastructure Errors (INFRA_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `INFRA_SERVER_NOT_FOUND` | 404 | Server does not exist | Verify server ID |
| `INFRA_SERVER_OFFLINE` | 503 | Server is not reachable | Check server status |
| `INFRA_PROVIDER_ERROR` | 502 | Cloud provider API error | Retry or check provider |
| `INFRA_QUOTA_EXCEEDED` | 403 | Provider quota exceeded | Request quota increase |
| `INFRA_REGION_UNAVAILABLE` | 503 | Region temporarily unavailable | Use different region |
| `INFRA_IMAGE_NOT_FOUND` | 404 | OS image not available | Select different image |
| `INFRA_NETWORK_CONFLICT` | 409 | Network CIDR conflicts | Use different CIDR |
| `INFRA_FIREWALL_RULE_INVALID` | 400 | Firewall rule malformed | Fix rule syntax |

### Workflow Errors (WORKFLOW_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `WORKFLOW_NOT_FOUND` | 404 | Workflow does not exist | Verify workflow ID |
| `WORKFLOW_INVALID_DEFINITION` | 400 | Workflow definition malformed | Fix definition |
| `WORKFLOW_CIRCULAR_DEPENDENCY` | 400 | Nodes create circular loop | Fix node connections |
| `WORKFLOW_EXECUTION_FAILED` | 500 | Workflow execution failed | Check execution logs |
| `WORKFLOW_NODE_ERROR` | 500 | Node execution error | Check node configuration |
| `WORKFLOW_TIMEOUT` | 504 | Workflow execution timed out | Increase timeout or optimize |
| `WORKFLOW_CANCELLED` | 409 | Workflow was cancelled | Restart if needed |
| `WORKFLOW_ALREADY_RUNNING` | 409 | Workflow already executing | Wait for completion |
| `WORKFLOW_VERSION_CONFLICT` | 409 | Workflow modified during edit | Refresh and retry |

### Secret Management Errors (SECRET_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `SECRET_NOT_FOUND` | 404 | Secret does not exist | Verify secret ID |
| `SECRET_NAME_EXISTS` | 409 | Secret name already exists | Use different name |
| `SECRET_ALREADY_VIEWED` | 403 | Secret value already viewed | Value no longer accessible |
| `SECRET_DECRYPTION_FAILED` | 500 | Failed to decrypt secret | Contact support |
| `SECRET_EXPORT_MFA_REQUIRED` | 403 | MFA required for export | Verify MFA first |

### Webhook Errors (WEBHOOK_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `WEBHOOK_NOT_FOUND` | 404 | Webhook does not exist | Verify webhook ID |
| `WEBHOOK_URL_INVALID` | 400 | Webhook URL invalid | Use valid HTTPS URL |
| `WEBHOOK_DELIVERY_FAILED` | 502 | Webhook delivery failed | Check endpoint |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Webhook signature mismatch | Verify secret |

### Rate Limiting Errors (RATE_*)

| Error Code | HTTP | Description | Resolution |
|------------|------|-------------|------------|
| `RATE_LIMIT_EXCEEDED` | 429 | Request rate limit exceeded | Wait and retry |
| `RATE_LIMIT_BURST` | 429 | Burst limit exceeded | Slow down requests |
| `RATE_LIMIT_DAILY` | 429 | Daily limit exceeded | Wait until reset |

---

## Domain-Specific Errors

### AI Agent Errors

| Error Code | HTTP | Description |
|------------|------|-------------|
| `AI_AGENT_NOT_FOUND` | 404 | AI agent does not exist |
| `AI_AGENT_PAUSED` | 409 | Agent is paused |
| `AI_MODEL_UNAVAILABLE` | 503 | AI model service unavailable |
| `AI_TOKEN_LIMIT_EXCEEDED` | 403 | Token usage limit exceeded |
| `AI_CONTEXT_TOO_LARGE` | 400 | Context exceeds model limit |
| `AI_GENERATION_FAILED` | 500 | AI generation failed |

### Node Errors

| Error Code | HTTP | Description |
|------------|------|-------------|
| `NODE_NOT_FOUND` | 404 | Node does not exist |
| `NODE_TYPE_INVALID` | 400 | Invalid node type |
| `NODE_CONFIG_INVALID` | 400 | Node configuration invalid |
| `NODE_DEPENDENCY_MISSING` | 400 | Required dependency not installed |
| `NODE_VERSION_INCOMPATIBLE` | 409 | Node version incompatible |
| `NODE_EXECUTION_TIMEOUT` | 504 | Node execution timed out |

### Conversation Errors

| Error Code | HTTP | Description |
|------------|------|-------------|
| `CONVERSATION_NOT_FOUND` | 404 | Conversation does not exist |
| `CONVERSATION_CLOSED` | 409 | Conversation is closed |
| `MESSAGE_TOO_LONG` | 400 | Message exceeds limit |
| `ATTACHMENT_TOO_LARGE` | 413 | Attachment exceeds size limit |
| `ATTACHMENT_TYPE_INVALID` | 415 | Attachment type not allowed |

---

## Validation Errors

### Multiple Validation Errors

When multiple fields fail validation, return all errors:

```json
{
  "error": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "statusCode": 400,
  "timestamp": "2026-01-26T12:00:00.000Z",
  "requestId": "req_abc123def456",
  "path": "/api/v1/users",
  "details": {
    "errors": [
      {
        "field": "email",
        "value": "invalid",
        "constraints": {
          "isEmail": "Must be a valid email address"
        }
      },
      {
        "field": "password",
        "value": null,
        "constraints": {
          "isNotEmpty": "Password is required",
          "minLength": "Password must be at least 8 characters"
        }
      }
    ]
  }
}
```

### Nested Object Validation

For nested objects, use dot notation:

```json
{
  "error": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "statusCode": 400,
  "details": {
    "errors": [
      {
        "field": "config.resourceLimits.memory",
        "value": "invalid",
        "constraints": {
          "matches": "Must match pattern: ^[0-9]+(Mi|Gi)$"
        }
      }
    ]
  }
}
```

---

## Rate Limiting Errors

### Rate Limit Headers

All responses include rate limit headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1706270400
X-RateLimit-Window: 60
```

### Rate Limit Categories

| Category | Limit | Window | Scope |
|----------|-------|--------|-------|
| Authentication | 5 | 15 minutes | Per IP |
| MFA Verification | 3 | 5 minutes | Per User |
| Password Reset | 3 | 1 hour | Per Email |
| API Default | 1000 | 1 minute | Per Tenant |
| Workflow Execution | 100 | 1 minute | Per Tenant |
| Bulk Operations | 10 | 1 minute | Per Tenant |
| AI Generation | 60 | 1 minute | Per Tenant |
| Export Operations | 10 | 1 hour | Per User |

---

## Implementation Guidelines

### Backend Implementation

```typescript
// Error factory function
function createError(
  code: ErrorCode,
  message: string,
  statusCode: number,
  details?: ErrorDetails
): ErrorResponse {
  return {
    error: code,
    message,
    statusCode,
    timestamp: new Date().toISOString(),
    requestId: getCurrentRequestId(),
    path: getCurrentPath(),
    details
  };
}

// Usage in controller
if (!user.hasPermission('canManageRoles')) {
  throw new ForbiddenException(
    createError(
      'AUTHZ_PERMISSION_DENIED',
      'You do not have permission to manage roles',
      403,
      { requiredPermission: 'canManageRoles' }
    )
  );
}
```

### Error Logging

All errors should be logged with:
- Request ID (for correlation)
- User ID (if authenticated)
- Tenant ID (if applicable)
- Full stack trace (for 5xx errors)
- Sanitized request body (exclude passwords/secrets)

### Client Error Handling

```typescript
try {
  await api.createRole(roleData);
} catch (error) {
  if (error.response?.data?.error === 'ROLE_NAME_EXISTS') {
    showNotification('A role with this name already exists');
  } else if (error.response?.data?.error === 'AUTHZ_PERMISSION_DENIED') {
    showNotification('You do not have permission to create roles');
  } else {
    showNotification('An unexpected error occurred');
  }
}
```

---

## Changelog

### v1.0.0 (January 26, 2026)
- Initial error specification
- 100+ error codes defined
- Validation error patterns
- Rate limiting specification
