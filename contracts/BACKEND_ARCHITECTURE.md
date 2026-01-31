# Backend Architecture

**Version:** 1.0.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready
**Stack:** Hono + Supabase Edge Functions + PostgreSQL

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Hono Application](#hono-application)
5. [Database Layer](#database-layer)
6. [Authentication & Authorization](#authentication--authorization)
7. [Background Jobs](#background-jobs)
8. [WebSocket Layer](#websocket-layer)
9. [Error Handling](#error-handling)
10. [Validation & Schemas](#validation--schemas)
11. [Dependency Injection](#dependency-injection)
12. [Testing Strategy](#testing-strategy)
13. [Environment Configuration](#environment-configuration)

---

## Overview

### Architecture Principles

| Principle | Implementation |
|-----------|----------------|
| **TypeScript First** | End-to-end type safety with Zod validation |
| **Clean Architecture** | Separation of concerns (routes → services → repositories) |
| **Dependency Injection** | Testable, loosely coupled components |
| **API-First** | OpenAPI specification drives implementation |
| **Security by Default** | RLS, RBAC, rate limiting on all endpoints |

### Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              REQUEST FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Client Request                                                              │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐   │
│  │  Nginx  │───▶│  Hono   │───▶│ Middle- │───▶│ Route   │───▶│ Service │   │
│  │ Reverse │    │   App   │    │  ware   │    │ Handler │    │  Layer  │   │
│  │  Proxy  │    │         │    │  Stack  │    │         │    │         │   │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘   │
│                                     │                              │         │
│                                     │                              ▼         │
│                              ┌──────┴──────┐               ┌─────────────┐  │
│                              │ • Logger    │               │ Repository  │  │
│                              │ • Auth      │               │    Layer    │  │
│                              │ • RateLimit │               │ (Drizzle)   │  │
│                              │ • Validate  │               └──────┬──────┘  │
│                              │ • Tenant    │                      │         │
│                              │ • RBAC      │                      ▼         │
│                              └─────────────┘               ┌─────────────┐  │
│                                                            │  Supabase   │  │
│                                                            │ PostgreSQL  │  │
│                                                            └─────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Core Technologies

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Runtime** | Node.js 20 LTS | JavaScript runtime |
| **Framework** | Hono 4.x | Fast, lightweight web framework |
| **Language** | TypeScript 5.x | Type safety |
| **Database** | PostgreSQL 15 | Primary data store |
| **ORM** | Drizzle ORM | Type-safe SQL queries |
| **Validation** | Zod | Runtime validation + TypeScript inference |
| **Auth** | Supabase Auth | JWT, OAuth, MFA |
| **Queue** | BullMQ + Redis | Background job processing |
| **WebSocket** | Hono WebSocket | Real-time communication |
| **Cache** | Redis | Caching, rate limiting, sessions |

### Supporting Libraries

```json
{
  "dependencies": {
    "@hono/node-server": "^1.8.0",
    "@hono/zod-openapi": "^0.9.0",
    "@hono/zod-validator": "^0.2.0",
    "hono": "^4.0.0",
    "drizzle-orm": "^0.29.0",
    "postgres": "^3.4.0",
    "zod": "^3.22.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.3.0",
    "@supabase/supabase-js": "^2.39.0",
    "pino": "^8.17.0",
    "pino-pretty": "^10.3.0",
    "dotenv": "^16.3.0",
    "nanoid": "^5.0.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0",
    "drizzle-kit": "^0.20.0",
    "vitest": "^1.1.0",
    "@vitest/coverage-v8": "^1.1.0",
    "tsx": "^4.7.0",
    "tsup": "^8.0.0"
  }
}
```

---

## Project Structure

```
zygo-backend/
├── src/
│   ├── index.ts                    # Application entry point
│   ├── app.ts                      # Hono app configuration
│   │
│   ├── config/
│   │   ├── index.ts                # Configuration loader
│   │   ├── database.ts             # Database configuration
│   │   ├── redis.ts                # Redis configuration
│   │   └── env.ts                  # Environment validation (Zod)
│   │
│   ├── routes/
│   │   ├── index.ts                # Route aggregator
│   │   ├── health.ts               # Health check endpoints
│   │   │
│   │   ├── auth/
│   │   │   ├── index.ts            # Auth route group
│   │   │   ├── login.ts            # POST /auth/login
│   │   │   ├── signup.ts           # POST /auth/signup
│   │   │   ├── logout.ts           # POST /auth/logout
│   │   │   ├── refresh.ts          # POST /auth/refresh
│   │   │   ├── mfa.ts              # MFA endpoints
│   │   │   ├── oauth.ts            # OAuth endpoints
│   │   │   └── password.ts         # Password reset flow
│   │   │
│   │   ├── users/
│   │   │   ├── index.ts
│   │   │   ├── list.ts             # GET /users
│   │   │   ├── get.ts              # GET /users/:id
│   │   │   ├── create.ts           # POST /users
│   │   │   ├── update.ts           # PATCH /users/:id
│   │   │   └── delete.ts           # DELETE /users/:id
│   │   │
│   │   ├── roles/
│   │   ├── tenants/
│   │   ├── workflows/
│   │   ├── infrastructure/
│   │   │   ├── servers/
│   │   │   ├── volumes/
│   │   │   ├── networks/
│   │   │   └── firewalls/
│   │   ├── secrets/
│   │   ├── webhooks/
│   │   ├── billing/
│   │   ├── compliance/
│   │   ├── audit/
│   │   └── admin/                  # Global admin endpoints
│   │
│   ├── middleware/
│   │   ├── index.ts                # Middleware aggregator
│   │   ├── logger.ts               # Request logging
│   │   ├── auth.ts                 # JWT verification
│   │   ├── tenant.ts               # Tenant context injection
│   │   ├── rbac.ts                 # Permission checking
│   │   ├── rate-limit.ts           # Rate limiting
│   │   ├── validate.ts             # Request validation
│   │   ├── error-handler.ts        # Global error handler
│   │   └── request-id.ts           # Request ID generation
│   │
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── user.service.ts
│   │   ├── role.service.ts
│   │   ├── tenant.service.ts
│   │   ├── workflow.service.ts
│   │   ├── workflow-execution.service.ts
│   │   ├── server.service.ts
│   │   ├── secret.service.ts
│   │   ├── webhook.service.ts
│   │   ├── billing.service.ts
│   │   ├── audit.service.ts
│   │   └── notification.service.ts
│   │
│   ├── repositories/
│   │   ├── base.repository.ts      # Base repository with common methods
│   │   ├── user.repository.ts
│   │   ├── role.repository.ts
│   │   ├── tenant.repository.ts
│   │   ├── workflow.repository.ts
│   │   ├── server.repository.ts
│   │   └── audit.repository.ts
│   │
│   ├── db/
│   │   ├── index.ts                # Database client
│   │   ├── schema/                 # Drizzle schema definitions
│   │   │   ├── index.ts
│   │   │   ├── tenants.ts
│   │   │   ├── users.ts
│   │   │   ├── roles.ts
│   │   │   ├── workflows.ts
│   │   │   ├── infrastructure.ts
│   │   │   └── audit.ts
│   │   └── migrations/             # Drizzle migrations
│   │
│   ├── jobs/
│   │   ├── index.ts                # Job registry
│   │   ├── queues.ts               # Queue definitions
│   │   ├── workers/
│   │   │   ├── tenant-deletion.worker.ts
│   │   │   ├── user-deletion.worker.ts
│   │   │   ├── workflow-execution.worker.ts
│   │   │   ├── archive.worker.ts
│   │   │   └── notification.worker.ts
│   │   └── processors/
│   │       ├── tenant-deletion.processor.ts
│   │       └── workflow.processor.ts
│   │
│   ├── ws/
│   │   ├── index.ts                # WebSocket server
│   │   ├── handlers/
│   │   │   ├── execution.handler.ts
│   │   │   └── notification.handler.ts
│   │   └── rooms.ts                # Room management
│   │
│   ├── schemas/
│   │   ├── index.ts                # Schema exports
│   │   ├── common.ts               # Shared schemas (pagination, etc.)
│   │   ├── auth.schema.ts
│   │   ├── user.schema.ts
│   │   ├── role.schema.ts
│   │   ├── tenant.schema.ts
│   │   ├── workflow.schema.ts
│   │   ├── server.schema.ts
│   │   └── error.schema.ts
│   │
│   ├── types/
│   │   ├── index.ts
│   │   ├── context.ts              # Hono context types
│   │   ├── auth.ts
│   │   └── env.ts
│   │
│   ├── lib/
│   │   ├── supabase.ts             # Supabase client
│   │   ├── redis.ts                # Redis client
│   │   ├── crypto.ts               # Encryption utilities
│   │   ├── hash.ts                 # Hashing utilities
│   │   └── logger.ts               # Pino logger
│   │
│   └── utils/
│       ├── api-response.ts         # Standardized responses
│       ├── errors.ts               # Custom error classes
│       ├── pagination.ts           # Pagination helpers
│       ├── slug.ts                 # Slug generation
│       └── transform.ts            # snake_case ↔ camelCase
│
├── supabase/
│   └── functions/                  # Edge Functions
│       ├── on-user-signup/
│       │   └── index.ts
│       ├── on-auth-hook/
│       │   └── index.ts
│       └── realtime-auth/
│           └── index.ts
│
├── tests/
│   ├── setup.ts                    # Test setup
│   ├── factories/                  # Test data factories
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── scripts/
│   ├── migrate.ts                  # Run migrations
│   ├── seed.ts                     # Seed database
│   └── generate-types.ts           # Generate types from DB
│
├── contracts/                      # Synced from zygo-ui/contracts
│
├── .env.example
├── .env.development
├── .env.production
├── drizzle.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## Hono Application

### Entry Point

```typescript
// src/index.ts
import { serve } from '@hono/node-server';
import { app } from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { initializeQueues } from './jobs';
import { initializeWebSocket } from './ws';

async function bootstrap() {
  // Initialize background job queues
  await initializeQueues();

  // Start HTTP server
  const server = serve({
    fetch: app.fetch,
    port: config.port,
  });

  // Initialize WebSocket
  initializeWebSocket(server);

  logger.info(`Server running on http://localhost:${config.port}`);
  logger.info(`Environment: ${config.env}`);
}

bootstrap().catch((error) => {
  logger.fatal(error, 'Failed to start server');
  process.exit(1);
});
```

### Application Setup

```typescript
// src/app.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';
import { requestId } from 'hono/request-id';

import { routes } from './routes';
import {
  loggerMiddleware,
  errorHandler,
  notFoundHandler,
} from './middleware';
import type { AppContext } from './types/context';

// Create Hono app with typed context
export const app = new Hono<AppContext>();

// Global middleware
app.use('*', requestId());
app.use('*', timing());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'https://app.zygo.tech',
      'https://admin.zygo.tech',
    ];
    if (process.env.NODE_ENV === 'development') {
      allowed.push('http://localhost:5173');
    }
    return allowed.includes(origin) ? origin : null;
  },
  credentials: true,
}));
app.use('*', loggerMiddleware);

// Mount routes
app.route('/', routes);

// Error handlers
app.onError(errorHandler);
app.notFound(notFoundHandler);
```

### Typed Context

```typescript
// src/types/context.ts
import type { Context } from 'hono';

export interface AuthUser {
  id: string;
  email: string;
  tenantId: string;
  role: string;
  permissions: string[];
  isGlobalAdmin: boolean;
}

export interface TenantContext {
  id: string;
  slug: string;
  plan: string;
  settings: Record<string, unknown>;
}

export interface AppVariables {
  requestId: string;
  user?: AuthUser;
  tenant?: TenantContext;
}

export interface AppBindings {
  // Environment bindings if needed
}

export type AppContext = {
  Variables: AppVariables;
  Bindings: AppBindings;
};

export type AppHonoContext = Context<AppContext>;
```

---

## Database Layer

### Drizzle Configuration

```typescript
// drizzle.config.ts
import type { Config } from 'drizzle-kit';
import { config } from './src/config';

export default {
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: config.databaseUrl,
  },
  verbose: true,
  strict: true,
} satisfies Config;
```

### Database Client

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import * as schema from './schema';

// Create postgres client with connection pooling
const client = postgres(config.databaseUrl, {
  max: config.databasePoolMax,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Create drizzle instance with schema
export const db = drizzle(client, { schema });

// Export for raw queries if needed
export { client as sql };
```

### Schema Example

```typescript
// src/db/schema/users.ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenants';
import { userRoles } from './roles';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  email: varchar('email', { length: 255 }).notNull(),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  displayName: varchar('display_name', { length: 200 }),
  avatar: text('avatar'),
  phone: varchar('phone', { length: 20 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  emailVerified: boolean('email_verified').notNull().default(false),
  phoneVerified: boolean('phone_verified').notNull().default(false),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  tenantIdx: index('users_tenant_idx').on(table.tenantId),
  emailIdx: index('users_email_idx').on(table.email),
  statusIdx: index('users_status_idx').on(table.status),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  roles: many(userRoles),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

### Repository Pattern

```typescript
// src/repositories/base.repository.ts
import { db } from '../db';
import type { PgTable } from 'drizzle-orm/pg-core';
import { eq, and, isNull, sql } from 'drizzle-orm';

export abstract class BaseRepository<T extends PgTable> {
  constructor(
    protected table: T,
    protected tenantColumn?: keyof T['_']['columns']
  ) {}

  protected withTenant(tenantId: string) {
    if (!this.tenantColumn) return undefined;
    return eq(this.table[this.tenantColumn as any], tenantId);
  }

  protected notDeleted() {
    if ('deletedAt' in this.table) {
      return isNull((this.table as any).deletedAt);
    }
    return undefined;
  }
}
```

```typescript
// src/repositories/user.repository.ts
import { db } from '../db';
import { users, type User, type NewUser } from '../db/schema/users';
import { eq, and, isNull, ilike, or } from 'drizzle-orm';
import { BaseRepository } from './base.repository';

export class UserRepository extends BaseRepository<typeof users> {
  constructor() {
    super(users, 'tenantId');
  }

  async findById(id: string, tenantId: string): Promise<User | null> {
    const result = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, id),
          eq(users.tenantId, tenantId),
          isNull(users.deletedAt)
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  async findByEmail(email: string, tenantId: string): Promise<User | null> {
    const result = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.email, email.toLowerCase()),
          eq(users.tenantId, tenantId),
          isNull(users.deletedAt)
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  async findAll(
    tenantId: string,
    options: {
      search?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ data: User[]; total: number }> {
    const { search, status, limit = 20, offset = 0 } = options;

    const conditions = [
      eq(users.tenantId, tenantId),
      isNull(users.deletedAt),
    ];

    if (status) {
      conditions.push(eq(users.status, status));
    }

    if (search) {
      conditions.push(
        or(
          ilike(users.email, `%${search}%`),
          ilike(users.firstName, `%${search}%`),
          ilike(users.lastName, `%${search}%`)
        )!
      );
    }

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(users)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset)
        .orderBy(users.createdAt),
      db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(...conditions)),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async create(data: NewUser): Promise<User> {
    const result = await db
      .insert(users)
      .values({
        ...data,
        email: data.email.toLowerCase(),
      })
      .returning();

    return result[0];
  }

  async update(id: string, tenantId: string, data: Partial<NewUser>): Promise<User | null> {
    const result = await db
      .update(users)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, id),
          eq(users.tenantId, tenantId),
          isNull(users.deletedAt)
        )
      )
      .returning();

    return result[0] ?? null;
  }

  async softDelete(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .update(users)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, id),
          eq(users.tenantId, tenantId),
          isNull(users.deletedAt)
        )
      )
      .returning({ id: users.id });

    return result.length > 0;
  }
}

