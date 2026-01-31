# DNS Configuration Guide

**Version:** 4.3.0
**Last Updated:** January 29, 2026
**DNS Provider:** Cloudflare
**Hosting:** Hetzner Cloud VPS
**Server IP:** 89.167.2.123

---

## Overview

Zygo uses three domains:

| Domain | Purpose | DNS Type |
|--------|---------|----------|
| **zygo.tech** | Application (API, frontend, admin, Supabase) | Static - points to VPS |
| **getzygo.com** | Public website (landing, docs, auth) | Static - points to VPS |
| **zygo.cloud** | User-deployed servers | Dynamic - created via API |

---

## Architecture

```
                           CLOUDFLARE
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
    zygo.tech            getzygo.com            zygo.cloud
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Hetzner VPS    │  │  Hetzner VPS    │  │  User's Server  │
│  89.167.2.123   │  │  89.167.2.123   │  │  (Dynamic IP)   │
│                 │  │                 │  │                 │
│ • api           │  │ • landing page  │  │ Hetzner/AWS/    │
│ • admin         │  │ • docs          │  │ Azure/GCP       │
│ • supabase      │  │ • (auth on /)   │  │                 │
│ • *.zygo.tech   │  │                 │  │                 │
│   (tenants)     │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Note:** Cloudflare free tier only supports first-level wildcards. Tenant apps use `{tenant}.zygo.tech` (e.g., `acme.zygo.tech`) instead of nested subdomains.

---

# Part 1: Static DNS (zygo.tech & getzygo.com)

These domains point to your Hetzner VPS. Configure once in Cloudflare.

---

## Cloudflare DNS Records

### zygo.tech

| Type | Name | Content | Proxy | Purpose |
|------|------|---------|-------|---------|
| A | `@` | `89.167.2.123` | 🟠 Proxied | Root domain |
| A | `api` | `89.167.2.123` | 🟠 Proxied | Backend API (Hono) |
| A | `admin` | `89.167.2.123` | 🟠 Proxied | Admin panel |
| A | `supabase` | `89.167.2.123` | 🟠 Proxied | Supabase Studio |
| A | `*` | `89.167.2.123` | 🟠 Proxied | Tenant apps (acme.zygo.tech, demo.zygo.tech) |

**Important:** The wildcard `*` record catches all subdomains not explicitly defined. Explicit records (api, admin, supabase) take precedence over the wildcard.

### getzygo.com

| Type | Name | Content | Proxy | Purpose |
|------|------|---------|-------|---------|
| A | `@` | `89.167.2.123` | 🟠 Proxied | Landing page (includes auth) |
| A | `www` | `89.167.2.123` | 🟠 Proxied | WWW redirect |
| A | `docs` | `89.167.2.123` | 🟠 Proxied | Documentation |

### Email Records (zygo.tech) - SendGrid

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| TXT | `@` | `v=spf1 include:sendgrid.net ~all` | - |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@zygo.tech` | - |
| CNAME | `em####` | `u######.wl.sendgrid.net` | ⚪ DNS Only |
| CNAME | `s1._domainkey` | `s1.domainkey.u######.wl.sendgrid.net` | ⚪ DNS Only |
| CNAME | `s2._domainkey` | `s2.domainkey.u######.wl.sendgrid.net` | ⚪ DNS Only |

*Get exact CNAME values from SendGrid dashboard after domain authentication.*

---

## Cloudflare Settings

### SSL/TLS
1. Go to **SSL/TLS** → **Overview**
2. Set encryption mode: **Full (strict)**

---

## Cloudflare Zero Trust Access

Protects `supabase.zygo.tech` and `admin.zygo.tech` with login.

### Initial Setup (one-time)

