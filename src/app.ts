/**
 * Hono Application Configuration
 *
 * Sets up middleware and routes for the API server.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import routes from './routes';
import supabaseProxy from './routes/supabase-proxy.routes';
import { getEnv } from './config/env';
import { logger } from './utils/logger';

export function createApp() {
  const app = new Hono();

  // Global middleware
  app.use('*', honoLogger());
  app.use('*', prettyJSON());
  app.use('*', secureHeaders());

  // Version header — only in non-production for debugging
  app.use('*', async (c, next) => {
    await next();
    if (process.env.NODE_ENV !== 'production') {
      c.res.headers.set('X-Zygo-Api-Version', '2026-01-31-v2');
    }
  });

  // CORS configuration
  app.use(
    '*',
    cors({
      origin: (origin) => {
        const env = getEnv();
        const allowedOrigins = [
          env.FRONTEND_URL,
          'http://localhost:5173',
          'http://localhost:3000',
          'https://getzygo.com',
          'https://zygo.tech',
          'https://admin.zygo.tech',
          'https://api.zygo.tech',
          'https://docs.zygo.tech',
        ];

        // Check exact matches first (known safe origins)
        if (!origin || allowedOrigins.includes(origin)) {
          return origin || '*';
        }

        // SECURITY: Validate tenant subdomains with strict pattern
        // Only allow: https://{valid-slug}.zygo.tech where slug is:
        // - 2-50 characters
        // - Lowercase alphanumeric and hyphens only
        // - Must start and end with alphanumeric
        // This prevents arbitrary subdomain access while allowing tenant apps
        const tenantSubdomainPattern = /^https:\/\/([a-z0-9][a-z0-9-]{0,48}[a-z0-9])\.zygo\.tech$/;
        const singleCharPattern = /^https:\/\/([a-z0-9])\.zygo\.tech$/; // Allow single char slugs too

        if (tenantSubdomainPattern.test(origin) || singleCharPattern.test(origin)) {
          return origin;
        }

        // Reject unknown origins
        return null;
      },
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Zygo-Mode', 'X-Zygo-Tenant-Slug', 'apikey'],
      exposeHeaders: ['X-Request-ID'],
      credentials: true,
      maxAge: 86400,
    })
  );

  // Global error handler
  app.onError((err, c) => {
    logger.error('Unhandled error:', err);

    return c.json(
      {
        error: 'internal_server_error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
      },
      500
    );
  });

  // 404 handler — generic message (don't leak method/path)
  app.notFound((c) => {
    return c.json({ error: 'not_found' }, 404);
  });

  // Mount Supabase auth proxy (outside /api/v1 so SDK paths match)
  app.route('/supabase', supabaseProxy);

  // Mount API routes under /api/v1
  app.route('/api/v1', routes);

  // Root endpoint — no info disclosure
  app.get('/', (c) => {
    return c.json({ status: 'ok' });
  });

  return app;
}

export const app = createApp();