export const userRepository = new UserRepository();
```

---

## Authentication & Authorization

### Auth Middleware

```typescript
// src/middleware/auth.ts
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import type { AppContext, AuthUser } from '../types/context';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, {
      message: 'Missing or invalid authorization header',
    });
  }

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new HTTPException(401, { message: 'Invalid or expired token' });
    }

    // Get user's tenant and permissions from database
    const userData = await getUserWithPermissions(user.id);

    if (!userData) {
      throw new HTTPException(401, { message: 'User not found' });
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email!,
      tenantId: userData.tenantId,
      role: userData.role,
      permissions: userData.permissions,
      isGlobalAdmin: userData.isGlobalAdmin,
    };

    c.set('user', authUser);

    await next();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(401, { message: 'Authentication failed' });
  }
});

// Optional auth - doesn't fail if no token
export const optionalAuth = createMiddleware<AppContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabase.auth.getUser(token);

      if (user) {
        const userData = await getUserWithPermissions(user.id);
        if (userData) {
          c.set('user', {
            id: user.id,
            email: user.email!,
            tenantId: userData.tenantId,
            role: userData.role,
            permissions: userData.permissions,
            isGlobalAdmin: userData.isGlobalAdmin,
          });
        }
      }
    } catch {
      // Ignore auth errors for optional auth
    }
  }

  await next();
});
```

### RBAC Middleware

```typescript
// src/middleware/rbac.ts
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../types/context';