1. Go to [one.dash.cloudflare.com](https://one.dash.cloudflare.com/)
2. Create team name: `zygo`
3. **Settings** → **Authentication** → **Login methods** → Add **One-time PIN**

### Application: Supabase Studio

**Access** → **Applications** → **Add an application** → **Self-hosted**

| Field | Value |
|-------|-------|
| Application name | `Supabase Studio` |
| Application domain | `supabase.zygo.tech` |
| Session duration | `1 hour` |

**Policy:**
| Field | Value |
|-------|-------|
| Policy name | `Zygo Admins` |
| Action | Allow |
| Include → Selector | Emails ending in |
| Include → Value | `@zygo.tech` |

### Application: Admin Panel

**Access** → **Applications** → **Add an application** → **Self-hosted**

| Field | Value |
|-------|-------|
| Application name | `Admin Panel` |
| Application domain | `admin.zygo.tech` |
| Session duration | `8 hours` |

Use same policy: `Zygo Admins`

---

## Cloudflare Rules (zygo.tech zone)

### WAF Managed Rules

**Security** → **WAF** → **Managed rules**

- Enable **Cloudflare Managed Ruleset**
- Enable **Cloudflare OWASP Core Ruleset**

### WAF Custom Rules

**Security** → **WAF** → **Custom rules**

| Rule Name | Expression | Action |
|-----------|------------|--------|
| Block Bad User Agents | `(http.user_agent contains "sqlmap") or (http.user_agent contains "nikto") or (http.user_agent contains "nmap")` | Block |
| Block Empty UA on API | `(http.host eq "api.zygo.tech") and (http.user_agent eq "")` | Block |

### Rate Limiting Rules

**Security** → **WAF** → **Rate limiting rules**

| Rule Name | Expression | Requests | Period | Action |
|-----------|------------|----------|--------|--------|
| Auth Endpoints | `(http.host eq "api.zygo.tech") and (http.request.uri.path contains "/auth/")` | 10 | 1 min | Block 10 min |
| API General | `(http.host eq "api.zygo.tech")` | 100 | 1 min | Challenge |

### Bot Fight Mode

**Security** → **Bots** → Enable **Bot Fight Mode**

### Cache Rules

**Caching** → **Cache Rules**

| Rule Name | Expression | Setting |
|-----------|------------|---------|
| Bypass API | `(http.host eq "api.zygo.tech")` | Bypass cache |
| Bypass Admin/Supabase | `(http.host eq "admin.zygo.tech") or (http.host eq "supabase.zygo.tech")` | Bypass cache |

### Transform Rules (Response Headers)

**Rules** → **Transform Rules** → **Modify Response Header**

| Rule Name | Expression | Headers |
|-----------|------------|---------|
| Security Headers | `(http.host contains "zygo.tech")` | See below |

**Headers to set:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

### Redirect Rules

**Rules** → **Redirect Rules**

| Rule Name | Expression | Target | Status |
|-----------|------------|--------|--------|
| WWW Redirect | `(http.host eq "www.getzygo.com")` | `https://getzygo.com${http.request.uri.path}` | 301 |

---

## Cloudflare Rules (getzygo.com zone)

Apply same rules as above for:
- Cache Rules (bypass for dynamic, cache static)
- Transform Rules (security headers)
- Redirect Rules (www redirect)

---

## Nginx Configuration (VPS)

> **Single Source of Truth**: All Nginx configs are defined here. VPS_DEPLOYMENT.md references this section.

### Service Port Mapping

| Domain | Service | Port | Repository |
|--------|---------|------|------------|
| api.zygo.tech | Backend API (Hono) | 3000 | zygo-backend |
| supabase.zygo.tech | Supabase Studio | 3001 | - |
| admin.zygo.tech | Admin panel | 5004 | zygo-admin |
| *.zygo.tech | Tenant apps | 5003 | zygo-tenant |
| getzygo.com | Landing site | 5001 | zygo-landing |
| docs.getzygo.com | Documentation | 5002 | zygo-docs |

### Frontend Repository Structure

The frontend is split into four repositories, synced automatically from zygo-ui:

| Repository | Purpose | Port | Domains |
|------------|---------|------|---------|
| zygo-landing | Public landing, tenant auth, legal pages | 5001 | getzygo.com |
| zygo-docs | Documentation site | 5002 | docs.getzygo.com |
| zygo-tenant | Tenant dashboard and workspace | 5003 | {tenant}.zygo.tech |
| zygo-admin | Global admin panel | 5004 | admin.zygo.tech |

**Sync Flow:**
```
zygo-ui (SOURCE - Figma AI pushes here)
    ↓ (automated sync via GitHub Actions)
    ├── zygo-tenant   → {tenant}.zygo.tech
    ├── zygo-admin    → admin.zygo.tech
    ├── zygo-landing  → getzygo.com
    └── zygo-docs     → docs.getzygo.com
```

### Frontend Upstreams (for dev/staging with live servers)

```nginx
# Landing site (getzygo.com)
upstream frontend_landing {
    server 127.0.0.1:5001;
}

# Documentation site (docs.getzygo.com)
upstream frontend_docs {
    server 127.0.0.1:5002;
}

# Tenant workspace ({tenant}.zygo.tech)
upstream frontend_tenant {
    server 127.0.0.1:5003;
}

# Admin panel (admin.zygo.tech)
upstream frontend_admin {
    server 127.0.0.1:5004;
}
```

**Production Note:** In production, use static file serving from /var/www/{repo}/dist instead of upstreams.

### Create Nginx Configs

#### /etc/nginx/sites-available/api.zygo.tech
```nginx
upstream zygo_api {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name api.zygo.tech;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.zygo.tech;

    ssl_certificate /etc/letsencrypt/live/zygo.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zygo.tech/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Logging
    access_log /var/log/nginx/zygo-api.access.log;
    error_log /var/log/nginx/zygo-api.error.log;

    # Limits
    client_max_body_size 50M;

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
    gzip_min_length 1000;

    # API proxy
    location / {
        proxy_pass http://zygo_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # WebSocket
    location /ws {
        proxy_pass http://zygo_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Health check (no logging)
    location /health {
        proxy_pass http://zygo_api;
        access_log off;
    }
}
```

#### /etc/nginx/sites-available/supabase.zygo.tech
```nginx
# Supabase Studio - protected by Cloudflare Zero Trust Access
server {
    listen 80;
    server_name supabase.zygo.tech;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name supabase.zygo.tech;

    ssl_certificate /etc/letsencrypt/live/zygo.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zygo.tech/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### /etc/nginx/sites-available/admin.zygo.tech
```nginx
# Admin panel - served from zygo-admin repository
server {
    listen 80;
    server_name admin.zygo.tech;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name admin.zygo.tech;

    ssl_certificate /etc/letsencrypt/live/zygo.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zygo.tech/privkey.pem;

    root /var/www/zygo-admin/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

#### /etc/nginx/sites-available/tenants.zygo.tech
```nginx
# Catch-all for tenant subdomains (acme.zygo.tech, demo.zygo.tech, etc.)
# Served from zygo-tenant repository
# This config should be loaded LAST so explicit configs (api, supabase, admin) take precedence

server {
    listen 80;
    server_name *.zygo.tech;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name *.zygo.tech;

    ssl_certificate /etc/letsencrypt/live/zygo.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zygo.tech/privkey.pem;

    root /var/www/zygo-tenant/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Note:** Nginx processes server blocks in order. Explicit server_name entries (api.zygo.tech, supabase.zygo.tech, admin.zygo.tech) take precedence over the wildcard `*.zygo.tech`.

#### /etc/nginx/sites-available/getzygo.com
```nginx
# Landing site and tenant auth - served from zygo-landing repository
server {
    listen 80;
    server_name getzygo.com www.getzygo.com;
    return 301 https://getzygo.com$request_uri;
}

server {
    listen 443 ssl http2;
    server_name getzygo.com www.getzygo.com;

    ssl_certificate /etc/letsencrypt/live/getzygo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/getzygo.com/privkey.pem;

    # Redirect www to non-www
    if ($host = www.getzygo.com) {
        return 301 https://getzygo.com$request_uri;
    }

    # zygo-landing: public landing, tenant auth, legal pages
    root /var/www/zygo-landing/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

#### /etc/nginx/sites-available/docs.getzygo.com
```nginx
# Documentation site - served from zygo-docs repository
server {
    listen 80;
    server_name docs.getzygo.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name docs.getzygo.com;

    ssl_certificate /etc/letsencrypt/live/getzygo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/getzygo.com/privkey.pem;

    # zygo-docs: documentation site
    root /var/www/zygo-docs/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively for docs
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Enable Sites

```bash
# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Enable all sites (order matters - specific configs before wildcard)
sudo ln -sf /etc/nginx/sites-available/api.zygo.tech /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/supabase.zygo.tech /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/admin.zygo.tech /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/tenants.zygo.tech /etc/nginx/sites-enabled/  # Wildcard - must be after explicit configs
sudo ln -sf /etc/nginx/sites-available/getzygo.com /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/docs.getzygo.com /etc/nginx/sites-enabled/

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

### Frontend Deployment Directories

Create directories for the four frontend repos:

```bash
sudo mkdir -p /var/www/zygo-landing/dist
sudo mkdir -p /var/www/zygo-docs/dist
sudo mkdir -p /var/www/zygo-tenant/dist
sudo mkdir -p /var/www/zygo-admin/dist

# Set permissions (replace 'deploy' with your deploy user)
sudo chown -R deploy:www-data /var/www/zygo-*
sudo chmod -R 755 /var/www/zygo-*
```

### VPS Cleanup (if deployed before January 29, 2026)

Previous documentation had wrong port for Supabase (8000 instead of 3001).

**Check current config:**
```bash
grep proxy_pass /etc/nginx/sites-available/supabase.zygo.tech
# Should show: proxy_pass http://127.0.0.1:3001
# If shows 8000, run fix below
```

**Fix (if shows 8000):**
```bash
sudo sed -i 's/proxy_pass http:\/\/127.0.0.1:8000/proxy_pass http:\/\/127.0.0.1:3001/' /etc/nginx/sites-available/supabase.zygo.tech
sudo nginx -t && sudo systemctl reload nginx
```

### SSL Certificates

**Option A: Cloudflare Origin Certificate (Recommended)**

Since you're using Cloudflare proxy (orange cloud), use Cloudflare Origin Certificates:

1. Go to Cloudflare → SSL/TLS → Origin Server
2. Click **Create Certificate**
3. Select: `*.zygo.tech` and `zygo.tech`
4. Choose validity (15 years max)
5. Save certificate to `/etc/ssl/cloudflare/zygo.tech.pem`
6. Save private key to `/etc/ssl/cloudflare/zygo.tech.key`

Update Nginx configs to use:
```nginx
ssl_certificate /etc/ssl/cloudflare/zygo.tech.pem;
ssl_certificate_key /etc/ssl/cloudflare/zygo.tech.key;
```

Repeat for `getzygo.com`.

**Option B: Certbot with DNS Challenge (for wildcard)**

Wildcard certificates require DNS validation:

```bash
# Install Cloudflare DNS plugin
sudo apt install python3-certbot-dns-cloudflare

# Create Cloudflare credentials file
sudo mkdir -p /etc/letsencrypt
sudo nano /etc/letsencrypt/cloudflare.ini
# Add: dns_cloudflare_api_token = YOUR_API_TOKEN
sudo chmod 600 /etc/letsencrypt/cloudflare.ini

# Get wildcard certificate for zygo.tech
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d zygo.tech \
  -d "*.zygo.tech"

# Get certificate for getzygo.com
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d getzygo.com \
  -d "*.getzygo.com"
```

---

# Part 2: Dynamic DNS (zygo.cloud)

User-deployed servers get DNS records created automatically via Cloudflare API.

---

## How It Works

```
1. User clicks "Deploy Server" in Zygo App
            ↓
2. Backend creates server on Hetzner/AWS/Azure
            ↓
3. Backend receives server IP (e.g., 95.216.45.67)
            ↓
4. Backend calls Cloudflare API to create DNS record:
   node-abc123.zygo.cloud → 95.216.45.67
            ↓
5. User accesses server at node-abc123.zygo.cloud
```

---

## Cloudflare Setup for zygo.cloud

### 1. Add Domain to Cloudflare

1. Go to Cloudflare Dashboard
2. Click **Add a Site**
3. Enter `zygo.cloud`
4. Select Free plan
5. Update nameservers at your registrar

### 2. Get API Credentials

**Get Zone ID:**
1. Go to zygo.cloud in Cloudflare
2. On the right sidebar, copy **Zone ID**

**Create API Token:**
1. Go to **My Profile** → **API Tokens**
2. Click **Create Token**
3. Use template: **Edit zone DNS**
4. Permissions:
   - Zone: DNS: Edit
   - Zone: Zone: Read
5. Zone Resources: Include → Specific zone → `zygo.cloud`
6. Create and copy token

### 3. Backend Environment Variables

```env
# Cloudflare API for Dynamic DNS
CLOUDFLARE_API_TOKEN=your-api-token-here
CLOUDFLARE_ZONE_ID_ZYGO_CLOUD=your-zone-id-here
```

---

## Backend Implementation

### Create DNS Record (when user deploys server)

```typescript
// services/cloudflare-dns.ts

interface CreateDNSRecordParams {
  subdomain: string;  // e.g., "node-abc123"
  ip: string;         // e.g., "95.216.45.67"
  proxied?: boolean;  // default: false (direct connection)
}

async function createDNSRecord({ subdomain, ip, proxied = false }: CreateDNSRecordParams) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID_ZYGO_CLOUD}/dns_records`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'A',
        name: `${subdomain}.zygo.cloud`,
        content: ip,
        proxied: proxied,
        ttl: 1, // Auto
      }),
    }
  );

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Failed to create DNS record: ${JSON.stringify(data.errors)}`);
  }

  return data.result;
}
```

