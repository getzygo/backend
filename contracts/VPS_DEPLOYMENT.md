# VPS Deployment Guide

**Version:** 1.4.0
**Last Updated:** January 29, 2026
**Status:** Production-Ready
**Target OS:** Ubuntu 22.04 LTS

---

## Table of Contents

1. [Overview](#overview)
2. [Server Requirements](#server-requirements)
3. [Initial Server Setup](#initial-server-setup)
4. [Install Dependencies](#install-dependencies)
5. [PostgreSQL Setup](#postgresql-setup)
6. [Supabase Self-Hosted Setup](#supabase-self-hosted-setup)
7. [Redis Setup](#redis-setup)
8. [Node.js Application Setup](#nodejs-application-setup)
9. [Nginx Configuration](#nginx-configuration)
10. [SSL Certificates](#ssl-certificates)
11. [Process Management](#process-management)
12. [Firewall Configuration](#firewall-configuration)
13. [Monitoring Setup](#monitoring-setup)
14. [Backup Strategy](#backup-strategy)
15. [Deployment Scripts](#deployment-scripts)
16. [Troubleshooting](#troubleshooting)

---

## Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            UBUNTU 22.04 VPS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          NGINX (Reverse Proxy)                       │    │
│  │                    Ports: 80 (→443), 443 (HTTPS)                     │    │
│  └─────────────────────┬───────────────────┬───────────────────────────┘    │
│                        │                   │                                 │
│           ┌────────────▼────────┐  ┌──────▼──────────────┐                  │
│           │   api.zygo.tech    │  │  supabase.zygo.tech  │                  │
│           │   (Hono API)       │  │  (Supabase Studio)   │                  │
│           │   Port: 3000       │  │  Port: 3001          │                  │
│           └────────────────────┘  └─────────────────────┘                   │
│                        │                   │                                 │
│           ┌────────────▼───────────────────▼───────────────┐                │
│           │                    PM2                          │                │
│           │         Process Manager (Node.js)               │                │
│           └─────────────────────┬──────────────────────────┘                │
│                                 │                                            │
│  ┌──────────────────────────────┼──────────────────────────────────────┐    │
│  │                              │                                       │    │
│  │  ┌───────────────┐  ┌───────▼───────┐  ┌───────────────┐            │    │
│  │  │  PostgreSQL   │  │    Redis      │  │   Supabase    │            │    │
│  │  │  Port: 5432   │  │  Port: 6379   │  │   (Docker)    │            │    │
│  │  │               │  │               │  │               │            │    │
│  │  └───────────────┘  └───────────────┘  └───────────────┘            │    │
│  │                                                                      │    │
│  │                         DATA LAYER                                   │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Domain Structure

Zygo uses three primary domains, all served from VPS:

| Domain | Purpose |
|--------|---------|
| **zygo.tech** | Application (API, tenant app, admin, Supabase) |
| **getzygo.com** | Public website (landing, docs) |
| **zygo.cloud** | User-deployed servers (dynamic DNS) |

### VPS Domains Configuration

| Domain | Service | Port/Path | Repository |
|--------|---------|-----------|------------|
| `api.zygo.tech` | Hono API | 3000 | zygo-backend |
| `supabase.zygo.tech` | Supabase Studio | 3001 | - |
| `admin.zygo.tech` | Admin panel (static) | `/var/www/zygo-admin/dist` | zygo-admin |
| `*.zygo.tech` | Tenant app (static) | `/var/www/zygo-tenant/dist` | zygo-tenant |
| `getzygo.com` | Landing page (static) | `/var/www/zygo-landing/dist` | zygo-landing |
| `docs.getzygo.com` | Documentation (static) | `/var/www/zygo-docs/dist` | zygo-docs |

### Frontend Repository Structure

The frontend is split into four repositories, automatically synced from `zygo-ui`:

| Repository | Purpose | Deployment Path |
|------------|---------|-----------------|
| `zygo-landing` | Public landing, tenant auth, legal pages | `/var/www/zygo-landing/dist` |
| `zygo-docs` | Documentation site | `/var/www/zygo-docs/dist` |
| `zygo-tenant` | Tenant dashboard and workspace | `/var/www/zygo-tenant/dist` |
| `zygo-admin` | Global admin panel | `/var/www/zygo-admin/dist` |

**Sync Flow:**
```
zygo-ui (SOURCE)
    ↓ (GitHub Actions)
    ├── zygo-tenant   → {tenant}.zygo.tech
    ├── zygo-admin    → admin.zygo.tech
    ├── zygo-landing  → getzygo.com
    └── zygo-docs     → docs.getzygo.com
```

See `contracts/DNS_CONFIGURATION.md` for Nginx configs and DNS records.

---

## Server Requirements

### Minimum Specifications

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **CPU** | 2 vCPU | 4 vCPU |
| **RAM** | 4 GB | 8 GB |
| **Storage** | 40 GB SSD | 80 GB NVMe |
| **Bandwidth** | 1 TB/month | Unlimited |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### Ports Required

| Port | Service | Access |
|------|---------|--------|
| 22 | SSH | Restricted IPs |
| 80 | HTTP (redirect) | Public |
| 443 | HTTPS | Public |
| 5432 | PostgreSQL | Internal only |
| 6379 | Redis | Internal only |
| 3000 | Hono API | Internal (via Nginx) |
| 3001 | Supabase | Internal (via Nginx) |

---

## Initial Server Setup

### 1. Connect to Server

```bash
# SSH into your server
ssh root@your-server-ip
```

### 2. Create Deploy User

```bash
# Create non-root user for deployments
adduser zygo
usermod -aG sudo zygo

# Set up SSH key for deploy user
mkdir -p /home/zygo/.ssh
cp ~/.ssh/authorized_keys /home/zygo/.ssh/
chown -R zygo:zygo /home/zygo/.ssh
chmod 700 /home/zygo/.ssh
chmod 600 /home/zygo/.ssh/authorized_keys

# Switch to deploy user
su - zygo
```

### 3. Update System

```bash
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y \
  curl \
  wget \
  git \
  vim \
  htop \
  build-essential \
  software-properties-common \
  apt-transport-https \
  ca-certificates \
  gnupg \
  lsb-release \
  unzip
```

### 4. Configure Timezone

```bash
sudo timedatectl set-timezone UTC
```

### 5. Configure Hostname

```bash
sudo hostnamectl set-hostname zygo-api
echo "127.0.0.1 zygo-api" | sudo tee -a /etc/hosts
```

---

## Install Dependencies

### Node.js 20 LTS

```bash
# Install Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # v20.x.x
npm --version   # 10.x.x

# Install pnpm (recommended package manager)
sudo npm install -g pnpm

# Verify pnpm
pnpm --version
```

### Docker & Docker Compose

```bash
# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker zygo

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Verify
docker --version
docker compose version
```

### Nginx

```bash
sudo apt install -y nginx

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Verify
nginx -v
```

### Certbot (Let's Encrypt) - Already Installed

```bash
# Certbot is already installed on the VPS
# Verify installation:
certbot --version
```

---

## PostgreSQL Setup

### Install PostgreSQL 15

```bash
# Add PostgreSQL repository
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -

# Install PostgreSQL 15
sudo apt update
sudo apt install -y postgresql-15 postgresql-contrib-15

# Start and enable
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Configure PostgreSQL

```bash
# Switch to postgres user
sudo -u postgres psql

-- Create database and user
CREATE USER zygo WITH PASSWORD 'your-secure-password';
CREATE DATABASE zygo_production OWNER zygo;
GRANT ALL PRIVILEGES ON DATABASE zygo_production TO zygo;

-- Enable required extensions
\c zygo_production
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create audit schema
CREATE SCHEMA IF NOT EXISTS audit;
GRANT USAGE ON SCHEMA audit TO zygo;
GRANT CREATE ON SCHEMA audit TO zygo;

\q
```

### Configure PostgreSQL for Connections

```bash
# Edit postgresql.conf
sudo nano /etc/postgresql/15/main/postgresql.conf

# Find and modify these settings:
listen_addresses = 'localhost'
max_connections = 100
shared_buffers = 256MB
effective_cache_size = 768MB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 2621kB
min_wal_size = 1GB
max_wal_size = 4GB
```

```bash
# Edit pg_hba.conf for local connections
sudo nano /etc/postgresql/15/main/pg_hba.conf

# Add/modify:
local   all             zygo                                    md5
host    all             zygo            127.0.0.1/32            md5
host    all             zygo            ::1/128                 md5
```

```bash
# Restart PostgreSQL
sudo systemctl restart postgresql

# Test connection
psql -U zygo -d zygo_production -h localhost
```

---

## Supabase Self-Hosted Setup

### Download Supabase

Clone the official Supabase repository to get the complete Docker setup:

```bash
# Go to home directory (or a clean folder)
cd ~

# Download the full repository (shallow clone for faster download)
git clone --depth 1 https://github.com/supabase/supabase

# Go into the docker folder
cd supabase/docker
```

### Configure Environment

Environment files are stored in the private `zygo-env` repository.

```bash
# Clone zygo-env (requires access)
cd ~
git clone https://github.com/getzygo/zygo-env.git

# Copy Supabase environment file
cp ~/zygo-env/.env.supabase ~/supabase/docker/.env
```

See `zygo-env/.env.supabase` for all configuration options.

### Generate JWT Keys

```bash
# Install jwt-cli or use Node.js to generate keys
node -e "
const crypto = require('crypto');
const jwtSecret = crypto.randomBytes(32).toString('hex');
console.log('JWT_SECRET=' + jwtSecret);

// Generate ANON_KEY (for client-side)
const anonPayload = {
  role: 'anon',
  iss: 'supabase',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60) // 10 years
};

// Generate SERVICE_ROLE_KEY (for server-side)
const servicePayload = {
  role: 'service_role',
  iss: 'supabase',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60)
};

console.log('\\nGenerate JWT tokens at: https://supabase.com/docs/guides/self-hosting#api-keys');
"
```

### Start Supabase

```bash
cd ~/supabase/docker

# Pull the latest Docker images
docker compose pull

# Start all services
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f
```

### Verify Supabase

```bash
# Check if services are running
curl -I http://localhost:3001  # Studio
curl -I http://localhost:8000  # Kong API Gateway
```

---

## Redis Setup

### Install Redis

```bash
# Install Redis
sudo apt install -y redis-server

# Configure Redis
sudo nano /etc/redis/redis.conf
```

```conf
# Key configurations:
bind 127.0.0.1 ::1
port 6379
maxmemory 256mb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec

# Security - set password
requirepass your-redis-password
```

```bash
# Restart Redis
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# Test connection
redis-cli -a your-redis-password ping
# Should return: PONG
```

---

## Node.js Application Setup

### Clone Repository

```bash
cd ~
git clone git@github.com:getzygo/zygo-backend.git
cd zygo-backend
```

### Install Dependencies

```bash
pnpm install
```

### Configure Environment

Environment files are stored in the private `zygo-env` repository.

```bash
# Copy backend environment file
cp ~/zygo-env/.env.backend ~/zygo-backend/.env.production
```

See `zygo-env/.env.backend` for all configuration options including:
- Database, Redis, Supabase connections
- JWT and encryption keys
- OAuth providers (Google, GitHub)
- External services (Stripe, Twilio, SendGrid, Hetzner)

### Build Application

```bash
pnpm build
```

### Run Migrations

```bash
pnpm db:migrate
```

### Test Application

```bash
# Run in production mode
NODE_ENV=production node dist/index.js

# Test endpoint
curl http://localhost:3000/health
```

---

## Nginx Configuration

> **See:** `contracts/DNS_CONFIGURATION.md` → "Nginx Configuration (VPS)" for all Nginx configs.

### Quick Setup

```bash
# Create config files from DNS_CONFIGURATION.md
sudo nano /etc/nginx/sites-available/api.zygo.tech
sudo nano /etc/nginx/sites-available/supabase.zygo.tech
sudo nano /etc/nginx/sites-available/admin.zygo.tech
sudo nano /etc/nginx/sites-available/tenants.zygo.tech
sudo nano /etc/nginx/sites-available/getzygo.com

# Enable sites
sudo ln -sf /etc/nginx/sites-available/api.zygo.tech /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/supabase.zygo.tech /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/admin.zygo.tech /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/tenants.zygo.tech /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/getzygo.com /etc/nginx/sites-enabled/

# Remove default and test
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## Frontend Applications Setup

Frontend apps are built locally or via CI/CD, then deployed as static files to VPS.

### Directory Structure

```bash
# Create directories for all frontend apps
sudo mkdir -p /var/www/zygo-tenant/dist
sudo mkdir -p /var/www/zygo-admin/dist
sudo mkdir -p /var/www/zygo-landing/dist
sudo mkdir -p /var/www/zygo-docs/dist

# Set ownership
sudo chown -R zygo:zygo /var/www/zygo-*
```

### Build Frontend (on build machine or CI/CD)

Environment files are stored in the private `zygo-env` repository.

```bash
# Clone zygo-env
git clone https://github.com/getzygo/zygo-env.git

# For zygo-ui (tenant app)
cd ~/zygo-ui
cp ~/zygo-env/.env.frontend .env.local
pnpm install && pnpm build

# For zygo-admin
cd ~/zygo-admin
cp ~/zygo-env/.env.frontend .env.local
pnpm install && pnpm build

# For zygo-landing
cd ~/zygo-landing
cp ~/zygo-env/.env.frontend .env.local
pnpm install && pnpm build

# For zygo-docs
cd ~/zygo-docs
cp ~/zygo-env/.env.frontend .env.local
pnpm install && pnpm build
```

### Deploy to VPS

```bash
# Copy built files to VPS (from build machine)
rsync -avz --delete ~/zygo-tenant/dist/ zygo@VPS_IP:/var/www/zygo-tenant/dist/
rsync -avz --delete ~/zygo-admin/dist/ zygo@VPS_IP:/var/www/zygo-admin/dist/
rsync -avz --delete ~/zygo-landing/dist/ zygo@VPS_IP:/var/www/zygo-landing/dist/
rsync -avz --delete ~/zygo-docs/dist/ zygo@VPS_IP:/var/www/zygo-docs/dist/
```

### Frontend Apps Summary

| App | Repository | VPS Path | Domain |
|-----|------------|----------|--------|
| Tenant App | zygo-tenant | `/var/www/zygo-tenant/dist` | `*.zygo.tech` |
| Admin Panel | zygo-admin | `/var/www/zygo-admin/dist` | `admin.zygo.tech` |
| Landing Page | zygo-landing | `/var/www/zygo-landing/dist` | `getzygo.com` |
| Documentation | zygo-docs | `/var/www/zygo-docs/dist` | `docs.getzygo.com` |

---

## Background Workers Setup

Background workers handle async jobs (emails, webhooks, scheduled tasks).

### Configure Environment

```bash
# Copy workers environment file
cp ~/zygo-env/.env.workers ~/zygo-backend/.env.workers
```

See `zygo-env/.env.workers` for configuration options including:
- Redis connection
- Job queue settings
- Worker-specific credentials

### PM2 Workers Configuration

Add to `ecosystem.config.js`:

```javascript
// In ecosystem.config.js, add to apps array:
{
  name: 'zygo-workers',
  script: 'dist/workers/index.js',
  instances: 2,
  exec_mode: 'cluster',
  env_production: {
    NODE_ENV: 'production',
  },
  log_file: '/var/log/zygo/workers-combined.log',
  out_file: '/var/log/zygo/workers-out.log',
  error_file: '/var/log/zygo/workers-error.log',
}
```

### Start Workers

```bash
pm2 start ecosystem.config.js --only zygo-workers --env production
pm2 save
```

---

## SSL Certificates

You have two options for SSL certificates. **Certbot is already installed** on the VPS.

### Option 1: Certbot Multi-Domain Certificate (Quick Setup)

Since Certbot is already installed, the quickest option is to get a single certificate covering all subdomains:

```bash
# Get certificate for all zygo.tech subdomains
sudo certbot --nginx \
  -d zygo.tech \
  -d api.zygo.tech \
  -d app.zygo.tech \
  -d admin.zygo.tech \
  -d supabase.zygo.tech

# Get certificate for getzygo.com subdomains
sudo certbot --nginx \
  -d getzygo.com \
  -d www.getzygo.com \
  -d docs.getzygo.com

# Get certificate for zygo.cloud
sudo certbot --nginx \
  -d zygo.cloud \
  -d ns1.zygo.cloud \
  -d ns2.zygo.cloud

# Verify auto-renewal is working
sudo certbot renew --dry-run

# Check renewal timer status
sudo systemctl status certbot.timer
```

Certbot auto-renews certificates before they expire (every 90 days).

---

### Option 2: Cloudflare Origin CA (No Renewal Needed)

#### Step 1: Generate Certificate in Cloudflare

1. Go to **Cloudflare Dashboard** → Select domain (e.g., `zygo.tech`)
2. Navigate to **SSL/TLS** → **Origin Server**
3. Click **Create Certificate**
4. Configure:
   - Private key type: **RSA (2048)**
   - Hostnames: `*.zygo.tech, zygo.tech`
   - Certificate validity: **15 years**
5. Click **Create**
6. **Copy the certificate and private key** (you won't see the key again!)

Repeat for each domain:
- `*.zygo.tech, zygo.tech`
- `*.getzygo.com, getzygo.com`
- `*.zygo.cloud, zygo.cloud`

#### Step 2: Install Certificates on VPS

```bash
# Create directory for Cloudflare certificates
sudo mkdir -p /etc/ssl/cloudflare

# Create certificate files for zygo.tech
sudo nano /etc/ssl/cloudflare/zygo-tech.pem
# Paste the certificate from Cloudflare

sudo nano /etc/ssl/cloudflare/zygo-tech.key
# Paste the private key from Cloudflare

# Set proper permissions
sudo chmod 600 /etc/ssl/cloudflare/*.key
sudo chmod 644 /etc/ssl/cloudflare/*.pem

# Create certificate files for getzygo.com
sudo nano /etc/ssl/cloudflare/getzygo-com.pem
sudo nano /etc/ssl/cloudflare/getzygo-com.key

# Create certificate files for zygo.cloud
sudo nano /etc/ssl/cloudflare/zygo-cloud.pem
sudo nano /etc/ssl/cloudflare/zygo-cloud.key
```

#### Step 3: Update Nginx Configuration

Update your Nginx server blocks to use Cloudflare certificates:

```nginx
# For zygo.tech subdomains (api, app, admin, supabase)
server {
    listen 443 ssl http2;
    server_name api.zygo.tech;

    ssl_certificate /etc/ssl/cloudflare/zygo-tech.pem;
    ssl_certificate_key /etc/ssl/cloudflare/zygo-tech.key;

    # ... rest of config
}
```

#### Step 4: Configure Cloudflare SSL Mode

In Cloudflare Dashboard → **SSL/TLS** → **Overview**:
- Set encryption mode to **Full (strict)**

This ensures traffic is encrypted both:
- Browser ↔ Cloudflare (Cloudflare's edge certificate)
- Cloudflare ↔ VPS (Origin CA certificate)

### Certificate Comparison

| Feature | Cloudflare Origin CA | Let's Encrypt |
|---------|---------------------|---------------|
| Cost | Free | Free |
| Validity | 15 years | 90 days |
| Auto-renewal | Not needed | Required |
| Works without Cloudflare | No | Yes |
| Wildcard support | Yes | Yes (DNS validation) |
| Setup complexity | Low | Medium |

**Recommendation:** Use Cloudflare Origin CA since you're using Cloudflare proxy for all domains.

---

## Process Management

### Install PM2

```bash
sudo npm install -g pm2
```

### PM2 Ecosystem File

```bash
cd ~/zygo-backend
nano ecosystem.config.js
```

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'zygo-api',
      script: 'dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Logging
      log_file: '/var/log/zygo/combined.log',
      out_file: '/var/log/zygo/out.log',
      error_file: '/var/log/zygo/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Performance
      max_memory_restart: '1G',
      // Restart policy
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '10s',
      // Watch (disabled in production)
      watch: false,
    },
  ],
};
```

### Create Log Directory

```bash
sudo mkdir -p /var/log/zygo
sudo chown zygo:zygo /var/log/zygo
```

### Start Application

```bash
cd ~/zygo-backend
pm2 start ecosystem.config.js --env production

# Save PM2 process list
pm2 save

# Configure PM2 to start on boot
pm2 startup systemd -u zygo --hp /home/zygo
# Run the command it outputs
```

### PM2 Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs zygo-api

# Restart application
pm2 restart zygo-api

# Reload (zero-downtime)
pm2 reload zygo-api

# Stop application
pm2 stop zygo-api

# Monitor
pm2 monit
```

---

## Firewall Configuration

### Configure UFW

```bash
# Enable UFW
sudo ufw enable

# Allow SSH (important - do this first!)
sudo ufw allow ssh

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Deny all other incoming by default
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Check status
sudo ufw status verbose
```

### Restrict SSH Access (Optional)

```bash
# Allow SSH only from specific IPs
sudo ufw delete allow ssh
sudo ufw allow from YOUR_IP_ADDRESS to any port 22

# Or use fail2ban for brute-force protection
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

---

## Monitoring Setup

### Install Node Exporter (Prometheus)

```bash
# Download and install
cd /tmp
wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz
tar xvfz node_exporter-1.7.0.linux-amd64.tar.gz
sudo mv node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/

# Create systemd service
sudo nano /etc/systemd/system/node_exporter.service
```

```ini
[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=nobody
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable node_exporter
sudo systemctl start node_exporter
```

### Application Health Check Script

```bash
mkdir -p ~/scripts
nano ~/scripts/health-check.sh
```

```bash
#!/bin/bash

# Health check script
API_URL="http://localhost:3000/health"
SLACK_WEBHOOK="https://hooks.slack.com/services/xxx"  # Optional

response=$(curl -s -o /dev/null -w "%{http_code}" $API_URL)

if [ "$response" != "200" ]; then
    echo "$(date): API health check failed with status $response"

    # Restart PM2 if unhealthy
    pm2 restart zygo-api

    # Send alert (optional)
    if [ -n "$SLACK_WEBHOOK" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"⚠️ Zygo API health check failed. Auto-restarting...\"}" \
            $SLACK_WEBHOOK
    fi
fi
```

```bash
chmod +x ~/scripts/health-check.sh

# Add to crontab
crontab -e
# Add: */5 * * * * /home/zygo/scripts/health-check.sh >> /var/log/zygo/health-check.log 2>&1
```

---

## Backup Strategy

### Database Backup Script

```bash
nano ~/scripts/backup-database.sh
```

```bash
#!/bin/bash

# Configuration
BACKUP_DIR="/home/zygo/backups/database"
DB_NAME="zygo_production"
DB_USER="zygo"
RETENTION_DAYS=30
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz"

# Create backup directory
mkdir -p $BACKUP_DIR

# Create backup
PGPASSWORD="your-db-password" pg_dump -U $DB_USER -h localhost $DB_NAME | gzip > $BACKUP_FILE

# Check if backup was successful
if [ $? -eq 0 ]; then
    echo "$(date): Database backup created: $BACKUP_FILE"

    # Delete old backups
    find $BACKUP_DIR -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
    echo "$(date): Deleted backups older than $RETENTION_DAYS days"
else
    echo "$(date): Database backup FAILED"
    exit 1
fi

# Optional: Upload to S3
# aws s3 cp $BACKUP_FILE s3://zygo-backups/database/
```

```bash
chmod +x ~/scripts/backup-database.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /home/zygo/scripts/backup-database.sh >> /var/log/zygo/backup.log 2>&1
```

### Redis Backup

```bash
nano ~/scripts/backup-redis.sh
```

```bash
#!/bin/bash

BACKUP_DIR="/home/zygo/backups/redis"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
RETENTION_DAYS=7

mkdir -p $BACKUP_DIR

# Trigger Redis BGSAVE
redis-cli -a your-redis-password BGSAVE

# Wait for save to complete
sleep 5

# Copy dump file
cp /var/lib/redis/dump.rdb "$BACKUP_DIR/dump_${DATE}.rdb"

# Delete old backups
find $BACKUP_DIR -name "*.rdb" -mtime +$RETENTION_DAYS -delete

echo "$(date): Redis backup completed"
```

---

## Deployment Scripts

### Deploy Script

```bash
nano ~/scripts/deploy.sh
```

```bash
#!/bin/bash
set -e

# Configuration
APP_DIR="/home/zygo/zygo-backend"
BRANCH="${1:-main}"

echo "=== Deploying Zygo Backend ==="
echo "Branch: $BRANCH"
echo "Time: $(date)"

cd $APP_DIR

# Pull latest code
echo "Pulling latest changes..."
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

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
pm2 reload zygo-api

# Wait for app to be ready
sleep 5

# Health check
echo "Running health check..."
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)

if [ "$response" = "200" ]; then
    echo "✅ Deployment successful!"
else
    echo "❌ Health check failed with status: $response"
    echo "Rolling back..."
    git checkout HEAD~1
    pnpm install --frozen-lockfile
    pnpm build
    pm2 reload zygo-api
    exit 1
fi

echo "=== Deployment Complete ==="
```

```bash
chmod +x ~/scripts/deploy.sh
```

### Rollback Script

```bash
nano ~/scripts/rollback.sh
```

```bash
#!/bin/bash
set -e

APP_DIR="/home/zygo/zygo-backend"
COMMITS_BACK="${1:-1}"

echo "=== Rolling Back $COMMITS_BACK commit(s) ==="

cd $APP_DIR

# Get current commit
CURRENT=$(git rev-parse HEAD)
echo "Current commit: $CURRENT"

# Rollback
git checkout HEAD~$COMMITS_BACK

# Rebuild and restart
pnpm install --frozen-lockfile
pnpm build
pm2 reload zygo-api

echo "=== Rollback Complete ==="
```

```bash
chmod +x ~/scripts/rollback.sh
```

---

## Troubleshooting

### Common Issues

#### Application Won't Start

```bash
# Check PM2 logs
pm2 logs zygo-api --lines 100

# Check if port is in use
sudo lsof -i :3000

# Check environment variables
cat ~/zygo-backend/.env.production
```

#### Database Connection Issues

```bash
# Test PostgreSQL connection
psql -U zygo -h localhost -d zygo_production

# Check PostgreSQL is running
sudo systemctl status postgresql

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-15-main.log
```

#### Nginx Issues

```bash
# Test configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/zygo-api.error.log

# Reload Nginx
sudo systemctl reload nginx
```

#### SSL Certificate Issues

```bash
# Check certificate expiry
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal

# Check SSL configuration
openssl s_client -connect api.zygo.tech:443 -servername api.zygo.tech
```

#### Redis Issues

```bash
# Check Redis status
sudo systemctl status redis-server

# Test Redis connection
redis-cli -a your-redis-password ping

# Check Redis logs
sudo tail -f /var/log/redis/redis-server.log
```

### Useful Commands

```bash
# System resources
htop
df -h
free -m

# Process status
pm2 status
pm2 monit

# Network connections
sudo netstat -tulpn | grep LISTEN

# Docker containers (Supabase)
docker compose ps
docker compose logs -f

# Nginx status
sudo systemctl status nginx

# View all logs
sudo journalctl -u nginx -f
sudo journalctl -u postgresql -f
pm2 logs
```

---

## Quick Reference

### Service Management

| Service | Start | Stop | Restart | Status |
|---------|-------|------|---------|--------|
| Nginx | `sudo systemctl start nginx` | `sudo systemctl stop nginx` | `sudo systemctl restart nginx` | `sudo systemctl status nginx` |
| PostgreSQL | `sudo systemctl start postgresql` | `sudo systemctl stop postgresql` | `sudo systemctl restart postgresql` | `sudo systemctl status postgresql` |
| Redis | `sudo systemctl start redis-server` | `sudo systemctl stop redis-server` | `sudo systemctl restart redis-server` | `sudo systemctl status redis-server` |
| API (PM2) | `pm2 start zygo-api` | `pm2 stop zygo-api` | `pm2 restart zygo-api` | `pm2 status` |
| Supabase | `cd ~/supabase/docker && docker compose up -d` | `docker compose down` | `docker compose restart` | `docker compose ps` |

### File Locations

| Item | Path |
|------|------|
| Application | `/home/zygo/zygo-backend` |
| Environment Files | `/home/zygo/zygo-env` (private repo) |
| PM2 Ecosystem | `/home/zygo/zygo-backend/ecosystem.config.js` |
| App Logs | `/var/log/zygo/` |
| Nginx Config | `/etc/nginx/sites-available/zygo-api` |
| Nginx Logs | `/var/log/nginx/` |
| PostgreSQL Config | `/etc/postgresql/15/main/` |
| PostgreSQL Data | `/var/lib/postgresql/15/main/` |
| Redis Config | `/etc/redis/redis.conf` |
| SSL Certificates (Certbot) | `/etc/letsencrypt/live/` |
| SSL Certificates (Cloudflare) | `/etc/ssl/cloudflare/` |
| Backups | `/home/zygo/backups/` |
| Scripts | `/home/zygo/scripts/` |
| Supabase | `/home/zygo/supabase/docker/` |

---

## Changelog

### v1.4.0 (January 29, 2026)
- Removed duplicate Nginx configs (single source of truth: DNS_CONFIGURATION.md)
- Fixed Supabase port: 3001 (Studio), not 8000 (Kong)
- All domains now served from VPS (no Vercel/Netlify)

### v1.3.0 (January 29, 2026)
- Updated Supabase Nginx config to reference Cloudflare Zero Trust Access for access control
- Removed commented IP whitelist in favor of Cloudflare Access (see DNS_CONFIGURATION.md)
- Updated environment configuration to reference `zygo-env` private repository
- Removed inline environment variable examples (now centralized in `zygo-env`)

### v1.1.0 (January 28, 2026)
- Updated Supabase setup to clone full repository instead of downloading individual files
- Changed Supabase working directory to `~/supabase/docker`
- Added `docker compose pull` step before starting Supabase
- Fixed all path references for Supabase directory

### v1.0.0 (January 26, 2026)
- Initial VPS deployment guide
- Ubuntu 22.04 LTS setup
- PostgreSQL 15 installation and configuration
- Self-hosted Supabase with Docker
- Redis setup
- Nginx reverse proxy with SSL
- PM2 process management
- Firewall configuration
- Backup and monitoring scripts
- Deployment and rollback scripts
