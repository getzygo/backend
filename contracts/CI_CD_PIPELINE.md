# CI/CD Pipeline

**Version:** 1.0.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready
**Platform:** GitHub Actions

---

## Table of Contents

1. [Overview](#overview)
2. [Pipeline Architecture](#pipeline-architecture)
3. [GitHub Actions Workflows](#github-actions-workflows)
4. [Environment Configuration](#environment-configuration)
5. [SSH Deployment Setup](#ssh-deployment-setup)
6. [Database Migrations](#database-migrations)
7. [Edge Functions Deployment](#edge-functions-deployment)
8. [Rollback Procedures](#rollback-procedures)
9. [Branch Strategy](#branch-strategy)
10. [Security Considerations](#security-considerations)
11. [Monitoring & Notifications](#monitoring--notifications)

---

## Overview

### Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CI/CD PIPELINE FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Developer                                                                   │
│      │                                                                       │
│      ▼                                                                       │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐   │
│  │  Push   │───▶│  Lint   │───▶│  Test   │───▶│  Build  │───▶│ Deploy  │   │
│  │  Code   │    │  Check  │    │  Suite  │    │  App    │    │  SSH    │   │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘   │
│                      │              │              │              │          │
│                      ▼              ▼              ▼              ▼          │
│                 ┌─────────────────────────────────────────────────────┐     │
│                 │                  GitHub Actions                      │     │
│                 │  • ESLint / Prettier                                 │     │
│                 │  • TypeScript check                                  │     │
│                 │  • Unit tests (Vitest)                               │     │
│                 │  • Integration tests                                 │     │
│                 │  • Build verification                                │     │
│                 │  • SSH deploy to VPS                                 │     │
│                 └─────────────────────────────────────────────────────┘     │
│                                      │                                       │
│                                      ▼                                       │
│                 ┌─────────────────────────────────────────────────────┐     │
│                 │                  Ubuntu VPS                          │     │
│                 │  • Pull latest code                                  │     │
│                 │  • Install dependencies                              │     │
│                 │  • Run migrations                                    │     │
│                 │  • Build application                                 │     │
│                 │  • PM2 reload (zero-downtime)                        │     │
│                 │  • Health check verification                         │     │
│                 └─────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Environments

| Environment | Branch | Trigger | URL |
|-------------|--------|---------|-----|
| **Production** | `main` | Push/Merge | `api.zygo.tech` |
| **Staging** | `staging` | Push | `staging-api.zygo.tech` |
| **Development** | `develop` | Push | Local only |

---

## Pipeline Architecture

### Workflow Files

```
.github/
└── workflows/
    ├── ci.yml                    # Lint, test, build (all branches)
    ├── deploy-production.yml     # Deploy to production (main)
    ├── deploy-staging.yml        # Deploy to staging (staging)
    ├── deploy-edge-functions.yml # Deploy Supabase Edge Functions
    ├── db-migration.yml          # Run database migrations
    └── rollback.yml              # Emergency rollback
```

---

## GitHub Actions Workflows

### CI Workflow (ci.yml)

Runs on all pull requests and pushes.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, staging, develop]
  pull_request:
    branches: [main, staging]

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '8'

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run ESLint
        run: pnpm lint

      - name: Run Prettier check
        run: pnpm format:check

      - name: TypeScript check
        run: pnpm typecheck

  test:
    name: Test
    runs-on: ubuntu-latest
    needs: lint
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: zygo_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run migrations
        run: pnpm db:migrate
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/zygo_test

      - name: Run unit tests
        run: pnpm test:unit
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/zygo_test
          REDIS_URL: redis://localhost:6379

      - name: Run integration tests
        run: pnpm test:integration
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/zygo_test
          REDIS_URL: redis://localhost:6379

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: false

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: test
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build application
        run: pnpm build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build
          path: dist/
          retention-days: 1
```

### Production Deployment (deploy-production.yml)

Deploys to production VPS when code is pushed to `main`.

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      skip_tests:
        description: 'Skip tests (emergency deploy)'
        required: false
        default: 'false'

concurrency:
  group: production-deploy
  cancel-in-progress: false

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '8'
  VPS_HOST: ${{ secrets.VPS_HOST }}
  VPS_USER: ${{ secrets.VPS_USER }}
  VPS_KEY: ${{ secrets.VPS_SSH_KEY }}
  APP_DIR: /home/zygo/zygo-backend

jobs:
  test:
    name: Test
    if: ${{ github.event.inputs.skip_tests != 'true' }}
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: zygo_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7
        ports:
          - 6379:6379

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/zygo_test
          REDIS_URL: redis://localhost:6379

  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    needs: [test]
    if: always() && (needs.test.result == 'success' || needs.test.result == 'skipped')
    environment:
      name: production
      url: https://api.zygo.tech

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup SSH
        uses: webfactory/ssh-agent@v0.8.0
        with:
          ssh-private-key: ${{ secrets.VPS_SSH_KEY }}

      - name: Add host to known_hosts
        run: |
          mkdir -p ~/.ssh
          ssh-keyscan -H ${{ secrets.VPS_HOST }} >> ~/.ssh/known_hosts

      - name: Deploy to VPS
        run: |
          ssh ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} << 'DEPLOY_SCRIPT'
            set -e

            echo "=== Starting deployment ==="
            echo "Time: $(date)"
            echo "Commit: ${{ github.sha }}"

            cd ${{ env.APP_DIR }}

            # Store current commit for rollback
            PREVIOUS_COMMIT=$(git rev-parse HEAD)
            echo "Previous commit: $PREVIOUS_COMMIT"

            # Pull latest code
            echo "Pulling latest changes..."
            git fetch origin main
            git reset --hard origin/main

            # Install dependencies
            echo "Installing dependencies..."
            pnpm install --frozen-lockfile

            # Build application
            echo "Building application..."
            pnpm build

            # Run migrations
            echo "Running database migrations..."
            pnpm db:migrate

            # Reload application (zero-downtime)
            echo "Reloading application..."
            pm2 reload zygo-api --update-env

            # Wait for app to be ready
            sleep 5

            # Health check
            echo "Running health check..."
            HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)

            if [ "$HEALTH_STATUS" != "200" ]; then
                echo "❌ Health check failed with status: $HEALTH_STATUS"
                echo "Rolling back to $PREVIOUS_COMMIT..."

                git reset --hard $PREVIOUS_COMMIT
                pnpm install --frozen-lockfile
                pnpm build
                pm2 reload zygo-api --update-env

                exit 1
            fi

            echo "✅ Deployment successful!"
            echo "=== Deployment complete ==="
          DEPLOY_SCRIPT

      - name: Notify success
        if: success()
        uses: slackapi/slack-github-action@v1.24.0
        with:
          payload: |
            {
              "text": "✅ Production deployment successful",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "✅ *Production Deployment Successful*\n\n*Commit:* `${{ github.sha }}`\n*Branch:* `main`\n*Author:* ${{ github.actor }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          SLACK_WEBHOOK_TYPE: INCOMING_WEBHOOK

      - name: Notify failure
        if: failure()
        uses: slackapi/slack-github-action@v1.24.0
        with:
          payload: |
            {
              "text": "❌ Production deployment failed",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "❌ *Production Deployment Failed*\n\n*Commit:* `${{ github.sha }}`\n*Branch:* `main`\n*Author:* ${{ github.actor }}\n\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Logs>"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          SLACK_WEBHOOK_TYPE: INCOMING_WEBHOOK
```

### Staging Deployment (deploy-staging.yml)

```yaml
# .github/workflows/deploy-staging.yml
name: Deploy to Staging

on:
  push:
    branches: [staging]
  workflow_dispatch:

concurrency:
  group: staging-deploy
  cancel-in-progress: true

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '8'

jobs:
  deploy:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging-api.zygo.tech

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup SSH
        uses: webfactory/ssh-agent@v0.8.0
        with:
          ssh-private-key: ${{ secrets.STAGING_VPS_SSH_KEY }}

      - name: Add host to known_hosts
        run: |
          mkdir -p ~/.ssh
          ssh-keyscan -H ${{ secrets.STAGING_VPS_HOST }} >> ~/.ssh/known_hosts

      - name: Deploy to Staging VPS
        run: |
          ssh ${{ secrets.STAGING_VPS_USER }}@${{ secrets.STAGING_VPS_HOST }} << 'DEPLOY_SCRIPT'
            set -e
            cd /home/zygo/zygo-backend

            git fetch origin staging
            git reset --hard origin/staging

            pnpm install --frozen-lockfile
            pnpm build
            pnpm db:migrate

            pm2 reload zygo-api --update-env

            sleep 5
            curl -f http://localhost:3000/health || exit 1

            echo "✅ Staging deployment complete"
          DEPLOY_SCRIPT
```

### Edge Functions Deployment (deploy-edge-functions.yml)

```yaml
# .github/workflows/deploy-edge-functions.yml
name: Deploy Edge Functions

on:
  push:
    branches: [main]
    paths:
      - 'supabase/functions/**'
  workflow_dispatch:
    inputs:
      function:
        description: 'Function to deploy (leave empty for all)'
        required: false

jobs:
  deploy:
    name: Deploy Edge Functions
    runs-on: ubuntu-latest
    environment: production

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Link Supabase project
        run: |
          supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Deploy functions
        run: |
          if [ -n "${{ github.event.inputs.function }}" ]; then
            echo "Deploying single function: ${{ github.event.inputs.function }}"
            supabase functions deploy ${{ github.event.inputs.function }}
          else
            echo "Deploying all functions"
            supabase functions deploy
          fi
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Set function secrets
        run: |
          supabase secrets set \
            INTERNAL_API_KEY=${{ secrets.INTERNAL_API_KEY }} \
            SMTP_HOST=${{ secrets.SMTP_HOST }} \
            SMTP_USER=${{ secrets.SMTP_USER }} \
            SMTP_PASS=${{ secrets.SMTP_PASS }} \
            STRIPE_WEBHOOK_SECRET=${{ secrets.STRIPE_WEBHOOK_SECRET }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

### Database Migration (db-migration.yml)

Manual workflow for running migrations.

```yaml
# .github/workflows/db-migration.yml
name: Database Migration

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to run migration on'
        required: true
        type: choice
        options:
          - staging
          - production
      migration_command:
        description: 'Migration command'
        required: true
        type: choice
        options:
          - migrate
          - rollback
          - status

jobs:
  migrate:
    name: Run Migration
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup SSH
        uses: webfactory/ssh-agent@v0.8.0
        with:
          ssh-private-key: ${{ github.event.inputs.environment == 'production' && secrets.VPS_SSH_KEY || secrets.STAGING_VPS_SSH_KEY }}

      - name: Add host to known_hosts
        run: |
          HOST=${{ github.event.inputs.environment == 'production' && secrets.VPS_HOST || secrets.STAGING_VPS_HOST }}
          mkdir -p ~/.ssh
          ssh-keyscan -H $HOST >> ~/.ssh/known_hosts

      - name: Run migration
        run: |
          HOST=${{ github.event.inputs.environment == 'production' && secrets.VPS_HOST || secrets.STAGING_VPS_HOST }}
          USER=${{ github.event.inputs.environment == 'production' && secrets.VPS_USER || secrets.STAGING_VPS_USER }}

          ssh $USER@$HOST << 'MIGRATE_SCRIPT'
            set -e
            cd /home/zygo/zygo-backend

            case "${{ github.event.inputs.migration_command }}" in
              migrate)
                echo "Running migrations..."
                pnpm db:migrate
                ;;
              rollback)
                echo "Rolling back last migration..."
                pnpm db:rollback
                ;;
              status)
                echo "Checking migration status..."
                pnpm db:status
                ;;
            esac

            echo "✅ Migration command complete"
          MIGRATE_SCRIPT
```

### Rollback Workflow (rollback.yml)

Emergency rollback workflow.

```yaml
# .github/workflows/rollback.yml
name: Emergency Rollback

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to rollback'
        required: true
        type: choice
        options:
          - staging
          - production
      commits_back:
        description: 'Number of commits to rollback'
        required: true
        default: '1'
      reason:
        description: 'Reason for rollback'
        required: true

jobs:
  rollback:
    name: Rollback
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}

    steps:
      - name: Setup SSH
        uses: webfactory/ssh-agent@v0.8.0
        with:
          ssh-private-key: ${{ github.event.inputs.environment == 'production' && secrets.VPS_SSH_KEY || secrets.STAGING_VPS_SSH_KEY }}

      - name: Add host to known_hosts
        run: |
          HOST=${{ github.event.inputs.environment == 'production' && secrets.VPS_HOST || secrets.STAGING_VPS_HOST }}
          mkdir -p ~/.ssh
          ssh-keyscan -H $HOST >> ~/.ssh/known_hosts

      - name: Perform rollback
        run: |
          HOST=${{ github.event.inputs.environment == 'production' && secrets.VPS_HOST || secrets.STAGING_VPS_HOST }}
          USER=${{ github.event.inputs.environment == 'production' && secrets.VPS_USER || secrets.STAGING_VPS_USER }}

          ssh $USER@$HOST << 'ROLLBACK_SCRIPT'
            set -e

            echo "=== Emergency Rollback ==="
            echo "Environment: ${{ github.event.inputs.environment }}"
            echo "Commits back: ${{ github.event.inputs.commits_back }}"
            echo "Reason: ${{ github.event.inputs.reason }}"
            echo "Initiated by: ${{ github.actor }}"
            echo "Time: $(date)"

            cd /home/zygo/zygo-backend

            CURRENT_COMMIT=$(git rev-parse HEAD)
            echo "Current commit: $CURRENT_COMMIT"

            # Rollback git
            git checkout HEAD~${{ github.event.inputs.commits_back }}
            TARGET_COMMIT=$(git rev-parse HEAD)
            echo "Target commit: $TARGET_COMMIT"

            # Rebuild
            pnpm install --frozen-lockfile
            pnpm build

            # Note: Database rollback is NOT automatic
            # Run db:rollback manually if needed
            echo "⚠️  Database migrations NOT rolled back automatically"
            echo "Run 'pnpm db:rollback' manually if needed"

            # Reload application
            pm2 reload zygo-api --update-env

            # Health check
            sleep 5
            curl -f http://localhost:3000/health || {
              echo "❌ Health check failed after rollback!"
              exit 1
            }

            echo "✅ Rollback complete"
            echo "Rolled back from $CURRENT_COMMIT to $TARGET_COMMIT"
          ROLLBACK_SCRIPT

      - name: Notify rollback
        uses: slackapi/slack-github-action@v1.24.0
        with:
          payload: |
            {
              "text": "⚠️ Emergency rollback performed",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "⚠️ *Emergency Rollback*\n\n*Environment:* ${{ github.event.inputs.environment }}\n*Commits back:* ${{ github.event.inputs.commits_back }}\n*Reason:* ${{ github.event.inputs.reason }}\n*Initiated by:* ${{ github.actor }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          SLACK_WEBHOOK_TYPE: INCOMING_WEBHOOK
```

---

## Environment Configuration

### GitHub Secrets

Configure these secrets in GitHub → Settings → Secrets and variables → Actions:

#### Production Secrets

| Secret | Description |
|--------|-------------|
| `VPS_HOST` | Production VPS IP or hostname |
| `VPS_USER` | SSH username (e.g., `zygo`) |
| `VPS_SSH_KEY` | Private SSH key for deployment |
| `SLACK_WEBHOOK_URL` | Slack webhook for notifications |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI access token |
| `SUPABASE_PROJECT_REF` | Supabase project reference ID |
| `INTERNAL_API_KEY` | Internal API key for Edge Functions |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret |

#### Staging Secrets

| Secret | Description |
|--------|-------------|
| `STAGING_VPS_HOST` | Staging VPS IP or hostname |
| `STAGING_VPS_USER` | SSH username for staging |
| `STAGING_VPS_SSH_KEY` | Private SSH key for staging |

### GitHub Environments

Create environments in GitHub → Settings → Environments:

1. **production**
   - Required reviewers: 1-2 team members
   - Wait timer: 0 minutes (or add delay for safety)
   - Deployment branches: `main` only

2. **staging**
   - No required reviewers
   - Deployment branches: `staging` only

---

## SSH Deployment Setup

### Generate SSH Key Pair

```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy_key

# This creates:
# - ~/.ssh/github_deploy_key (private key - add to GitHub secrets)
# - ~/.ssh/github_deploy_key.pub (public key - add to VPS)
```

### Add Public Key to VPS

```bash
# On VPS
echo "ssh-ed25519 AAAA... github-actions-deploy" >> /home/zygo/.ssh/authorized_keys
```

### Add Private Key to GitHub Secrets

Copy the contents of `~/.ssh/github_deploy_key` and add as `VPS_SSH_KEY` secret.

### Test SSH Connection

```bash
# Test from local machine
ssh -i ~/.ssh/github_deploy_key zygo@your-vps-ip "echo 'Connection successful'"
```

---

## Database Migrations

### Migration Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MIGRATION STRATEGY                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. DEVELOPMENT                                                              │
│     └── Create migration locally                                             │
│         pnpm db:generate                                                     │
│                                                                              │
│  2. STAGING                                                                  │
│     └── Test migration on staging                                            │
│         Automatic via deploy-staging.yml                                     │
│                                                                              │
│  3. PRODUCTION                                                               │
│     └── Run migration during deploy                                          │
│         Automatic via deploy-production.yml                                  │
│                                                                              │
│  ROLLBACK (if needed):                                                       │
│     └── Manual via db-migration.yml workflow                                 │
│         Select "rollback" option                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Migration Commands

```json
// package.json scripts
{
  "scripts": {
    "db:generate": "drizzle-kit generate:pg",
    "db:migrate": "drizzle-kit push:pg",
    "db:rollback": "drizzle-kit drop",
    "db:status": "drizzle-kit check:pg",
    "db:studio": "drizzle-kit studio"
  }
}
```

### Safe Migration Practices

1. **Always test on staging first**
2. **Backup database before production migrations**
3. **Use non-blocking migrations when possible**
4. **Have rollback plan ready**

---

## Rollback Procedures

### Automatic Rollback (in deploy script)

The deploy script automatically rolls back if health check fails:

```bash
# In deploy script
if [ "$HEALTH_STATUS" != "200" ]; then
    echo "Rolling back..."
    git reset --hard $PREVIOUS_COMMIT
    pnpm install --frozen-lockfile
    pnpm build
    pm2 reload zygo-api --update-env
    exit 1
fi
```

### Manual Rollback

1. **Via GitHub Actions:**
   - Go to Actions → Emergency Rollback
   - Click "Run workflow"
   - Select environment and number of commits

2. **Via SSH:**
   ```bash
   ssh zygo@your-vps-ip
   cd ~/zygo-backend
   ~/scripts/rollback.sh 1  # Rollback 1 commit
   ```

### Database Rollback

Database migrations are NOT automatically rolled back. If needed:

```bash
# SSH into VPS
ssh zygo@your-vps-ip
cd ~/zygo-backend

# Check migration status
pnpm db:status

# Rollback last migration
pnpm db:rollback
```

---

## Branch Strategy

### Git Flow

```
main (production)
  │
  ├── staging (pre-production testing)
  │     │
  │     └── feature/xyz
  │     └── fix/abc
  │
  └── develop (integration)
        │
        └── feature/xyz
        └── fix/abc
```

### Branch Protection Rules

**main branch:**
- Require pull request reviews (1 reviewer)
- Require status checks to pass (CI workflow)
- Require branches to be up to date
- Do not allow force pushes
- Do not allow deletions

**staging branch:**
- Require status checks to pass
- Allow force pushes (for rebasing)

### Deployment Flow

1. **Feature development:**
   ```bash
   git checkout -b feature/new-feature develop
   # ... make changes ...
   git push origin feature/new-feature
   # Create PR to develop
   ```

2. **Deploy to staging:**
   ```bash
   git checkout staging
   git merge develop
   git push origin staging
   # Triggers deploy-staging.yml
   ```

3. **Deploy to production:**
   ```bash
   git checkout main
   git merge staging
   git push origin main
   # Triggers deploy-production.yml
   ```

---

## Security Considerations

### Secrets Management

1. **Never commit secrets to repository**
2. **Use GitHub Secrets for sensitive values**
3. **Rotate secrets periodically**
4. **Use environment-specific secrets**

### SSH Security

1. **Use ED25519 keys (not RSA)**
2. **Restrict key to specific commands (optional)**
3. **Use separate keys for each environment**
4. **Audit SSH access regularly**

### Deployment Security

1. **Require PR reviews for main branch**
2. **Use environment protection rules**
3. **Enable branch protection**
4. **Audit deployment logs**

### Example: Restricted SSH Key

```bash
# On VPS, in ~/.ssh/authorized_keys
command="/home/zygo/scripts/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... github-actions-deploy
```

---

## Monitoring & Notifications

### Slack Notifications

Configure Slack webhook for deployment notifications:

1. Create Slack App
2. Enable Incoming Webhooks
3. Add webhook URL to GitHub Secrets

### Notification Events

| Event | Channel | Message |
|-------|---------|---------|
| Deploy started | #deployments | 🚀 Starting deployment... |
| Deploy success | #deployments | ✅ Deployment successful |
| Deploy failed | #deployments + #alerts | ❌ Deployment failed |
| Rollback | #alerts | ⚠️ Emergency rollback |

### Health Check Monitoring

```yaml
# Add to deploy workflow
- name: Verify deployment
  run: |
    for i in {1..5}; do
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://api.zygo.tech/health)
      if [ "$STATUS" = "200" ]; then
        echo "✅ Health check passed"
        exit 0
      fi
      echo "Attempt $i: Status $STATUS, retrying..."
      sleep 10
    done
    echo "❌ Health check failed after 5 attempts"
    exit 1
```

---

## Troubleshooting

### Common Issues

#### SSH Connection Failed

```bash
# Check SSH key permissions
chmod 600 ~/.ssh/github_deploy_key

# Test connection
ssh -vvv -i ~/.ssh/github_deploy_key zygo@your-vps-ip

# Check known_hosts
cat ~/.ssh/known_hosts | grep your-vps-ip
```

#### Build Failed

```bash
# SSH into VPS and check
ssh zygo@your-vps-ip
cd ~/zygo-backend

# Check Node version
node --version

# Try manual build
pnpm install
pnpm build

# Check logs
cat /var/log/zygo/error.log
```

#### Health Check Failed

```bash
# Check application status
pm2 status
pm2 logs zygo-api --lines 50

# Check if port is in use
sudo lsof -i :3000

# Test locally
curl http://localhost:3000/health
```

#### Migration Failed

```bash
# Check database connection
psql $DATABASE_URL -c "SELECT 1"

# Check migration status
pnpm db:status

# View migration files
ls -la src/db/migrations/
```

---

## Changelog

### v1.0.0 (January 26, 2026)
- Initial CI/CD pipeline specification
- GitHub Actions workflows for CI, staging, and production
- SSH-based deployment to Ubuntu VPS
- Edge Functions deployment workflow
- Database migration workflow
- Emergency rollback procedure
- Branch strategy and protection rules
- Security guidelines
- Monitoring and notifications