### Delete DNS Record (when user deletes server)

```typescript
async function deleteDNSRecord(recordId: string) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID_ZYGO_CLOUD}/dns_records/${recordId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      },
    }
  );

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Failed to delete DNS record: ${JSON.stringify(data.errors)}`);
  }

  return true;
}
```

### List DNS Records (for management)

```typescript
async function listDNSRecords() {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID_ZYGO_CLOUD}/dns_records?type=A`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      },
    }
  );

  const data = await response.json();
  return data.result;
}
```

---

## Database Schema for Deployed Servers

Store the Cloudflare record ID to manage DNS lifecycle:

```sql
-- In servers table
ALTER TABLE servers ADD COLUMN dns_record_id TEXT;
ALTER TABLE servers ADD COLUMN dns_hostname TEXT;

-- Example: When server is created
-- dns_hostname = 'node-abc123.zygo.cloud'
-- dns_record_id = 'cloudflare-record-id-here'
```

---

## Server Deployment Flow

```typescript
// Example: Deploy server endpoint
async function deployServer(req: Request) {
  const { provider, size, region } = req.body;

  // 1. Create server on cloud provider
  const server = await hetzner.createServer({ size, region });

  // 2. Generate unique subdomain
  const subdomain = `node-${generateId()}`;

  // 3. Create DNS record
  const dnsRecord = await createDNSRecord({
    subdomain,
    ip: server.publicIp,
    proxied: false,
  });

  // 4. Save to database
  await db.servers.create({
    tenantId: req.tenantId,
    providerId: server.id,
    providerName: 'hetzner',
    publicIp: server.publicIp,
    dnsHostname: `${subdomain}.zygo.cloud`,
    dnsRecordId: dnsRecord.id,
  });

  return {
    hostname: `${subdomain}.zygo.cloud`,
    ip: server.publicIp,
  };
}
```