type PermissionCheck = string | string[] | ((permissions: string[]) => boolean);

export const requirePermission = (check: PermissionCheck) => {
  return createMiddleware<AppContext>(async (c, next) => {
    const user = c.get('user');

    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }

    // Global admins bypass permission checks
    if (user.isGlobalAdmin) {
      await next();
      return;
    }

    let hasPermission = false;

    if (typeof check === 'string') {
      hasPermission = user.permissions.includes(check);
    } else if (Array.isArray(check)) {
      hasPermission = check.some((p) => user.permissions.includes(p));
    } else if (typeof check === 'function') {
      hasPermission = check(user.permissions);
    }

    if (!hasPermission) {
      throw new HTTPException(403, {
        message: 'Insufficient permissions',
      });
    }

    await next();
  });
};

// Common permission helpers
export const canManageUsers = requirePermission('canManageUsers');
export const canManageRoles = requirePermission('canManageRoles');
export const canManageBilling = requirePermission('canManageBilling');
export const canManageServers = requirePermission('canManageServers');
export const canViewAuditLogs = requirePermission('canViewAuditLogs');
```

### Tenant Middleware

```typescript
// src/middleware/tenant.ts
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../types/context';
import { tenantRepository } from '../repositories/tenant.repository';

export const tenantMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const user = c.get('user');

  if (!user) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  // Global admins accessing tenant-specific endpoints need tenant header
  if (user.isGlobalAdmin) {
    const tenantHeader = c.req.header('X-Tenant-ID');
    if (tenantHeader) {
      const tenant = await tenantRepository.findById(tenantHeader);
      if (tenant) {
        c.set('tenant', {
          id: tenant.id,
          slug: tenant.slug,
          plan: tenant.plan,
          settings: tenant.settings,
        });
      }
    }
    await next();
    return;
  }

  // Regular users - get tenant from their profile
  const tenant = await tenantRepository.findById(user.tenantId);

  if (!tenant) {
    throw new HTTPException(403, { message: 'Tenant not found or inactive' });
  }

  if (tenant.status !== 'active') {
    throw new HTTPException(403, { message: 'Tenant is suspended' });
  }

  c.set('tenant', {
    id: tenant.id,
    slug: tenant.slug,
    plan: tenant.plan,
    settings: tenant.settings,
  });

  await next();
});
```

---

## Background Jobs

### Queue Setup

```typescript
// src/jobs/queues.ts
import { Queue, Worker } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
  removeOnComplete: {
    age: 86400,
    count: 1000,
  },
  removeOnFail: {
    age: 604800,
  },
};

