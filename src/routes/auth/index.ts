/**
 * Auth Routes
 *
 * Aggregates all authentication-related routes.
 */

import { Hono } from 'hono';
import oauthRoutes from './oauth';
import signupRoutes from './signup.routes';
import signinRoutes from './signin.routes';
import verifyEmailRoutes from './verify-email.routes';
import verifyPhoneRoutes from './verify-phone.routes';
import mfaRoutes from './mfa.routes';
import completeProfileRoutes from './complete-profile.routes';
import passwordResetRoutes from './password-reset.routes';

const app = new Hono();

// Signup routes
// POST /api/v1/auth/signup
// GET /api/v1/auth/signup/check-slug/:slug
app.route('/signup', signupRoutes);

// Signin routes
// POST /api/v1/auth/signin
// POST /api/v1/auth/signin/signout
app.route('/signin', signinRoutes);

// Email verification routes
// POST /api/v1/auth/verify-email
// POST /api/v1/auth/verify-email/resend
// GET /api/v1/auth/verify-email/status
app.route('/verify-email', verifyEmailRoutes);

// Phone verification routes
// POST /api/v1/auth/verify-phone/send-code
// POST /api/v1/auth/verify-phone
// GET /api/v1/auth/verify-phone/status
app.route('/verify-phone', verifyPhoneRoutes);

// MFA routes
// POST /api/v1/auth/mfa/setup
// POST /api/v1/auth/mfa/enable
// POST /api/v1/auth/mfa/verify
// POST /api/v1/auth/mfa/disable
// POST /api/v1/auth/mfa/backup-codes
// GET /api/v1/auth/mfa/status
app.route('/mfa', mfaRoutes);

// Profile and verification status routes
// GET /api/v1/auth/verification-status
// GET /api/v1/auth/profile
// GET /api/v1/auth/tenants
app.route('/', completeProfileRoutes);

// OAuth routes (legacy, mounted at /oauth and /signup for backwards compatibility)
// POST /api/v1/auth/oauth/callback
// POST /api/v1/auth/signup/oauth
app.route('/oauth', oauthRoutes);

// Password reset routes
// POST /api/v1/auth/forgot-password
// POST /api/v1/auth/verify-reset-code
// POST /api/v1/auth/reset-password
// GET /api/v1/auth/reset-status
app.route('/', passwordResetRoutes);

export default app;
