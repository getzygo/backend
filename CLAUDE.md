# Backend - Claude Code Context

## Project Overview

| Item | Value |
|------|-------|
| **Repository** | backend |
| **Framework** | Hono 4.x + TypeScript |
| **Domain** | api.zygo.tech |
| **Server** | 178.156.195.2 |
| **Deploy Path** | /opt/zygo/backend/ |
| **Process Manager** | PM2 (zygo-api) |

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Hono (fast, lightweight)
- **Database**: PostgreSQL 16 + Drizzle ORM
- **Cache**: Redis + ioredis
- **Auth**: Supabase + JWT

## Build & Deploy

Deployments are automatic via GitHub Actions on push to `main`.

```bash
# Local development
npm run dev

# Build for production
npm run build

# Type check
npm run typecheck
```

## API Structure

Base URL: `https://api.zygo.tech/api/v1`

All routes are mounted under `/api/v1` in `src/app.ts`.

## Key Directories

```
src/
├── app.ts           # Hono app with middleware
├── index.ts         # Server entry point
├── config/          # Environment configuration
├── db/              # Database client, Redis
├── routes/          # API route handlers
└── middleware/      # Custom middleware

contracts/           # Documentation
├── api_contract.yaml
├── db_contract.md
├── AUTHENTICATION.md
└── ...
```

## Environment Variables

Key variables (see contracts/.env.example):
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `JWT_SECRET` - JWT signing secret
- `SUPABASE_URL` - Supabase project URL

## Domain Structure

| Domain | Purpose |
|--------|---------|
| `api.zygo.tech` | This backend API |
| `*.zygo.tech` | Tenant frontends |
| `admin.zygo.tech` | Admin panel |
| `getzygo.com` | Landing page |

## Database Access

### Production Database

The production PostgreSQL runs in Docker on `178.156.195.2` (self-hosted Supabase).

```bash
# Connect to database
ssh root@178.156.195.2 "docker exec -it supabase-db psql -U postgres -d postgres"

# Run SQL command
ssh root@178.156.195.2 "docker exec -i supabase-db psql -U postgres -d postgres -c 'SELECT count(*) FROM users;'"

# Apply Drizzle migration
npm run db:generate
ssh root@178.156.195.2 "docker exec -i supabase-db psql -U postgres -d postgres" < drizzle/XXXX_migration.sql
```

### Supabase Studio

Access at: https://studio.zygo.tech

### Docker Containers

Key containers on 178.156.195.2:
- `supabase-db` - PostgreSQL 15
- `supabase-rest` - PostgREST API
- `supabase-auth` - GoTrue
- `supabase-kong` - API Gateway

## Related Repos

| Repo | Purpose | Editable |
|------|---------|----------|
| tenant | Tenant dashboard | EDITABLE |
| admin | Admin panel | EDITABLE |
| landing | Landing page | READ-ONLY |
