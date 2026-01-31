# Zygo Node & Workflow Engine

**Version:** 1.0.1
**Last Updated:** January 26, 2026
**Status:** Production-Ready

This document defines the core Node & Workflow Engine of the Zygo platform - an AI-driven visual workflow builder where nodes are microservices orchestrated by an AI Agent.

> **Core Concept:** Zygo is NOT like traditional workflow builders. Every workflow has an AI Agent at its center that orchestrates microservice nodes autonomously, making intelligent decisions about execution flow.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Node System](#node-system)
3. [AI Agent Orchestration](#ai-agent-orchestration)
4. [Workflow Engine](#workflow-engine)
5. [Node Configuration Schemas](#node-configuration-schemas)
6. [Credential Handling](#credential-handling)
7. [Workflow Execution](#workflow-execution)
8. [Documentation System](#documentation-system)
9. [Permissions](#permissions)
10. [API Endpoints](#api-endpoints)
11. [Database Schema](#database-schema)

---

## Architecture Overview

### Core Philosophy

Zygo workflows operate on a fundamentally different paradigm:

```
Traditional Workflow:  A → B → C → D (Linear, fixed execution path)

Zygo Workflow:
                    ┌─────────┐
                    │ Trigger │
                    └────┬────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────┴────┐    ┌─────┴─────┐    ┌────┴────┐
    │   LLM   │    │ AI AGENT  │    │   RAG   │
    │  "I can │    │  (Brain)  │    │ "I can  │
    │ process │◄──►│           │◄──►│ search  │
    │  text"  │    │  Reads    │    │ docs"   │
    └─────────┘    │  node     │    └─────────┘
                   │  descrip- │
    ┌─────────┐    │  tions    │    ┌─────────┐
    │ Memory  │    │  and      │    │HTTP API │
    │ "I can  │◄──►│  decides  │◄──►│ "I can  │
    │ store"  │    │  which    │    │  call   │
    └─────────┘    │  to use   │    │  APIs"  │
                   └───────────┘

Visual connections show AVAILABLE nodes, not execution order.
AI Agent reads each node's DESCRIPTION to understand capabilities,
then dynamically decides which node(s) to call based on the task.
```

### Key Differentiators

| Traditional Workflow | Zygo Workflow |
|---------------------|---------------|
| Fixed execution path | Dynamic AI-driven routing |
| Manual node connections | AI decides execution order |
| Static branching | Intelligent conditional logic |
| Pre-defined flow | Adaptive to context and data |
| User creates every path | AI generates optimal paths |

### Workflow Creation Methods

1. **AI-Generated** - User provides a prompt, AI Agent generates the entire workflow
2. **Manual Creation** - User drags and drops nodes, defines connections
3. **Hybrid** - AI generates base workflow, user optimizes manually
4. **Template-Based** - Start from pre-built workflow templates

---

## Node System

### Node Registry (20 Node Types)

The Zygo platform provides 20 specialized node types organized by function:

#### Core Orchestration Nodes

| Node Type | ID | Description | Icon |
|-----------|-----|-------------|------|
| **AI Agent** | `ai_agent` | Central orchestration hub - the "brain" of every workflow | Brain |
| **Trigger** | `trigger` | Workflow entry point (chat, manual, schedule, webhook) | Zap |
| **Planner** | `planner` | AI-powered task planning and decomposition | ListTodo |

#### AI & Intelligence Nodes

| Node Type | ID | Description | Icon |
|-----------|-----|-------------|------|
| **LLM** | `llm` | Process with AI model (OpenAI, Anthropic, Google, etc.) | Sparkles |
| **RAG Context** | `rag_context` | Retrieve augmented generation context | FileSearch |
| **Memory Store** | `memory_store` | Store memory records (semantic, episodic, procedural) | Save |
| **Memory Search** | `memory_search` | Search and retrieve from memory store | Search |
| **Knowledge Graph** | `knowledge_graph` | Query and traverse knowledge graphs | GitBranch |
| **Entity Query** | `entity_query` | Query and manage entities | Tags |

#### Integration Nodes

| Node Type | ID | Description | Icon |
|-----------|-----|-------------|------|
| **HTTP API** | `http_api` | Call external REST/GraphQL APIs | Globe |
| **Data Source** | `data` | Fetch or store data from various sources | Database |
| **Email** | `email` | Send email notifications | Mail |
| **Code** | `code` | Execute custom JavaScript/Python code | Code |

#### Flow Control Nodes

| Node Type | ID | Description | Icon |
|-----------|-----|-------------|------|
| **Conditional** | `conditional` | Branch workflow based on conditions | GitBranch |
| **Loop** | `loop` | Iterate over data (for-each, while, count) | Repeat |
| **Filter** | `filter` | Filter and transform data items | Filter |
| **Delay** | `delay` | Wait for specified duration | Clock |

#### Operations Nodes

| Node Type | ID | Description | Icon |
|-----------|-----|-------------|------|
| **Security** | `security` | Implement security measures and validation | Shield |
| **Maintenance** | `maintenance` | Perform maintenance and cleanup tasks | Wrench |
| **Monitoring** | `monitoring` | Monitor system performance and metrics | Activity |

### Node Visual Representation

```typescript
// AI Agent Node - Central hub (128x128px circular)
interface AIAgentNodeData {
  isTriggered: boolean;
  config: AIAgentConfigData;
}

// Category Node - Microservice nodes (120px min-width pill)
interface CategoryNodeData {
  label: string;
  nodeType: string;
  icon: LucideIcon;
  color: string;
  isTriggered: boolean;
  config: NodeConfigData;
}
```

### Node Capability Descriptions

> **Important:** Visual positioning of nodes on the canvas is purely for UI layout purposes.
> The AI Agent does NOT use connection direction or position to determine execution order.

Each node has a **Description** field in its configuration panel that explains what the node can do:

```typescript
interface NodeConfigData {
  // ... other fields
  description: string;  // Explains node capabilities to AI Agent
}
```

**How AI Agent Uses Node Descriptions:**

1. **Discovery** - AI Agent reads the description of all connected nodes
2. **Understanding** - Learns what each node is capable of doing
3. **Selection** - When a task arrives, AI Agent matches task requirements to node capabilities
4. **Execution** - Triggers the appropriate node(s) based on capability match, NOT visual position

**Example Node Descriptions:**

| Node | Description Example |
|------|---------------------|
| LLM | "Process text using GPT-4 with custom system prompt for summarization" |
| HTTP API | "Call GitHub API to fetch repository issues and pull requests" |
| Memory Store | "Store conversation context with semantic indexing for later retrieval" |
| Conditional | "Route based on sentiment score: positive > 0.7 goes to branch A" |

This capability-based approach means:
- Nodes can be positioned anywhere on the canvas for visual clarity
- Connection lines show possible paths, not execution order
- AI Agent intelligently decides which node to use based on the task at hand

---

## AI Agent Orchestration

### The AI Agent Node

The AI Agent is the central "brain" of every Zygo workflow. Unlike traditional workflow engines where nodes execute in a predetermined sequence, the AI Agent:

1. **Receives Input** - From trigger node or external sources
2. **Reads Node Descriptions** - Understands what each connected node can do
3. **Analyzes Task** - Uses LLM to understand what needs to be accomplished
4. **Matches Capabilities** - Identifies which node(s) can help achieve the goal
5. **Orchestrates Dynamically** - Calls nodes based on capability, not position
6. **Manages State** - Uses memory nodes to persist context and decisions
7. **Adapts in Real-Time** - Changes strategy based on intermediate results
8. **Returns Output** - Provides final response or action

### AI Agent Configuration

```typescript
interface AIAgentConfigData {
  // LLM Configuration
  provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'cohere';
  model: string;
  apiKey: string;
  apiKeyVariableId?: string;  // Reference to environment variable
  temperature: number;        // 0-2, default 0.7
  maxTokens: number;          // Default 1000

  // Agent Behavior
  systemPrompt: string;       // Instructions for the agent
  agentType: 'tools' | 'conversational' | 'react';
  maxIterations: number;      // Max reasoning loops, default 10
  toolTimeout: number;        // Timeout for tool calls (ms)
  returnIntermediateSteps: boolean;  // Show reasoning process
  enableStreaming: boolean;   // Stream responses
}
```

### Supported LLM Providers

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-4o, GPT-4 Turbo, GPT-4, GPT-3.5 Turbo |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku |
| **Google** | Gemini Pro, Gemini Pro Vision |
| **Azure OpenAI** | Deployed Azure models |
| **Cohere** | Command, Command-Light |

### Agent Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Tools Agent** | Uses connected nodes as tools to accomplish tasks | Complex multi-step operations |
| **Conversational Agent** | Pure conversation without tool calling | Chat interfaces, Q&A |
| **ReAct Agent** | Reasoning + Acting pattern with explicit thought process | Complex reasoning tasks |

### Orchestration Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    WORKFLOW EXECUTION                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. TRIGGER ACTIVATES                                        │
│     └─► Chat message / Webhook / Schedule / Manual           │
│                                                              │
│  2. AI AGENT RECEIVES INPUT                                  │
│     └─► Analyzes request using LLM                           │
│                                                              │
│  3. PLANNING PHASE (if Planner node connected)               │
│     └─► Generates step-by-step plan                          │
│     └─► Identifies required tools/nodes                      │
│                                                              │
│  4. EXECUTION PHASE                                          │
│     └─► AI Agent calls nodes in optimal order                │
│     └─► Results fed back to agent for next decision          │
│     └─► Memory nodes store intermediate state                │
│                                                              │
│  5. RESPONSE GENERATION                                      │
│     └─► AI Agent synthesizes final output                    │
│     └─► Returns through trigger node                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Workflow Engine

### Workflow Builder Interface

The visual workflow builder uses React Flow for graph-based editing:

```typescript
interface WorkflowState {
  id: string;
  name: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
  status: 'draft' | 'active' | 'paused' | 'archived';
  createdBy: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

interface Node {
  id: string;
  type: 'aiAgent' | 'category';
  position: { x: number; y: number };
  data: NodeData;
}

interface Edge {
  id: string;
  source: string;       // Source node ID
  target: string;       // Target node ID
  sourceHandle?: string;
  targetHandle?: string;
}
```

### Workflow Creation via AI

Users can create workflows by describing what they want:

```
User: "Create a workflow that monitors my GitHub repo for new issues,
       analyzes them with AI to categorize and prioritize, then posts
       a summary to Slack daily."

AI Agent generates:
1. Trigger Node (schedule: daily)
2. HTTP API Node (GitHub Issues API)
3. LLM Node (categorization)
4. Memory Store Node (issue tracking)
5. Conditional Node (priority routing)
6. HTTP API Node (Slack webhook)
```

### Manual Workflow Creation

1. **Drag & Drop** - Drag nodes from palette to canvas
2. **Position** - Nodes auto-position relative to AI Agent
3. **Connect** - Draw edges between node handles
4. **Configure** - Double-click to open configuration panel
5. **Test** - Run workflow with test data
6. **Deploy** - Activate for production use

---

## Node Configuration Schemas

### Trigger Node

```typescript
interface TriggerNodeConfigData {
  triggerMode: 'chat' | 'manual' | 'schedule' | 'webhook';

  // Chat Mode
  chatConfig: {
    intelligentAutomation: boolean;
    executionNarration: boolean;
    responseStyle: 'concise' | 'standard' | 'detailed';
  };

  // Manual Mode
  manualConfig: {
    inputPayload: string;  // JSON schema for input
  };

  // Schedule Mode
  scheduleConfig: {
    type: 'interval' | 'cron' | 'once';
    intervalValue: number;
    intervalUnit: 'seconds' | 'minutes' | 'hours' | 'days';
    cronExpression: string;
    onceDate: string;
  };

  // Webhook Mode
  webhookConfig: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    requireAuth: boolean;
  };
}
```

### Planner Node

```typescript
interface PlannerConfigData {
  // Planner LLM
  plannerProvider: string;
  plannerModel: string;
  plannerApiKey: string;
  plannerApiKeyVariableId?: string;

  // Synthesizer LLM (for combining results)
  synthesizerProvider: string;
  synthesizerModel: string;
  synthesizerApiKey: string;
  synthesizerApiKeyVariableId?: string;

  // Behavior
  executionMode: 'interactive' | 'autonomous' | 'silent';
  minRequirements: number;      // Minimum requirements to extract
  minConstraints: number;       // Minimum constraints to identify
  maxQuestions: number;         // Max clarifying questions
  minConfidence: number;        // Confidence threshold (0-100)
  trustLlmThreshold: number;    // Trust level for LLM decisions

  // Override
  systemPromptOverride: string;
}
```

### Memory Store Node

```typescript
interface MemoryStoreConfigData {
  // Memory Classification
  memoryType: 'semantic' | 'episodic' | 'procedural' | 'factual';
  memoryKey: string;            // Unique key for retrieval
  content: string;              // Memory content
  title: string;
  tags: string;                 // Comma-separated tags
  summary: string;

  // Security
  sensitivity: 'public' | 'internal' | 'confidential' | 'secret';
  autoRedactSecrets: boolean;   // Auto-detect and redact sensitive data

  // Importance & Confidence
  importance: 'critical' | 'high' | 'medium' | 'low' | 'trivial';
  confidence: number;           // 0-1

  // Expiration
  expiresIn: 'never' | '1h' | '1d' | '7d' | '30d' | 'custom';
  customExpirationDays?: number;
  ttl?: number;

  // Relationships
  mergeStrategy: 'upsert' | 'append' | 'replace' | 'version';
  relatedMemoryKeys: string;    // Related memory references
  parentMemoryKey: string;
  replacesMemoryKey: string;
  relationshipLinks: string;    // JSON relationship definitions

  // Versioning
  enableVersioning: boolean;
  versionNote?: string;

  // Entity Extraction
  autoExtractEntities: boolean;
  extractionMethod: 'llm' | 'ner' | 'regex' | 'custom';

  // Context
  contextMetadata: string;      // JSON metadata
  workflowLocation: string;
  evidence: string;
  observedAt: string;
  actorKind: 'user' | 'agent' | 'system' | 'external';
  actorId: string;
}
```

### Memory Search Node

```typescript
interface MemorySearchConfigData {
  searchType: 'semantic' | 'keyword' | 'hybrid';
  query: string;
  filters: {
    memoryTypes: string[];
    tags: string[];
    sensitivity: string[];
    importance: string[];
    dateRange?: { start: string; end: string };
  };
  limit: number;
  threshold: number;            // Relevance threshold
  includeMetadata: boolean;
}
```

### LLM Node

```typescript
interface LLMConfigData {
  provider: string;
  model: string;
  apiKey: string;
  apiKeyVariableId?: string;

  // Generation Parameters
  temperature: number;          // 0-2
  maxTokens: number;
  topP: number;                 // Nucleus sampling
  frequencyPenalty: number;     // -2 to 2
  presencePenalty: number;      // -2 to 2

  // Prompt
  systemPrompt: string;
  userPromptTemplate: string;

  // Output
  outputFormat: 'text' | 'json' | 'markdown';
  jsonSchema?: string;          // If outputFormat is json
}
```

### HTTP API Node

```typescript
interface HTTPAPIConfigData {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  // Headers & Params
  headers: Array<{ key: string; value: string }>;
  queryParams: Array<{ key: string; value: string }>;

  // Body
  body: string;
  bodyType: 'none' | 'json' | 'form' | 'xml' | 'text';

  // Settings
  timeout: number;              // Seconds
  retries: number;

  // Authentication
  authentication: {
    type: 'none' | 'basic' | 'bearer' | 'apikey';
    username?: string;
    password?: string;
    token?: string;
    apiKey?: string;
    apiKeyHeader?: string;
  };

  // Response Handling
  responseMapping: string;      // JSONPath for extraction
  errorHandling: 'throw' | 'continue' | 'retry';
}
```

### Conditional Node

```typescript
interface ConditionalConfigData {
  conditions: Array<{
    id: string;
    variable: string;           // Variable to check
    operator: ConditionOperator;
    value: string;
    logicGate?: 'AND' | 'OR';
  }>;
  defaultBranch: string;        // Default path if no conditions match
  evaluationMode: 'all' | 'any' | 'custom';
  description: string;
}

type ConditionOperator =
  | 'equals' | 'not_equals'
  | 'greater_than' | 'less_than' | 'gte' | 'lte'
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'is_empty' | 'is_not_empty'
  | 'regex_match';
```

### Loop Node

```typescript
interface LoopConfigData {
  loopType: 'for_each' | 'while' | 'do_while' | 'count';
  dataSource: string;           // Variable or expression
  maxIterations: number;        // Safety limit

  // Conditions
  breakCondition: string;       // Exit loop when true
  continueCondition: string;    // Skip iteration when true

  // Iteration
  iteratorVariable: string;     // Variable name for current item

  // Parallel Execution
  parallelExecution: boolean;
  maxParallel: number;          // Max concurrent iterations

  description: string;
}
```

### Code Node

```typescript
interface CodeConfigData {
  language: 'javascript' | 'python';
  code: string;

  // Input/Output
  inputVariables: string[];     // Variables to pass in
  outputVariable: string;       // Variable to store result

  // Execution
  timeout: number;              // Seconds
  memoryLimit: number;          // MB

  // Dependencies (Python)
  pipDependencies?: string[];
}
```

### RAG Context Node

```typescript
interface RAGContextConfigData {
  // Vector Store
  vectorStore: 'pinecone' | 'weaviate' | 'qdrant' | 'chroma';
  vectorStoreConfig: {
    apiKey: string;
    apiKeyVariableId?: string;
    indexName: string;
    namespace?: string;
  };

  // Embedding
  embeddingProvider: string;
  embeddingModel: string;
  embeddingApiKey: string;
  embeddingApiKeyVariableId?: string;

  // Retrieval
  query: string;
  topK: number;                 // Number of results
  scoreThreshold: number;       // Minimum relevance score

  // Filtering
  filters: Record<string, any>;
  includeMetadata: boolean;
}
```

---

## Credential Handling

### Dual-Mode Credential Input

Every node that requires credentials supports two modes:

#### 1. Environment Variables Mode (Recommended)

```typescript
// Select from saved environment variables
interface CredentialFromVariable {
  mode: 'variable';
  variableId: string;           // Reference to environment variable
  variableName: string;         // For display
}

// Variables appear in format: {{VARIABLE_NAME}}
```

#### 2. Manual Entry Mode

```typescript
// Direct API key input
interface CredentialManual {
  mode: 'manual';
  value: string;                // Plaintext (not recommended for production)
  saveAsVariable?: boolean;     // Option to save for reuse
  variableName?: string;        // If saving as variable
}
```

### Credential Field Component

```typescript
interface LLMCredentialFieldProps {
  value: string;
  onChange: (value: string) => void;
  variableId?: string;
  onVariableChange: (id: string | undefined) => void;
  label: string;
  placeholder: string;
  service: string;              // For filtering relevant variables
}

// UI Flow:
// 1. User sees "Use Saved Variable" toggle
// 2. If ON: Shows dropdown of saved environment variables
// 3. If OFF: Shows password input with "Save as Var" button
// 4. Variables are filtered by service type (openai, anthropic, etc.)
```

### Security Best Practices

| Practice | Implementation |
|----------|----------------|
| Never store plaintext | All credentials encrypted at rest |
| Use environment variables | Reference by ID, not value |
| Scope appropriately | Workspace vs project vs runtime |
| Audit access | Log all credential usage |
| Rotate regularly | Support for credential rotation |

---

## Workflow Execution

### Execution Flow

```typescript
interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

  // Trigger
  triggeredBy: 'user' | 'schedule' | 'webhook' | 'api';
  triggeredAt: string;

  // Input/Output
  input: Record<string, any>;
  output?: Record<string, any>;

  // Execution Details
  nodeExecutions: NodeExecution[];

  // Timing
  startedAt?: string;
  completedAt?: string;
  duration?: number;            // Milliseconds

  // Error
  error?: {
    nodeId: string;
    message: string;
    stack?: string;
  };
}

interface NodeExecution {
  nodeId: string;
  nodeType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input: Record<string, any>;
  output?: Record<string, any>;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  error?: string;
}
```

### Execution Modes

| Mode | Description |
|------|-------------|
| **Synchronous** | Wait for complete execution, return result |
| **Asynchronous** | Return immediately, poll for result |
| **Streaming** | Stream intermediate results in real-time |

### AI Agent Decision Loop

```
┌─────────────────────────────────────────────────────────────┐
│                  AI AGENT DECISION LOOP                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   while (not complete && iterations < maxIterations) {       │
│                                                              │
│     1. OBSERVE                                               │
│        └─► Current state, previous results, context          │
│                                                              │
│     2. THINK (via LLM)                                       │
│        └─► "What should I do next?"                          │
│        └─► "Which node will help achieve the goal?"          │
│                                                              │
│     3. ACT                                                   │
│        └─► Execute selected node                             │
│        └─► Capture result                                    │
│                                                              │
│     4. UPDATE                                                │
│        └─► Store result in context                           │
│        └─► Update memory if needed                           │
│        └─► Check if goal achieved                            │
│                                                              │
│   }                                                          │
│                                                              │
│   return finalResult;                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Documentation System

### Overview

Zygo provides 40 comprehensive documentation pages accessible from both the dashboard and publicly.

### Documentation Categories

| Category | Pages | Description |
|----------|-------|-------------|
| **Getting Started** | 3 | Installation, concepts, first node |
| **Node Creation** | 3 | AI-assisted, templates, advanced config |
| **Workflow & Agents** | 3 | Creating workflows, agents, patterns |
| **API & Development** | 4 | API reference, SDK, CLI, React hooks |
| **Operations** | 6 | Infrastructure, networking, storage, monitoring |
| **Security & Compliance** | 4 | Security model, secrets, multi-tenancy |
| **Performance** | 2 | Scaling, tuning |
| **Reliability** | 4 | Error handling, debugging, patterns |
| **Testing & CI/CD** | 3 | Unit testing, integration, CI/CD |
| **Advanced Topics** | 4 | Middleware, streaming, legacy, versioning |
| **Reference** | 4 | Glossary, tokens, webhooks, changelog |

### Complete Documentation Inventory

#### Getting Started (3 pages)
1. **Installation & Setup** - Platform setup and configuration
2. **Core Concepts** - Understanding Zygo fundamentals
3. **Your First Node** - Hands-on tutorial

#### Node Creation (3 pages)
4. **AI-Assisted Creation** - Using AI to build nodes
5. **Node Templates** - Pre-built templates and examples
6. **Advanced Configuration** - Complex node configurations

#### Workflow & Agents (3 pages)
7. **Creating Workflows** - Visual workflow building
8. **Creating Agents** - AI Agent configuration
9. **Integration Patterns** - Common integration approaches

#### API & Development (4 pages)
10. **API Reference** - Complete API documentation
11. **SDK Code Examples** - JavaScript/Python examples
12. **CLI Reference** - Command-line interface
13. **React Hooks** - Frontend integration hooks

#### Operations & Infrastructure (6 pages)
14. **Control & Data Plane** - Architecture overview
15. **Platform Infrastructure** - Deployment options
16. **Networking & Firewalls** - Network configuration
17. **Storage Volumes** - Data persistence
18. **Monitoring & Observability** - Metrics and logging
19. **Migration Guide** - Platform migration

#### Security & Compliance (4 pages)
20. **Security Best Practices** - Security guidelines
21. **Security Model** - Authentication, authorization
22. **Secrets Management** - Credential handling
23. **Multi-Tenancy** - Tenant isolation

#### Performance & Scaling (2 pages)
24. **Scaling & Performance** - Horizontal scaling
25. **Performance Tuning** - Optimization techniques

#### Reliability & Quality (4 pages)
26. **Reliability Patterns** - Fault tolerance
27. **Error Handling Patterns** - Exception management
28. **Error Codes Reference** - Complete error catalog
29. **Debugging Techniques** - Troubleshooting

#### Testing & CI/CD (3 pages)
30. **Integration Testing** - End-to-end testing
31. **Unit Testing** - Component testing
32. **CI/CD Integration** - Automation pipelines

#### Advanced Topics (4 pages)
33. **Custom Middleware** - Extending functionality
34. **Streaming & SSE** - Real-time communication
35. **Legacy System Integration** - Enterprise systems
36. **Versioning Strategy** - API versioning

#### Reference & Learning (4 pages)
37. **Glossary** - Term definitions
38. **Token Economics** - Usage and billing
39. **Webhooks & Events** - Event system
40. **Changelog** - Version history

### Documentation Access

```typescript
// Internal Access (requires authentication)
interface InternalDocumentation {
  path: '/documentation';
  requiresAuth: true;
  features: [
    'Categorized navigation',
    'Full-text search',
    'Role-based access',
    'Reading progress',
    'Bookmarking'
  ];
}

// Public Access (no authentication)
interface PublicDocumentation {
  path: '/docs';
  requiresAuth: false;
  features: [
    'Featured articles',
    'Category browsing',
    'Search',
    'SEO optimized',
    'Mobile responsive'
  ];
}
```

---

## Permissions

### Workflow Permissions

```typescript
interface WorkflowPermissions {
  // CRUD
  canViewWorkflows: boolean;
  canCreateWorkflows: boolean;
  canEditWorkflows: boolean;
  canDeleteWorkflows: boolean;

  // Execution
  canExecuteWorkflows: boolean;
  canScheduleWorkflows: boolean;
  canDebugWorkflows: boolean;

  // Monitoring
  canViewWorkflowLogs: boolean;
}
```

### AI Component Permissions

```typescript
interface AIComponentPermissions {
  // Viewing
  canViewAIComponents: boolean;
  canViewAIAgents: boolean;
  canViewNodes: boolean;
  canViewTemplates: boolean;

  // Management
  canCreateAIComponents: boolean;
  canEditAIComponents: boolean;
  canDeleteAIComponents: boolean;

  // Deployment
  canDeployAIComponents: boolean;
  canTrainModels: boolean;

  // API Access
  canAccessAIAPI: boolean;
  canViewAIMetrics: boolean;
}
```

### Role Permission Matrix

| Permission | Owner | Admin | Developer | Member | Viewer |
|------------|-------|-------|-----------|--------|--------|
| View Workflows | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create Workflows | ✓ | ✓ | ✓ | ✗ | ✗ |
| Edit Workflows | ✓ | ✓ | ✓ | ✗ | ✗ |
| Delete Workflows | ✓ | ✓ | ✗ | ✗ | ✗ |
| Execute Workflows | ✓ | ✓ | ✓ | ✓ | ✗ |
| Schedule Workflows | ✓ | ✓ | ✓ | ✗ | ✗ |
| View Logs | ✓ | ✓ | ✓ | ✓ | ✓ |
| Debug Workflows | ✓ | ✓ | ✓ | ✗ | ✗ |
| Create AI Components | ✓ | ✓ | ✓ | ✗ | ✗ |
| Deploy AI Components | ✓ | ✓ | ✓ | ✗ | ✗ |
| Train Models | ✓ | ✓ | ✓ | ✗ | ✗ |

---

## API Endpoints

### Workflow Endpoints

```yaml
# List workflows
GET /api/v1/workflows
  Query: status, search, limit, offset

# Create workflow
POST /api/v1/workflows
  Body: { name, description, nodes, edges }

# Get workflow
GET /api/v1/workflows/{id}

# Update workflow
PATCH /api/v1/workflows/{id}
  Body: { name?, description?, nodes?, edges?, status? }

# Delete workflow
DELETE /api/v1/workflows/{id}

# Duplicate workflow
POST /api/v1/workflows/{id}/duplicate

# Execute workflow
POST /api/v1/workflows/{id}/execute
  Body: { input, mode: 'sync' | 'async' }

# Get execution status
GET /api/v1/workflows/{id}/executions/{executionId}

# List executions
GET /api/v1/workflows/{id}/executions
  Query: status, limit, offset

# Cancel execution
POST /api/v1/workflows/{id}/executions/{executionId}/cancel
```

### Node Endpoints

```yaml
# List available node types
GET /api/v1/nodes/types

# Get node type configuration schema
GET /api/v1/nodes/types/{type}/schema

# List node templates
GET /api/v1/nodes/templates
  Query: category, search

# Get node template
GET /api/v1/nodes/templates/{id}
```

### AI Generation Endpoints

```yaml
# Generate workflow from prompt
POST /api/v1/workflows/generate
  Body: { prompt, context? }

# Generate node configuration
POST /api/v1/nodes/generate
  Body: { nodeType, description }

# Optimize workflow
POST /api/v1/workflows/{id}/optimize
  Body: { optimizationGoal: 'performance' | 'cost' | 'reliability' }
```

### Documentation Endpoints

```yaml
# List documentation pages
GET /api/v1/documentation
  Query: category, search

# Get documentation page
GET /api/v1/documentation/{slug}

# Public documentation
GET /api/v1/public/documentation
GET /api/v1/public/documentation/{slug}
```

---

## Database Schema

### workflows Table

```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT,

  -- Definition
  nodes JSONB NOT NULL DEFAULT '[]',
  edges JSONB NOT NULL DEFAULT '[]',

  -- Status
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),

  -- Version Control
  version INTEGER DEFAULT 1,
  published_version INTEGER,

  -- Metadata
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_workflow_slug UNIQUE (tenant_id, slug)
);

-- Indexes
CREATE INDEX idx_workflows_tenant ON workflows(tenant_id);
CREATE INDEX idx_workflows_status ON workflows(tenant_id, status);
CREATE INDEX idx_workflows_created ON workflows(tenant_id, created_at DESC);

-- RLS
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflows_tenant_isolation ON workflows
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
```

### workflow_versions Table

```sql
CREATE TABLE workflow_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Version
  version INTEGER NOT NULL,
  nodes JSONB NOT NULL,
  edges JSONB NOT NULL,

  -- Metadata
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_note TEXT,

  CONSTRAINT unique_workflow_version UNIQUE (workflow_id, version)
);

-- RLS
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_versions_tenant_isolation ON workflow_versions
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

### workflow_executions Table

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),

  -- Trigger
  triggered_by TEXT NOT NULL
    CHECK (triggered_by IN ('user', 'schedule', 'webhook', 'api')),
  trigger_user_id UUID REFERENCES users(id),

  -- Input/Output
  input JSONB,
  output JSONB,

  -- Timing
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error
  error JSONB
);

-- Indexes
CREATE INDEX idx_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX idx_executions_status ON workflow_executions(tenant_id, status);
CREATE INDEX idx_executions_time ON workflow_executions(tenant_id, triggered_at DESC);

-- RLS
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY executions_tenant_isolation ON workflow_executions
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

### node_executions Table

```sql
CREATE TABLE node_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Node Reference
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

  -- Input/Output
  input JSONB,
  output JSONB,

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error
  error TEXT
);

-- Indexes
CREATE INDEX idx_node_exec_execution ON node_executions(execution_id);

-- RLS
ALTER TABLE node_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY node_executions_tenant_isolation ON node_executions
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

### node_types Table (Global)

```sql
CREATE TABLE node_types (
  id TEXT PRIMARY KEY,

  -- Definition
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  category TEXT NOT NULL,

  -- Configuration Schema
  config_schema JSONB NOT NULL,
  default_config JSONB NOT NULL,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_beta BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Note: Global table, not tenant-scoped
```

### workflow_schedules Table

```sql
CREATE TABLE workflow_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Schedule
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('interval', 'cron', 'once')),
  cron_expression TEXT,
  interval_seconds INTEGER,
  once_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Execution
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE workflow_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY schedules_tenant_isolation ON workflow_schedules
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

### documentation_pages Table (Global)

```sql
CREATE TABLE documentation_pages (
  id TEXT PRIMARY KEY,

  -- Content
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,

  -- Metadata
  read_time INTEGER,            -- Minutes
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_public BOOLEAN DEFAULT TRUE,

  -- SEO
  meta_description TEXT,
  keywords TEXT[],

  -- Order
  sort_order INTEGER DEFAULT 0
);

-- Note: Global table, not tenant-scoped
```

---

## Implementation Checklist

### Backend Requirements

- [ ] Workflow CRUD endpoints
- [ ] Workflow execution engine
- [ ] AI Agent orchestration loop
- [ ] Node type registry
- [ ] Execution state management
- [ ] Schedule/cron execution
- [ ] Webhook trigger handling
- [ ] Credential resolution from env vars
- [ ] Audit logging for executions

### Database Requirements

- [ ] workflows table with RLS
- [ ] workflow_versions table
- [ ] workflow_executions table
- [ ] node_executions table
- [ ] workflow_schedules table
- [ ] node_types global table
- [ ] documentation_pages global table

### Security Requirements

- [ ] Tenant isolation for workflows
- [ ] Permission enforcement
- [ ] Credential encryption
- [ ] Execution sandboxing
- [ ] Rate limiting per tenant

---

## Contact

- **Platform Team:** platform@zygo.tech
- **Documentation Team:** docs@zygo.tech
- **API Support:** api@zygo.tech