// Queue definitions
export const queues = {
  tenantDeletion: new Queue('tenant-deletion', {
    connection: redis,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 5,
    },
  }),

  userDeletion: new Queue('user-deletion', {
    connection: redis,
    defaultJobOptions,
  }),

  workflowExecution: new Queue('workflow-execution', {
    connection: redis,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 3,
    },
  }),

  notifications: new Queue('notifications', {
    connection: redis,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 3,
    },
  }),

  archive: new Queue('archive', {
    connection: redis,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 5,
    },
  }),
};

// Initialize all queues
export async function initializeQueues() {
  logger.info('Initializing job queues...');

  // Import and start workers
  const { tenantDeletionWorker } = await import('./workers/tenant-deletion.worker');
  const { userDeletionWorker } = await import('./workers/user-deletion.worker');
  const { workflowExecutionWorker } = await import('./workers/workflow-execution.worker');
  const { notificationWorker } = await import('./workers/notification.worker');

  logger.info('Job queues initialized');
}
```

### Worker Example

```typescript
// src/jobs/workers/tenant-deletion.worker.ts
import { Worker, Job } from 'bullmq';
import { redis } from '../../lib/redis';
import { logger } from '../../lib/logger';
import { TenantDeletionProcessor } from '../processors/tenant-deletion.processor';

