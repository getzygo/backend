/**
 * Supabase Auth Proxy
 *
 * Transparently proxies a strict whitelist of Supabase auth endpoints
 * to the local Kong gateway. Only known origins are allowed.
 *
 * Whitelisted endpoints:
 *   /auth/v1/authorize  — OAuth initiation (GET)
 *   /auth/v1/callback   — OAuth callback (GET)
 *   /auth/v1/token      — Token exchange / refresh (POST)
 *   /auth/v1/user       — Get user info (GET)
 *   /auth/v1/logout     — Sign out (POST)
 *   /auth/v1/otp        — OTP / magic link (POST)
 *   /auth/v1/recover    — Password recovery (POST)
 *   /auth/v1/signup     — Sign up (POST)  [used by SDK]
 */

import { Hono } from 'hono';
import { getEnv } from '../config/env';
import { logger } from '../utils/logger';
import { rateLimit, RATE_LIMITS } from '../middleware/rate-limit.middleware';

const supabaseProxy = new Hono();

// Only these auth subpaths are proxied — everything else is blocked
const ALLOWED_ENDPOINTS = new Set([
  '/auth/v1/authorize',
  '/auth/v1/callback',
  '/auth/v1/token',
  '/auth/v1/user',
  '/auth/v1/logout',
  '/auth/v1/otp',
  '/auth/v1/recover',
  '/auth/v1/signup',
]);

// Origins allowed to use this proxy
const ALLOWED_ORIGINS = new Set([
  'https://getzygo.com',
  'https://zygo.tech',
  'https://admin.zygo.tech',
  'http://localhost:5173',
  'http://localhost:3000',
]);

// Tenant subdomain pattern
const TENANT_ORIGIN_RE = /^https:\/\/[a-z0-9][a-z0-9-]{0,48}[a-z0-9]\.zygo\.tech$/;
const SINGLE_CHAR_TENANT_RE = /^https:\/\/[a-z0-9]\.zygo\.tech$/;

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false; // No origin = non-browser request, block
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (TENANT_ORIGIN_RE.test(origin) || SINGLE_CHAR_TENANT_RE.test(origin)) return true;
  return false;
}

// Rate limit: AUTH preset (10 requests per 15 minutes per IP)
supabaseProxy.use('*', rateLimit({
  ...RATE_LIMITS.AUTH,
  keyGenerator: (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown';
    return `supabase-proxy:${ip}`;
  },
}));

/**
 * Proxy whitelisted auth endpoints to local Supabase
 */
supabaseProxy.all('/auth/v1/*', async (c) => {
  const env = getEnv();

  // Extract the /auth/v1/<endpoint> portion
  const fullPath = c.req.path;
  const authIndex = fullPath.indexOf('/auth/v1');
  const subpath = authIndex >= 0 ? fullPath.substring(authIndex) : fullPath;

  // Strip query string for whitelist check, and normalize trailing slashes
  const endpointPath = subpath.split('?')[0].replace(/\/+$/, '');

  // Block non-whitelisted endpoints
  if (!ALLOWED_ENDPOINTS.has(endpointPath)) {
    return c.json({ error: 'not_found' }, 404);
  }

  // Origin check — block requests from unknown origins
  // Allow requests without origin (direct navigations like OAuth redirects)
  const origin = c.req.header('origin');
  if (origin && !isAllowedOrigin(origin)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  // Build target URL
  const targetUrl = new URL(subpath, env.SUPABASE_URL);
  const incomingUrl = new URL(c.req.url);
  targetUrl.search = incomingUrl.search;

  logger.debug(`[Supabase Proxy] ${c.req.method} ${endpointPath}`);

  // Forward select headers
  const forwardHeaders = new Headers();
  for (const name of ['authorization', 'apikey', 'content-type', 'accept', 'cookie']) {
    const value = c.req.header(name);
    if (value) forwardHeaders.set(name, value);
  }

  // Default apikey for SDK compatibility
  if (!forwardHeaders.has('apikey')) {
    forwardHeaders.set('apikey', env.SUPABASE_ANON_KEY);
  }

  try {
    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD';
    const response = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers: forwardHeaders,
      body: hasBody ? c.req.raw.body : undefined,
      // @ts-expect-error duplex required by Node for streaming body
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
    });

    // Forward select response headers
    const responseHeaders = new Headers();
    for (const name of ['content-type', 'location', 'cache-control']) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    // Forward all set-cookie headers
    const cookies = response.headers.getSetCookie?.() || [];
    for (const cookie of cookies) {
      responseHeaders.append('set-cookie', cookie);
    }

    // Rewrite Location header for redirects
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        const rewritten = location
          .replace(env.SUPABASE_URL, 'https://api.zygo.tech/supabase')
          .replace('http://localhost:8000', 'https://api.zygo.tech/supabase');
        responseHeaders.set('location', rewritten);
      }
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    logger.error('[Supabase Proxy] Upstream error:', err);
    return c.json({ error: 'bad_gateway' }, 502);
  }
});

export default supabaseProxy;
