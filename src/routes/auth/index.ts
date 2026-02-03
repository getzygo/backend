/**
 * Auth Routes
 *
 * Aggregates all authentication-related routes.
 */

import { Hono } from 'hono';
import oauthLegacyRoutes from './oauth';
import oauthRoutes from './oauth.routes';
import signupRoutes from './signup.routes';
import signinRoutes from './signin.routes';
import verifyEmailRoutes from './verify-email.routes';
import verifyPhoneRoutes from './verify-phone.routes';
import mfaRoutes from './mfa.routes';
import completeProfileRoutes from './complete-profile.routes';
import passwordResetRoutes from './password-reset.routes';
import changePasswordRoutes from './change-password.routes';
import verifyTokenRoutes from './verify-token.routes';
import sessionsRoutes from './sessions.routes';
import trustedDevicesRoutes from './trusted-devices.routes';
import magicLinkRoutes from './magic-link.routes';
import webauthnRoutes from './webauthn.routes';
import passwordSecurityRoutes from './password-security.routes';

const app = new Hono();

// Signup routes
// POST /api/v1/auth/signup
// GET /api/v1/auth/signup/check-slug/:slug
// GET /api/v1/auth/signup/plans
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

// OAuth routes (Phase 4)
// POST /api/v1/auth/oauth/callback - Exchange OAuth code
// POST /api/v1/auth/oauth/signin - OAuth signin for existing users
// POST /api/v1/auth/oauth/link/initiate - Start account linking
// POST /api/v1/auth/oauth/link/verify - Complete account linking
// GET /api/v1/auth/oauth/providers - List linked providers
// DELETE /api/v1/auth/oauth/providers/:provider - Unlink provider
app.route('/oauth', oauthRoutes);

// Legacy OAuth routes (backwards compatibility)
// POST /api/v1/auth/signup/oauth
app.route('/signup', oauthLegacyRoutes);

// Password reset routes (public, unauthenticated)
// POST /api/v1/auth/forgot-password
// POST /api/v1/auth/verify-reset-code
// POST /api/v1/auth/reset-password
// GET /api/v1/auth/reset-status
app.route('/', passwordResetRoutes);

// Change password routes (authenticated)
// POST /api/v1/auth/change-password
app.route('/change-password', changePasswordRoutes);

// Token verification routes (for cross-domain auth)
// POST /api/v1/auth/verify-token
app.route('/verify-token', verifyTokenRoutes);

// Session management routes
// GET /api/v1/auth/sessions
// POST /api/v1/auth/sessions/:id/revoke
// POST /api/v1/auth/sessions/revoke-all
app.route('/sessions', sessionsRoutes);

// Trusted devices routes (extends MFA)
// POST /api/v1/auth/mfa/trust-device
// GET /api/v1/auth/mfa/trusted-devices
// POST /api/v1/auth/mfa/check-trust
// DELETE /api/v1/auth/mfa/trusted-devices/:id
// DELETE /api/v1/auth/mfa/trusted-devices
app.route('/mfa', trustedDevicesRoutes);

// Magic link routes
// POST /api/v1/auth/magic-link/send
// POST /api/v1/auth/magic-link/verify
app.route('/magic-link', magicLinkRoutes);

// WebAuthn/Passkeys routes
// POST /api/v1/auth/webauthn/register/options
// POST /api/v1/auth/webauthn/register/verify
// POST /api/v1/auth/webauthn/authenticate/options
// POST /api/v1/auth/webauthn/authenticate/verify
// GET /api/v1/auth/webauthn/credentials
// DELETE /api/v1/auth/webauthn/credentials/:id
// PATCH /api/v1/auth/webauthn/credentials/:id
app.route('/webauthn', webauthnRoutes);

// Password security routes
// POST /api/v1/auth/password/check-breach
app.route('/password', passwordSecurityRoutes);

export default app;
