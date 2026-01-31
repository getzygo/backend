# Zygo Backend

Backend API server for Zygo - an enterprise-grade AI workflow automation platform.

## Tech Stack

- **Framework**: [Hono](https://hono.dev/) - Fast, lightweight web framework
- **Runtime**: Node.js 20+
- **Database**: PostgreSQL 16 + [Drizzle ORM](https://orm.drizzle.team/)
- **Cache**: Redis + ioredis
- **Auth**: Supabase + JWT

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp contracts/.env.example .env
# Edit .env with your values

# Run development server
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint |

## API Endpoints

Base URL: `https://api.zygo.tech/api/v1`

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /auth/login` | User authentication |
| `GET /tenants/:slug/config` | Tenant configuration |

See `contracts/api_contract.yaml` for full API specification.

## Project Structure

```
backend/
├── src/
│   ├── app.ts           # Hono app configuration
│   ├── index.ts         # Entry point
│   ├── config/          # Environment and configuration
│   ├── db/              # Database client and schemas
│   ├── routes/          # API route handlers
│   ├── middleware/      # Custom middleware
│   └── utils/           # Utility functions
├── contracts/           # API contracts and documentation
└── dist/               # Build output
```

## Environment Variables

See `contracts/.env.example` for all required environment variables.

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for JWT signing
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key

## Deployment

Deployments are handled automatically via GitHub Actions on push to `main`.

- **Server**: 178.156.195.2
- **Process Manager**: PM2
- **Domain**: api.zygo.tech (via Cloudflare Tunnel)

## Documentation

Detailed documentation is available in the `contracts/` directory:

- [API Contract](contracts/api_contract.yaml) - OpenAPI 3.1 specification
- [Database Schema](contracts/db_contract.md) - 65 tables with RLS
- [Authentication](contracts/AUTHENTICATION.md) - Auth flows and strategies
- [Backend Architecture](contracts/BACKEND_ARCHITECTURE.md) - Hono patterns
- [VPS Deployment](contracts/VPS_DEPLOYMENT.md) - Server setup guide

## Related Repositories

| Repo | Purpose |
|------|---------|
| [tenant](https://github.com/getzygo/tenant) | Tenant dashboard frontend |
| [admin](https://github.com/getzygo/admin) | Admin panel frontend |
| [landing](https://github.com/getzygo/landing) | Landing page |
