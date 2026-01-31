# Workflow Execution Specification

**Version:** 1.0.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Execution Lifecycle](#execution-lifecycle)
3. [API Endpoints](#api-endpoints)
4. [Request/Response Schemas](#requestresponse-schemas)
5. [Real-Time Updates](#real-time-updates)
6. [Node Execution](#node-execution)
7. [Error Handling](#error-handling)
8. [Retry and Recovery](#retry-and-recovery)
9. [Database Schema](#database-schema)

---

## Overview

This document specifies the workflow execution system for the Zygo platform, including API contracts, execution states, real-time updates, and error handling.

### Key Concepts

| Concept | Description |
|---------|-------------|
| Workflow | A directed graph of nodes that defines automation logic |
| Execution | A single run of a workflow with specific inputs |
| Node Execution | Execution of an individual node within a workflow |
| AI Agent | Orchestrator that reads node descriptions and manages execution |

---

## Execution Lifecycle

### Execution States

```
[queued] --> [initializing] --> [running] --> [completed]
    |              |               |
    v              v               v
[cancelled]    [failed]       [failed]
                                  |
                                  v
                            [partial_success]
```

| State | Description | Transitions To |
|-------|-------------|----------------|
| `queued` | Execution request accepted, waiting for resources | `initializing`, `cancelled` |
| `initializing` | Loading workflow definition and validating | `running`, `failed` |
| `running` | Nodes are being executed | `completed`, `failed`, `partial_success`, `cancelled` |
| `completed` | All nodes executed successfully | Terminal |
| `failed` | Execution failed (unrecoverable) | Terminal |
| `partial_success` | Some nodes completed, some failed | Terminal |
| `cancelled` | Execution cancelled by user | Terminal |
| `paused` | Execution paused (awaiting input/approval) | `running`, `cancelled` |

### Node Execution States

| State | Description |
|-------|-------------|
| `pending` | Node waiting to be executed |
| `running` | Node currently executing |
| `completed` | Node executed successfully |
| `failed` | Node execution failed |
| `skipped` | Node skipped (conditional branch) |
| `retrying` | Node failed, attempting retry |

---

## API Endpoints

### Execute Workflow

```
POST /api/v1/workflows/{workflowId}/execute
```

Start a new workflow execution.

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `workflowId` | UUID | Workflow identifier |

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
X-Tenant-ID: <tenant_id> (optional, for admin)
X-Idempotency-Key: <unique_key> (optional, prevents duplicate executions)
```

**Request Body:**
```json
{
  "inputs": {
    "url": "https://example.com",
    "maxDepth": 3
  },
  "options": {
    "timeout": 300000,
    "priority": "normal",
    "retryPolicy": {
      "maxRetries": 3,
      "backoffMultiplier": 2,
      "initialDelayMs": 1000
    },
    "webhookUrl": "https://my-app.com/webhook",
    "tags": ["production", "scraping"],
    "async": true
  }
}
```

**Response (202 Accepted - Async):**
```json
{
  "executionId": "exec_abc123def456",
  "workflowId": "wf_789xyz",
  "status": "queued",
  "createdAt": "2026-01-26T12:00:00.000Z",
  "estimatedDuration": 45000,
  "links": {
    "self": "/api/v1/executions/exec_abc123def456",
    "status": "/api/v1/executions/exec_abc123def456/status",
    "logs": "/api/v1/executions/exec_abc123def456/logs",
    "cancel": "/api/v1/executions/exec_abc123def456/cancel",
    "websocket": "wss://api.zygo.io/ws/executions/exec_abc123def456"
  }
}
```

**Response (200 OK - Sync, when async: false):**
```json
{
  "executionId": "exec_abc123def456",
  "workflowId": "wf_789xyz",
  "status": "completed",
  "createdAt": "2026-01-26T12:00:00.000Z",
  "completedAt": "2026-01-26T12:00:45.000Z",
  "duration": 45000,
  "outputs": {
    "pages": [
      {"url": "https://example.com", "title": "Example"}
    ],
    "totalPages": 15
  },
  "nodeResults": {
    "node_1": { "status": "completed", "output": {...} },
    "node_2": { "status": "completed", "output": {...} }
  }
}
```

### Get Execution Status

```
GET /api/v1/executions/{executionId}
```

**Response:**
```json
{
  "executionId": "exec_abc123def456",
  "workflowId": "wf_789xyz",
  "workflowName": "Web Scraper",
  "workflowVersion": 3,
  "status": "running",
  "progress": {
    "percentage": 65,
    "completedNodes": 4,
    "totalNodes": 6,
    "currentNode": "node_5"
  },
  "inputs": {
    "url": "https://example.com"
  },
  "outputs": null,
  "startedAt": "2026-01-26T12:00:00.000Z",
  "estimatedCompletion": "2026-01-26T12:00:45.000Z",
  "nodeExecutions": [
    {
      "nodeId": "node_1",
      "nodeName": "Trigger",
      "nodeType": "trigger",
      "status": "completed",
      "startedAt": "2026-01-26T12:00:00.000Z",
      "completedAt": "2026-01-26T12:00:01.000Z",
      "duration": 1000
    },
    {
      "nodeId": "node_5",
      "nodeName": "Process Data",
      "nodeType": "ai_agent",
      "status": "running",
      "startedAt": "2026-01-26T12:00:30.000Z",
      "progress": {
        "step": "Analyzing page content",
        "percentage": 45
      }
    }
  ],
  "errors": [],
  "metadata": {
    "triggeredBy": "user_123",
    "triggerType": "manual",
    "tags": ["production"]
  }
}
```

### Get Execution Logs

```
GET /api/v1/executions/{executionId}/logs
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `nodeId` | string | Filter by node ID |
| `level` | string | Filter by log level (debug, info, warn, error) |
| `since` | ISO8601 | Logs after timestamp |
| `limit` | number | Max log entries (default: 100) |
| `cursor` | string | Pagination cursor |

**Response:**
```json
{
  "logs": [
    {
      "id": "log_001",
      "timestamp": "2026-01-26T12:00:01.000Z",
      "level": "info",
      "nodeId": "node_1",
      "nodeName": "Trigger",
      "message": "Workflow execution started",
      "data": {
        "inputs": {"url": "https://example.com"}
      }
    },
    {
      "id": "log_002",
      "timestamp": "2026-01-26T12:00:15.000Z",
      "level": "debug",
      "nodeId": "node_3",
      "nodeName": "HTTP Request",
      "message": "Sending request to target URL",
      "data": {
        "method": "GET",
        "url": "https://example.com"
      }
    },
    {
      "id": "log_003",
      "timestamp": "2026-01-26T12:00:16.000Z",
      "level": "error",
      "nodeId": "node_3",
      "nodeName": "HTTP Request",
      "message": "Request failed with status 503",
      "data": {
        "statusCode": 503,
        "retryAttempt": 1
      }
    }
  ],
  "pagination": {
    "hasMore": true,
    "cursor": "cursor_xyz"
  }
}
```

### Cancel Execution

```
POST /api/v1/executions/{executionId}/cancel
```

**Request Body:**
```json
{
  "reason": "User requested cancellation",
  "force": false
}
```

**Response:**
```json
{
  "executionId": "exec_abc123def456",
  "status": "cancelled",
  "cancelledAt": "2026-01-26T12:00:30.000Z",
  "cancelledBy": "user_123",
  "reason": "User requested cancellation",
  "completedNodes": ["node_1", "node_2", "node_3"],
  "cancelledNodes": ["node_4", "node_5"]
}
```

### Retry Failed Execution

```
POST /api/v1/executions/{executionId}/retry
```

**Request Body:**
```json
{
  "fromNode": "node_3",
  "inputs": {
    "url": "https://example.com/updated"
  }
}
```

**Response:**
```json
{
  "executionId": "exec_new123",
  "parentExecutionId": "exec_abc123def456",
  "status": "queued",
  "retryFromNode": "node_3"
}
```

### List Executions

```
GET /api/v1/workflows/{workflowId}/executions
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status |
| `since` | ISO8601 | Executions after date |
| `until` | ISO8601 | Executions before date |
| `limit` | number | Results per page (max: 100) |
| `cursor` | string | Pagination cursor |

---

## Request/Response Schemas

### WorkflowExecutionRequest

```typescript
interface WorkflowExecutionRequest {
  inputs: Record<string, any>;
  options?: ExecutionOptions;
}

interface ExecutionOptions {
  // Timing
  timeout?: number;              // Max execution time in ms (default: 300000)
  scheduledAt?: string;          // ISO8601 - schedule for future

  // Priority
  priority?: 'low' | 'normal' | 'high' | 'critical';

  // Retry behavior
  retryPolicy?: {
    maxRetries: number;          // Default: 3
    backoffMultiplier: number;   // Default: 2
    initialDelayMs: number;      // Default: 1000
    maxDelayMs: number;          // Default: 60000
    retryableErrors?: string[];  // Error codes to retry
  };

  // Notifications
  webhookUrl?: string;           // Webhook for status updates
  webhookEvents?: WebhookEvent[];
  notifyOnComplete?: boolean;
  notifyOnError?: boolean;

  // Execution mode
  async?: boolean;               // Default: true
  dryRun?: boolean;              // Validate without executing
  debugMode?: boolean;           // Enable verbose logging

  // Metadata
  tags?: string[];
  correlationId?: string;        // For distributed tracing
  parentExecutionId?: string;    // For chained executions
}

type WebhookEvent =
  | 'execution.started'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.cancelled'
  | 'node.started'
  | 'node.completed'
  | 'node.failed';
```

### WorkflowExecutionResponse

```typescript
interface WorkflowExecutionResponse {
  executionId: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  status: ExecutionStatus;

  // Timing
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  duration?: number;             // Milliseconds
  estimatedCompletion?: string;

  // Progress
  progress: {
    percentage: number;
    completedNodes: number;
    totalNodes: number;
    currentNode?: string;
  };

  // I/O
  inputs: Record<string, any>;
  outputs?: Record<string, any>;

  // Node details
  nodeExecutions: NodeExecutionSummary[];

  // Errors
  errors: ExecutionError[];

  // Metadata
  metadata: {
    triggeredBy: string;
    triggerType: 'manual' | 'schedule' | 'webhook' | 'api' | 'workflow';
    tags: string[];
    correlationId?: string;
    parentExecutionId?: string;
  };

  // Links
  links: {
    self: string;
    status: string;
    logs: string;
    cancel: string;
    websocket: string;
  };
}

type ExecutionStatus =
  | 'queued'
  | 'initializing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partial_success'
  | 'cancelled'
  | 'paused';

interface NodeExecutionSummary {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: NodeStatus;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  retryCount?: number;
  output?: any;
  error?: ExecutionError;
  progress?: {
    step: string;
    percentage: number;
  };
}

type NodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'retrying';

interface ExecutionError {
  code: string;
  message: string;
  nodeId?: string;
  nodeName?: string;
  timestamp: string;
  retryable: boolean;
  stack?: string;              // Only in debug mode
  details?: Record<string, any>;
}
```

---

## Real-Time Updates

### WebSocket Connection

```
WSS /ws/executions/{executionId}
```

**Connection:**
```javascript
const ws = new WebSocket('wss://api.zygo.io/ws/executions/exec_abc123');
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    token: 'Bearer <jwt_token>'
  }));
};
```

### WebSocket Messages

**Server → Client: Status Update**
```json
{
  "type": "status_update",
  "timestamp": "2026-01-26T12:00:30.000Z",
  "data": {
    "executionId": "exec_abc123",
    "status": "running",
    "progress": {
      "percentage": 65,
      "completedNodes": 4,
      "totalNodes": 6,
      "currentNode": "node_5"
    }
  }
}
```

**Server → Client: Node Started**
```json
{
  "type": "node_started",
  "timestamp": "2026-01-26T12:00:30.000Z",
  "data": {
    "executionId": "exec_abc123",
    "nodeId": "node_5",
    "nodeName": "AI Agent",
    "nodeType": "ai_agent"
  }
}
```

**Server → Client: Node Completed**
```json
{
  "type": "node_completed",
  "timestamp": "2026-01-26T12:00:45.000Z",
  "data": {
    "executionId": "exec_abc123",
    "nodeId": "node_5",
    "nodeName": "AI Agent",
    "duration": 15000,
    "output": {
      "analysis": "Content processed successfully"
    }
  }
}
```

**Server → Client: Node Failed**
```json
{
  "type": "node_failed",
  "timestamp": "2026-01-26T12:00:45.000Z",
  "data": {
    "executionId": "exec_abc123",
    "nodeId": "node_5",
    "nodeName": "AI Agent",
    "error": {
      "code": "AI_MODEL_UNAVAILABLE",
      "message": "AI model service is temporarily unavailable",
      "retryable": true,
      "retryCount": 1,
      "maxRetries": 3
    }
  }
}
```

**Server → Client: Execution Completed**
```json
{
  "type": "execution_completed",
  "timestamp": "2026-01-26T12:01:00.000Z",
  "data": {
    "executionId": "exec_abc123",
    "status": "completed",
    "duration": 60000,
    "outputs": {
      "result": "Processing complete"
    }
  }
}
```

**Server → Client: Log Entry**
```json
{
  "type": "log",
  "timestamp": "2026-01-26T12:00:35.000Z",
  "data": {
    "level": "info",
    "nodeId": "node_5",
    "message": "Processing batch 3 of 10"
  }
}
```

**Client → Server: Ping**
```json
{
  "type": "ping"
}
```

**Server → Client: Pong**
```json
{
  "type": "pong",
  "timestamp": "2026-01-26T12:00:00.000Z"
}
```

### Webhook Payloads

**execution.completed:**
```json
{
  "event": "execution.completed",
  "timestamp": "2026-01-26T12:01:00.000Z",
  "data": {
    "executionId": "exec_abc123",
    "workflowId": "wf_789xyz",
    "status": "completed",
    "duration": 60000,
    "outputs": {...}
  },
  "signature": "sha256=abc123..."
}
```

---

## Node Execution

### AI Agent Orchestration

The AI Agent node orchestrates workflow execution by:

1. Reading node descriptions to understand purpose
2. Determining execution order based on dependencies
3. Managing data flow between nodes
4. Making decisions at conditional branches
5. Handling errors and retries

```typescript
interface AIAgentContext {
  workflowId: string;
  executionId: string;
  currentNodeId: string;

  // Available information
  nodeDescriptions: Record<string, string>;
  nodeConnections: Edge[];
  executionHistory: NodeExecutionResult[];

  // Current state
  availableData: Record<string, any>;

  // Actions
  executeNode(nodeId: string, inputs: any): Promise<any>;
  skipNode(nodeId: string, reason: string): void;
  pauseExecution(reason: string): void;
  failExecution(error: Error): void;
}
```

### Node Execution Context

Each node receives an execution context:

```typescript
interface NodeExecutionContext {
  // Identity
  executionId: string;
  nodeId: string;
  workflowId: string;
  tenantId: string;

  // Inputs from previous nodes
  inputs: Record<string, any>;

  // Node configuration
  config: Record<string, any>;

  // Credentials (resolved from secrets)
  credentials: Record<string, string>;

  // Environment variables
  env: Record<string, string>;

  // Utilities
  logger: Logger;
  metrics: MetricsCollector;

  // State management
  getState<T>(key: string): Promise<T | null>;
  setState<T>(key: string, value: T): Promise<void>;

  // Abort signal for cancellation
  signal: AbortSignal;
}
```

### Node Output Contract

```typescript
interface NodeOutput {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metadata?: {
    duration: number;
    tokensUsed?: number;
    apiCalls?: number;
  };
}
```

---

## Error Handling

### Error Categories

| Category | Retryable | Example |
|----------|-----------|---------|
| Transient | Yes | Network timeout, rate limit |
| Configuration | No | Invalid credentials |
| Validation | No | Invalid input format |
| Resource | No | Resource not found |
| System | Maybe | Out of memory |

### Retry Decision Matrix

```typescript
const retryableErrors = [
  'NETWORK_TIMEOUT',
  'RATE_LIMIT_EXCEEDED',
  'SERVICE_UNAVAILABLE',
  'CONNECTION_RESET',
  'AI_MODEL_BUSY',
  'PROVIDER_ERROR'
];

const nonRetryableErrors = [
  'VALIDATION_ERROR',
  'AUTHENTICATION_FAILED',
  'PERMISSION_DENIED',
  'RESOURCE_NOT_FOUND',
  'INVALID_CONFIGURATION'
];
```

### Failure Modes

| Mode | Behavior |
|------|----------|
| `fail_fast` | Stop execution on first error |
| `continue_on_error` | Continue with remaining nodes |
| `collect_errors` | Execute all, report all errors |

---

## Retry and Recovery

### Retry Policy

```typescript
interface RetryPolicy {
  maxRetries: number;           // Default: 3
  backoffStrategy: 'fixed' | 'linear' | 'exponential';
  initialDelayMs: number;       // Default: 1000
  maxDelayMs: number;           // Default: 60000
  backoffMultiplier: number;    // Default: 2
  jitterFactor: number;         // Default: 0.1 (10% jitter)
  retryableErrors: string[];
}
```

### Backoff Calculation

```typescript
function calculateBackoff(
  attempt: number,
  policy: RetryPolicy
): number {
  let delay: number;

  switch (policy.backoffStrategy) {
    case 'fixed':
      delay = policy.initialDelayMs;
      break;
    case 'linear':
      delay = policy.initialDelayMs * attempt;
      break;
    case 'exponential':
      delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
      break;
  }

  // Apply max cap
  delay = Math.min(delay, policy.maxDelayMs);

  // Apply jitter
  const jitter = delay * policy.jitterFactor * (Math.random() * 2 - 1);

  return Math.round(delay + jitter);
}
```

### Partial Execution Resume

When resuming a failed execution:

1. Load execution state from database
2. Identify last successful node
3. Restore node outputs from completed nodes
4. Resume from first incomplete node
5. Continue execution with original inputs

---

## Database Schema

### workflow_executions Table

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  workflow_version INTEGER NOT NULL,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'queued',

  -- I/O
  inputs JSONB NOT NULL DEFAULT '{}',
  outputs JSONB,

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,

  -- Progress
  progress_percentage INTEGER DEFAULT 0,
  current_node_id VARCHAR(100),

  -- Options
  options JSONB NOT NULL DEFAULT '{}',

  -- Metadata
  triggered_by UUID REFERENCES users(id),
  trigger_type VARCHAR(20) NOT NULL DEFAULT 'manual',
  correlation_id VARCHAR(100),
  parent_execution_id UUID REFERENCES workflow_executions(id),
  tags TEXT[] DEFAULT '{}',

  -- Error tracking
  error_code VARCHAR(50),
  error_message TEXT,

  CONSTRAINT valid_status CHECK (status IN (
    'queued', 'initializing', 'running', 'completed',
    'failed', 'partial_success', 'cancelled', 'paused'
  ))
);

CREATE INDEX idx_executions_tenant ON workflow_executions(tenant_id);
CREATE INDEX idx_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX idx_executions_status ON workflow_executions(status);
CREATE INDEX idx_executions_created ON workflow_executions(created_at DESC);
```

### node_executions Table

```sql
CREATE TABLE node_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  -- Node identity
  node_id VARCHAR(100) NOT NULL,
  node_name VARCHAR(255),
  node_type VARCHAR(50),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending',

  -- I/O
  inputs JSONB,
  outputs JSONB,

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Retry tracking
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,

  -- Error tracking
  error_code VARCHAR(50),
  error_message TEXT,
  error_details JSONB,

  CONSTRAINT valid_node_status CHECK (status IN (
    'pending', 'running', 'completed', 'failed', 'skipped', 'retrying'
  )),
  UNIQUE(execution_id, node_id)
);

CREATE INDEX idx_node_executions_execution ON node_executions(execution_id);
```

### execution_logs Table

```sql
CREATE TABLE execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  -- Log details
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level VARCHAR(10) NOT NULL,
  node_id VARCHAR(100),
  message TEXT NOT NULL,
  data JSONB,

  CONSTRAINT valid_level CHECK (level IN ('debug', 'info', 'warn', 'error'))
);

CREATE INDEX idx_execution_logs_execution ON execution_logs(execution_id, timestamp DESC);
CREATE INDEX idx_execution_logs_level ON execution_logs(execution_id, level);
```

### RLS Policies

```sql
-- Tenant isolation for executions
CREATE POLICY executions_tenant_isolation ON workflow_executions
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY node_executions_tenant_isolation ON node_executions
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY execution_logs_tenant_isolation ON execution_logs
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## Changelog

### v1.0.0 (January 26, 2026)
- Initial workflow execution specification
- Complete API endpoint documentation
- WebSocket real-time updates
- Error handling and retry policies
- Database schema
