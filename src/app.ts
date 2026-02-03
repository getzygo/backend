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
import { getEnv } from './config/env';
import { logger } from './utils/logger';

export function createApp() {
  const app = new Hono();

  // Global middleware
  app.use('*', honoLogger());
  app.use('*', prettyJSON());
  app.use('*', secureHeaders());

  // Add version header to all responses
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Zygo-Api-Version', '2026-01-31-v2');
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
        ];

        // Allow all zygo.tech subdomains (tenant apps: {slug}.zygo.tech)
        if (origin && origin.endsWith('.zygo.tech')) {
          return origin;
        }

        if (!origin || allowedOrigins.includes(origin)) {
          return origin || '*';
        }

        return null;
      },
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Zygo-Mode', 'X-Zygo-Tenant-Slug'],
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

  // 404 handler
  app.notFound((c) => {
    return c.json(
      {
        error: 'not_found',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
      404
    );
  });

  // Mount API routes under /api/v1
  app.route('/api/v1', routes);

  // Root endpoint
  app.get('/', (c) => {
    return c.json({
      name: 'Zygo API',
      version: '1.0.0',
      docs: '/api/v1/docs',
    });
  });

  return app;
}

export const app = createApp();