interface TenantDeletionJob {
  tenantId: string;
  requestedBy: string;
  reason?: string;
}

export const tenantDeletionWorker = new Worker<TenantDeletionJob>(
  'tenant-deletion',
  async (job: Job<TenantDeletionJob>) => {
    const { tenantId, requestedBy, reason } = job.data;
    const processor = new TenantDeletionProcessor(tenantId, requestedBy, reason);

    logger.info({ jobId: job.id, tenantId }, 'Starting tenant deletion');

    try {
      // Step 1: Verify request
      await job.updateProgress(5);
      await processor.verifyRequest();

      // Step 2: Notify users
      await job.updateProgress(10);
      await processor.notifyUsers();

      // Step 3: Soft delete tenant
      await job.updateProgress(20);
      await processor.softDeleteTenant();

      // Step 4: Revoke all access
      await job.updateProgress(30);
      await processor.revokeAccess();

      // Step 5-11: Archive data (bulk of work)
      await job.updateProgress(40);
      await processor.archiveData((progress) => {
        job.updateProgress(40 + (progress * 0.5));
      });

      // Step 12: Complete
      await job.updateProgress(100);
      await processor.complete();

      logger.info({ jobId: job.id, tenantId }, 'Tenant deletion completed');

      return { success: true, tenantId };
    } catch (error) {
      logger.error({ jobId: job.id, tenantId, error }, 'Tenant deletion failed');
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 60000,
    },
  }
);

tenantDeletionWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Tenant deletion job completed');
});

tenantDeletionWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, error }, 'Tenant deletion job failed');
});
```

---

## WebSocket Layer

### WebSocket Server

```typescript
// src/ws/index.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { logger } from '../lib/logger';
import { verifyWebSocketToken } from './auth';
import { ExecutionHandler } from './handlers/execution.handler';

interface ClientInfo {
  userId: string;
  tenantId: string;
  rooms: Set<string>;
}

const clients = new Map<WebSocket, ClientInfo>();
const rooms = new Map<string, Set<WebSocket>>();

export function initializeWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    try {
      // Extract and verify token from query string
      const url = new URL(req.url!, `ws://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Missing authentication token');
        return;
      }

      const user = await verifyWebSocketToken(token);
      if (!user) {
        ws.close(4002, 'Invalid authentication token');
        return;
      }

      // Store client info
      clients.set(ws, {
        userId: user.id,
        tenantId: user.tenantId,
        rooms: new Set(),
      });

      logger.info({ userId: user.id }, 'WebSocket client connected');

      // Handle messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleMessage(ws, message);
        } catch (error) {
          logger.error({ error }, 'Failed to parse WebSocket message');
        }
      });

      ws.on('close', () => {
        const client = clients.get(ws);
        if (client) {
          // Leave all rooms
          client.rooms.forEach((room) => leaveRoom(ws, room));
          clients.delete(ws);
          logger.info({ userId: client.userId }, 'WebSocket client disconnected');
        }
      });

      // Send connection confirmation
      ws.send(JSON.stringify({ type: 'connected', userId: user.id }));
    } catch (error) {
      logger.error({ error }, 'WebSocket connection error');
      ws.close(4000, 'Connection error');
    }
  });

  logger.info('WebSocket server initialized');
}

function handleMessage(ws: WebSocket, message: any) {
  const client = clients.get(ws);
  if (!client) return;

  switch (message.type) {
    case 'subscribe':
      if (message.room) {
        joinRoom(ws, message.room);
      }
      break;

    case 'unsubscribe':
      if (message.room) {
        leaveRoom(ws, message.room);
      }
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    default:
      logger.warn({ type: message.type }, 'Unknown WebSocket message type');
  }
}

function joinRoom(ws: WebSocket, roomName: string) {
  const client = clients.get(ws);
  if (!client) return;

  // Validate room access (e.g., execution:exec_123 - check user has access)
  // For now, just allow tenant-scoped rooms
  if (!roomName.startsWith(`tenant:${client.tenantId}:`)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Access denied to room' }));
    return;
  }

  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }

  rooms.get(roomName)!.add(ws);
  client.rooms.add(roomName);

  ws.send(JSON.stringify({ type: 'subscribed', room: roomName }));
}

function leaveRoom(ws: WebSocket, roomName: string) {
  const client = clients.get(ws);
  if (!client) return;

  rooms.get(roomName)?.delete(ws);
  client.rooms.delete(roomName);

  if (rooms.get(roomName)?.size === 0) {
    rooms.delete(roomName);
  }
}

// Broadcast to a room
export function broadcastToRoom(roomName: string, message: any) {
  const roomClients = rooms.get(roomName);
  if (!roomClients) return;

  const payload = JSON.stringify(message);
  roomClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

// Broadcast to a specific user
export function broadcastToUser(userId: string, message: any) {
  const payload = JSON.stringify(message);
  clients.forEach((client, ws) => {
    if (client.userId === userId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}
```

---

## Error Handling

### Custom Errors

```typescript
// src/utils/errors.ts
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(404, 'RESOURCE_NOT_FOUND', `${resource}${id ? ` with ID ${id}` : ''} not found`);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'AUTH_UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, 'AUTH_FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'RESOURCE_CONFLICT', message);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests', { retryAfter });
    this.name = 'RateLimitError';
  }
}
```

### Error Handler Middleware

```typescript
// src/middleware/error-handler.ts
import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../lib/logger';
import type { AppContext } from '../types/context';

export const errorHandler: ErrorHandler<AppContext> = (err, c) => {
  const requestId = c.get('requestId') || 'unknown';

  // Zod validation errors
  if (err instanceof ZodError) {
    return c.json({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      statusCode: 400,
      timestamp: new Date().toISOString(),
      requestId,
      details: {
        issues: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      },
    }, 400);
  }

  // Custom app errors
  if (err instanceof AppError) {
    logger.warn({ err, requestId }, err.message);
    return c.json({
      error: err.code,
      message: err.message,
      statusCode: err.statusCode,
      timestamp: new Date().toISOString(),
      requestId,
      details: err.details,
    }, err.statusCode as any);
  }

  // Hono HTTP exceptions
  if (err instanceof HTTPException) {
    return c.json({
      error: 'HTTP_ERROR',
      message: err.message,
      statusCode: err.status,
      timestamp: new Date().toISOString(),
      requestId,
    }, err.status);
  }

  // Unknown errors
  logger.error({ err, requestId }, 'Unhandled error');
  return c.json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    statusCode: 500,
    timestamp: new Date().toISOString(),
    requestId,
  }, 500);
};

export const notFoundHandler = (c: any) => {
  return c.json({
    error: 'ROUTE_NOT_FOUND',
    message: `Route ${c.req.method} ${c.req.path} not found`,
    statusCode: 404,
    timestamp: new Date().toISOString(),
    requestId: c.get('requestId') || 'unknown',
  }, 404);
};
```

---

## Validation & Schemas

### Zod OpenAPI Integration

```typescript
// src/routes/users/list.ts
import { createRoute, z } from '@hono/zod-openapi';
import { Hono } from 'hono';
import type { AppContext } from '../../types/context';
import { authMiddleware } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/rbac';
import { userService } from '../../services/user.service';
import { UserSchema, PaginationSchema, ErrorSchema } from '../../schemas';

const querySchema = z.object({
  search: z.string().optional().openapi({ example: 'john' }),
  status: z.enum(['active', 'pending', 'suspended']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const responseSchema = z.object({
  data: z.array(UserSchema),
  pagination: PaginationSchema,
});

const route = createRoute({
  method: 'get',
  path: '/users',
  tags: ['Users'],
  summary: 'List users',
  description: 'Get a paginated list of users in the tenant',
  security: [{ bearerAuth: [] }],
  request: {
    query: querySchema,
  },
  responses: {
    200: {
      description: 'List of users',
      content: {
        'application/json': {
          schema: responseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

const app = new Hono<AppContext>();

app.use(authMiddleware);
app.use(tenantMiddleware);
app.use(requirePermission('canViewUsers'));

app.openapi(route, async (c) => {
  const tenant = c.get('tenant')!;
  const { search, status, page, limit } = c.req.valid('query');

  const result = await userService.listUsers(tenant.id, {
    search,
    status,
    page,
    limit,
  });

  return c.json({
    data: result.data,
    pagination: {
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
    },
  });
});

export default app;
```

---

## Testing Strategy

### Test Setup

```typescript
// tests/setup.ts
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { db, sql } from '../src/db';
import { redis } from '../src/lib/redis';

beforeAll(async () => {
  // Connect to test database
  await sql`SELECT 1`;
});

beforeEach(async () => {
  // Clean database before each test
  await sql`TRUNCATE users, tenants, roles CASCADE`;
});

afterAll(async () => {
  await sql.end();
  await redis.quit();
});
```

### Integration Test Example

```typescript
// tests/integration/users.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../../src/app';
import { createTestTenant, createTestUser, getAuthToken } from '../factories';

describe('Users API', () => {
  let tenant: any;
  let adminUser: any;
  let authToken: string;

  beforeEach(async () => {
    tenant = await createTestTenant();
    adminUser = await createTestUser(tenant.id, { role: 'admin' });
    authToken = await getAuthToken(adminUser);
  });

  describe('GET /api/v1/users', () => {
    it('should return paginated users', async () => {
      // Create some test users
      await createTestUser(tenant.id);
      await createTestUser(tenant.id);

      const res = await app.request('/api/v1/users', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(3); // admin + 2 users
      expect(body.pagination.total).toBe(3);
    });

    it('should filter by search term', async () => {
      await createTestUser(tenant.id, { email: 'john@example.com' });
      await createTestUser(tenant.id, { email: 'jane@example.com' });

      const res = await app.request('/api/v1/users?search=john', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].email).toBe('john@example.com');
    });

    it('should return 401 without auth', async () => {
      const res = await app.request('/api/v1/users');
      expect(res.status).toBe(401);
    });
  });
});
```

---

## Environment Configuration

### Environment Validation

```typescript
// src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string(),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_KEY: z.string(),

  // Redis
  REDIS_URL: z.string(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Encryption
  ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex

  // External services
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  HETZNER_API_KEY: z.string().optional(),

  // Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}
```

### Configuration Export

```typescript
// src/config/index.ts
import 'dotenv/config';
import { validateEnv } from './env';

const env = validateEnv();

export const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  appUrl: env.APP_URL,
  apiUrl: env.API_URL,

  // Database
  databaseUrl: env.DATABASE_URL,
  databasePoolMax: env.DATABASE_POOL_MAX,

  // Supabase
  supabaseUrl: env.SUPABASE_URL,
  supabaseAnonKey: env.SUPABASE_ANON_KEY,
  supabaseServiceKey: env.SUPABASE_SERVICE_KEY,

  // Redis
  redisUrl: env.REDIS_URL,

  // JWT
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,

  // Encryption
  encryptionKey: env.ENCRYPTION_KEY,

  // External services
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  },
  hetzner: {
    apiKey: env.HETZNER_API_KEY,
  },

  // Email
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.EMAIL_FROM,
  },

  // Flags
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
} as const;
```

---

## Changelog

### v1.0.0 (January 26, 2026)
- Initial backend architecture specification
- Hono framework setup with TypeScript
- Drizzle ORM database layer
- Authentication and RBAC middleware
- BullMQ background jobs
- WebSocket real-time layer
- Error handling patterns
- Testing strategy
- Environment configuration
