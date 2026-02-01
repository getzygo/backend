/**
 * Routes Index
 *
 * Aggregates all API routes.
 */

import { Hono } from 'hono';
import authRoutes from './auth';
import rolesRoutes from './roles';
import tenantsRoutes from './tenants';

const app = new Hono();

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Tenant config endpoint (stub for demo)
app.get('/tenants/:slug/config', (c) => {
  const slug = c.req.param('slug');

  // Mock tenant configs
  const tenants: Record<string, any> = {
    demo: {
      id: 'tenant-demo-001',
      slug: 'demo',
      name: 'Demo Corporation',
      status: 'active',
      plan: {
        name: 'Professional',
        tier: 'professional',
        features: ['webhooks', 'sso', 'advanced_analytics', 'custom_roles', 'api_access', 'priority_support'],
      },
      branding: {
        primaryColor: '#6366f1',
      },
      settings: {
        ssoEnabled: true,
        mfaRequired: false,
        ipWhitelist: [],
      },
      limits: {
        maxUsers: 50,
        maxNodes: 500,
        maxExecutionsPerMonth: 100000,
        maxStorage: 10737418240,
      },
      usage: {
        users: 12,
        nodes: 143,
        executionsThisMonth: 34521,
        storageUsed: 2254857830,
      },
    },
  };

  const config = tenants[slug];
  if (!config) {
    return c.json({ error: 'not_found', message: 'Tenant not found' }, 404);
  }

  return c.json({ data: config });
});

// Mount route groups
app.route('/auth', authRoutes);
app.route('/roles', rolesRoutes);
app.route('/tenants', tenantsRoutes);

export default app;
