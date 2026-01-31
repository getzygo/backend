/**
 * Auth Routes
 *
 * Aggregates all authentication-related routes.
 */

import { Hono } from 'hono';
import oauthRoutes from './oauth';

const app = new Hono();

// Mount OAuth routes
// POST /api/v1/auth/oauth/callback
// POST /api/v1/auth/signup/oauth
app.route('/oauth', oauthRoutes);
app.route('/signup', oauthRoutes);

export default app;
