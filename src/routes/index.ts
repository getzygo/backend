/**
 * Routes Index
 *
 * Aggregates all API routes.
 */

import { Hono } from 'hono';
import authRoutes from './auth';
import rolesRoutes from './roles';
import tenantsRoutes from './tenants';
import usersRoutes from './users.routes';
import adminAuthRoutes from './admin/auth.routes';

const app = new Hono();

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Mount route groups
app.route('/auth', authRoutes);
app.route('/roles', rolesRoutes);
app.route('/tenants', tenantsRoutes);
app.route('/users', usersRoutes);

// Admin panel routes (Phase 5)
// POST /api/v1/admin/auth/signin - Admin signin
// POST /api/v1/admin/auth/mfa/verify - Verify MFA
// POST /api/v1/admin/auth/signout - Admin signout
// GET /api/v1/admin/auth/session - Get session
app.route('/admin/auth', adminAuthRoutes);

export default app;