---

## Summary

| Domain | Type | Managed By |
|--------|------|------------|
| zygo.tech | Static | Manual Cloudflare + Nginx |
| getzygo.com | Static | Manual Cloudflare + Nginx |
| zygo.cloud | Dynamic | Backend via Cloudflare API |

---

## Verification Checklist

### Static DNS (zygo.tech, getzygo.com)
- [x] A records created in Cloudflare
- [x] SSL mode set to Full (strict)
- [ ] Nginx configs created
- [ ] Nginx sites enabled
- [ ] SSL certificates obtained
- [ ] `curl https://api.zygo.tech` works
- [ ] `curl https://supabase.zygo.tech` works (should show Cloudflare Access login)

### Cloudflare Zero Trust
- [ ] Team created at one.dash.cloudflare.com
- [ ] One-time PIN login method enabled
- [ ] Application: `supabase.zygo.tech` (1 hour session)
- [ ] Application: `admin.zygo.tech` (8 hour session)
- [ ] Policy: `Zygo Admins` with `@zygo.tech` emails

### Cloudflare Rules (zygo.tech)
- [ ] WAF Managed Rules enabled
- [ ] WAF Custom Rules (bad user agents, empty UA)
- [ ] Rate Limiting: Auth (10/min), API (100/min)
- [ ] Bot Fight Mode enabled
- [ ] Cache Rules: Bypass API/Admin/Supabase
- [ ] Transform Rules: Security headers
- [ ] Redirect Rules: WWW → non-WWW

### Dynamic DNS (zygo.cloud)
- [ ] Domain added to Cloudflare
- [ ] API token created with DNS edit permissions
- [ ] Zone ID saved in environment
- [ ] Backend DNS service implemented
- [ ] Test: create record via API
- [ ] Test: delete record via API
