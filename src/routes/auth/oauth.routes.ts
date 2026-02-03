/**
 * OAuth Routes
 *
 * Phase 4: OAuth & Account Linking
 *
 * POST /api/v1/auth/oauth/signin - OAuth signin for existing users
 * POST /api/v1/auth/oauth/link/initiate - Start account linking
 * POST /api/v1/auth/oauth/link/verify - Verify link code and complete linking
 * GET /api/v1/auth/oauth/providers - Get linked OAuth providers for current user
 * DELETE /api/v1/auth/oauth/providers/:provider - Unlink an OAuth provider
 *
 * Per UNIFIED_AUTH_STRATEGY.md Section 10.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { oauthService } from '../../services/oauth.service';
import {
  userService,
  getUserByEmail,
  getSocialLogin,
  updateSocialLoginTimestamp,
  linkSocialLogin,
  unlinkSocialLogin,
  getUserSocialLogins,
} from '../../services/user.service';
import { getUserTenants, createTenant, isSlugAvailable, getTenantMembershipWithRole } from '../../services/tenant.service';
import { checkVerificationStatus } from '../../services/verification.service';
import { signInWithPassword, getSession } from '../../services/supabase.service';
import { signupWithOAuth } from '../../services/signup.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';
import type { User } from '../../db/schema';
import { createAuthToken } from '../../services/auth-token.service';

const app = new Hono();

// OAuth callback schema
const callbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  provider: z.enum(['google', 'github']),
  redirect_uri: z.string().url('Invalid redirect URI'),
});

/**
 * POST /api/v1/auth/oauth/callback
 * Exchange OAuth code for user info
 * Returns signup or signin flow based on user existence
 */
app.post('/callback', zValidator('json', callbackSchema), async (c) => {
  const { code, provider, redirect_uri } = c.req.valid('json');

  try {
    const result = await oauthService.handleOAuthCallback(code, provider, redirect_uri);

    // Check if user already exists
    const existingUser = await getUserByEmail(result.email);

    if (existingUser) {
      // Check if this OAuth is already linked
      const socialLogin = await getSocialLogin(provider, result.oauthToken);

      return c.json({
        flow: 'signin',
        email: result.email,
        name: result.name,
        oauth_token: result.oauthToken,
        user_exists: true,
        oauth_linked: !!socialLogin,
      });
    }

    // New user - signup flow
    return c.json({
      flow: 'signup',
      email: result.email,
      name: result.name,
      oauth_token: result.oauthToken,
      user_exists: false,
      oauth_linked: false,
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    const message = error instanceof Error ? error.message : 'OAuth authentication failed';

    return c.json(
      {
        error: 'oauth_callback_failed',
        message,
      },
      400
    );
  }
});

// OAuth signin schema (for authorization code flow)
const signinSchema = z.object({
  provider: z.enum(['google', 'github']),
  oauth_token: z.string().min(1, 'OAuth token is required'),
  tenant_slug: z.string().optional(),
});

// OAuth signin with Supabase token schema (for implicit flow)
const signinWithSupabaseSchema = z.object({
  provider: z.enum(['google', 'github']),
  supabase_access_token: z.string().min(1, 'Supabase access token is required'),
  email: z.string().email().optional(),
});

/**
 * POST /api/v1/auth/oauth/signin
 * OAuth signin for existing users
 * Supports both authorization code flow (oauth_token) and implicit flow (supabase_access_token)
 */
app.post('/signin', async (c) => {
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  try {
    const body = await c.req.json();

    // Check if using Supabase access token (implicit flow from frontend)
    if (body.supabase_access_token) {
      const parsed = signinWithSupabaseSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            error: 'validation_error',
            message: parsed.error.errors[0]?.message || 'Invalid request',
          },
          400
        );
      }

      const { provider, supabase_access_token } = parsed.data;

      // Verify token with Supabase and get user info
      const { user: supabaseUser, error: sessionError } = await getSession(supabase_access_token);

      if (sessionError || !supabaseUser) {
        return c.json(
          {
            error: 'invalid_token',
            message: sessionError || 'Invalid or expired access token',
          },
          401
        );
      }

      const userEmail = supabaseUser.email;
      if (!userEmail) {
        return c.json(
          {
            error: 'no_email',
            message: 'No email found in OAuth response',
          },
          400
        );
      }

      // Check if user exists in our database
      const user = await getUserByEmail(userEmail);

      if (!user) {
        return c.json(
          {
            success: false,
            error: 'user_not_found',
            message: 'No account found with this email. Please sign up first.',
          },
          404
        );
      }

      // Check account status
      if (user.status === 'suspended') {
        return c.json(
          {
            success: false,
            error: 'account_suspended',
            message: 'Your account has been suspended. Please contact support.',
          },
          403
        );
      }

      if (user.status === 'deleted') {
        return c.json(
          {
            success: false,
            error: 'account_deleted',
            message: 'This account has been deleted.',
          },
          403
        );
      }

      // Get user's tenants
      const userTenants = await getUserTenants(user.id);

      if (userTenants.length === 0) {
        return c.json(
          {
            success: false,
            error: 'no_tenants',
            message: 'No workspaces found for this account. Please create a workspace first.',
          },
          404
        );
      }

      // Update last login
      await db
        .update(users)
        .set({
          lastLoginAt: new Date(),
          lastLoginIp: ipAddress || undefined,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // Audit log
      await db.insert(auditLogs).values({
        userId: user.id,
        action: 'login_oauth',
        resourceType: 'user',
        resourceId: user.id,
        details: {
          provider,
          tenant_count: userTenants.length,
        },
        ipAddress: ipAddress || undefined,
        userAgent: userAgent || undefined,
        status: 'success',
      });

      // Build response
      const response: Record<string, unknown> = {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
          email_verified: user.emailVerified,
          phone_verified: user.phoneVerified,
          mfa_enabled: user.mfaEnabled,
        },
      };

      // Get avatar from Supabase user metadata
      const supabaseMeta = supabaseUser.user_metadata || {};
      const avatarUrl = user.avatarUrl || supabaseMeta.avatar_url || supabaseMeta.picture;

      // Always show workspace picker - don't auto-select even for single tenant
      // This gives users better control and prevents confusion after logout
      response.tenants = userTenants.map((m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        slug: m.tenant.slug,
        type: m.tenant.type,
        plan: m.tenant.plan,
        role: {
          id: m.role.id,
          name: m.role.name,
        },
        is_owner: m.isOwner,
      }));
      response.redirect_url = '/select-workspace';

      return c.json(response);
    }

    // Fall back to authorization code flow (oauth_token)
    const parsed = signinSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'validation_error',
          message: parsed.error.errors[0]?.message || 'Invalid request',
        },
        400
      );
    }

    const { provider, oauth_token } = parsed.data;

    // Get pending OAuth data
    const pendingSignup = await oauthService.getPendingSignup(oauth_token);

    if (!pendingSignup) {
      return c.json(
        {
          error: 'invalid_oauth_token',
          message: 'OAuth session expired or invalid. Please try again.',
        },
        400
      );
    }

    // Check if user exists
    const user = await getUserByEmail(pendingSignup.email);

    if (!user) {
      return c.json(
        {
          error: 'user_not_found',
          message: 'No account found with this email. Please sign up first.',
          redirect: '/signup',
        },
        404
      );
    }

    // Check account status
    if (user.status === 'suspended') {
      return c.json(
        {
          error: 'account_suspended',
          message: 'Your account has been suspended. Please contact support.',
        },
        403
      );
    }

    if (user.status === 'deleted') {
      return c.json(
        {
          error: 'account_deleted',
          message: 'This account has been deleted.',
        },
        403
      );
    }

    // Check if OAuth is already linked
    const existingSocialLogin = await getSocialLogin(provider, pendingSignup.providerUserId);

    if (existingSocialLogin) {
      // OAuth is linked - proceed with signin
      if (existingSocialLogin.userId !== user.id) {
        return c.json(
          {
            error: 'oauth_linked_to_other',
            message: 'This social account is linked to a different user.',
          },
          403
        );
      }

      // Update last login timestamp
      await updateSocialLoginTimestamp(provider, pendingSignup.providerUserId);
    } else {
      // OAuth not linked - check if user has tenants (per Section 10.1)
      const userTenants = await getUserTenants(user.id);

      if (userTenants.length === 0) {
        // No tenants - auto-link (safe because no data at risk)
        await linkSocialLogin({
          userId: user.id,
          provider,
          providerUserId: pendingSignup.providerUserId,
          providerEmail: pendingSignup.email,
          ipAddress: ipAddress || undefined,
          userAgent: userAgent || undefined,
        });
      } else {
        // Has tenants - require verification
        const { linkToken, verificationCode } = await oauthService.createPendingLinkRequest(
          user.id,
          provider,
          pendingSignup.providerUserId,
          pendingSignup.email
        );

        // TODO: Send verification email with code
        console.log(`Link verification code for ${user.email}: ${verificationCode}`);

        // Clear the OAuth pending signup
        await oauthService.clearPendingSignup(oauth_token);

        return c.json(
          {
            requires_verification: true,
            link_token: linkToken,
            message: 'A verification code has been sent to your email. Enter it to link your account.',
          },
          403
        );
      }
    }

    // Clear OAuth pending signup
    await oauthService.clearPendingSignup(oauth_token);

    // Update last login
    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress || undefined,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Get user's tenants
    const userTenants = await getUserTenants(user.id);

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'login_oauth',
      resourceType: 'user',
      resourceId: user.id,
      details: {
        provider,
        tenant_count: userTenants.length,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    // Build response similar to signin
    const response: Record<string, unknown> = {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        email_verified: user.emailVerified,
        phone_verified: user.phoneVerified,
        mfa_enabled: user.mfaEnabled,
      },
    };

    // Determine redirect and tenant context
    if (userTenants.length === 0) {
      response.redirect_url = '/create-workspace';
    } else {
      // Always show workspace picker - don't auto-select even for single tenant
      // This gives users better control and prevents confusion after logout
      response.tenants = userTenants.map((m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        slug: m.tenant.slug,
        type: m.tenant.type,
        plan: m.tenant.plan,
        role: {
          id: m.role.id,
          name: m.role.name,
        },
        is_owner: m.isOwner,
      }));
      response.redirect_url = '/select-workspace';
    }

    return c.json(response);
  } catch (error) {
    console.error('OAuth signin error:', error);
    const message = error instanceof Error ? error.message : 'OAuth signin failed';

    return c.json(
      {
        error: 'signin_failed',
        message,
      },
      500
    );
  }
});

// Link initiate schema
const linkInitiateSchema = z.object({
  provider: z.enum(['google', 'github']),
  oauth_token: z.string().min(1, 'OAuth token is required'),
});

/**
 * POST /api/v1/auth/oauth/link/initiate
 * Start account linking for authenticated user
 */
app.post('/link/initiate', authMiddleware, zValidator('json', linkInitiateSchema), async (c) => {
  const user = c.get('user') as User;
  const { provider, oauth_token } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');

  try {
    // Get pending OAuth data
    const pendingSignup = await oauthService.getPendingSignup(oauth_token);

    if (!pendingSignup) {
      return c.json(
        {
          error: 'invalid_oauth_token',
          message: 'OAuth session expired or invalid. Please try again.',
        },
        400
      );
    }

    // Check if this provider is already linked to user
    const userSocialLogins = await getUserSocialLogins(user.id);
    const existingLink = userSocialLogins.find((sl) => sl.provider === provider);

    if (existingLink) {
      return c.json(
        {
          error: 'already_linked',
          message: `You already have a ${provider} account linked.`,
        },
        409
      );
    }

    // Check if this OAuth account is linked to another user
    const existingSocialLogin = await getSocialLogin(provider, pendingSignup.providerUserId);
    if (existingSocialLogin && existingSocialLogin.userId !== user.id) {
      return c.json(
        {
          error: 'oauth_linked_to_other',
          message: 'This social account is already linked to another user.',
        },
        409
      );
    }

    // Create pending link request
    const { linkToken, verificationCode } = await oauthService.createPendingLinkRequest(
      user.id,
      provider,
      pendingSignup.providerUserId,
      pendingSignup.email
    );

    // TODO: Send verification email with code
    console.log(`Link verification code for ${user.email}: ${verificationCode}`);

    // Clear the OAuth pending signup
    await oauthService.clearPendingSignup(oauth_token);

    return c.json({
      link_token: linkToken,
      provider,
      provider_email: pendingSignup.email,
      message: 'A verification code has been sent to your email.',
    });
  } catch (error) {
    console.error('OAuth link initiate error:', error);
    const message = error instanceof Error ? error.message : 'Failed to initiate linking';

    return c.json(
      {
        error: 'link_initiate_failed',
        message,
      },
      500
    );
  }
});

// Link verify schema
const linkVerifySchema = z.object({
  link_token: z.string().min(1, 'Link token is required'),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

/**
 * POST /api/v1/auth/oauth/link/verify
 * Verify link code and complete account linking
 */
app.post('/link/verify', authMiddleware, zValidator('json', linkVerifySchema), async (c) => {
  const user = c.get('user') as User;
  const { link_token, code } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  try {
    // Verify the code
    const result = await oauthService.verifyLinkCode(link_token, code);

    if (!result) {
      // Get remaining attempts
      const pendingLink = await oauthService.getPendingLink(link_token);

      if (!pendingLink) {
        return c.json(
          {
            error: 'link_expired',
            message: 'Link request has expired. Please try again.',
          },
          400
        );
      }

      return c.json(
        {
          error: 'invalid_code',
          message: 'Invalid verification code.',
          attempts_remaining: pendingLink.attemptsRemaining,
        },
        400
      );
    }

    // Verify the link is for this user
    const pendingLink = await oauthService.getPendingLink(link_token);
    if (pendingLink && pendingLink.userId !== user.id) {
      return c.json(
        {
          error: 'unauthorized',
          message: 'This link request is for a different user.',
        },
        403
      );
    }

    // Link the account
    await linkSocialLogin({
      userId: user.id,
      provider: result.provider,
      providerUserId: result.providerUserId,
      providerEmail: result.providerEmail,
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    });

    // Clear the pending link
    await oauthService.clearPendingLink(link_token);

    return c.json({
      success: true,
      provider: result.provider,
      message: `${result.provider} account linked successfully.`,
    });
  } catch (error) {
    console.error('OAuth link verify error:', error);
    const message = error instanceof Error ? error.message : 'Failed to complete linking';

    return c.json(
      {
        error: 'link_verify_failed',
        message,
      },
      500
    );
  }
});

/**
 * GET /api/v1/auth/oauth/providers
 * Get linked OAuth providers for current user
 */
app.get('/providers', authMiddleware, async (c) => {
  const user = c.get('user') as User;

  try {
    const socialLogins = await getUserSocialLogins(user.id);

    const providers = socialLogins.map((sl) => ({
      provider: sl.provider,
      provider_email: sl.providerEmail,
      linked_at: sl.createdAt,
      last_login_at: sl.lastLoginAt,
    }));

    return c.json({
      providers,
      available: ['google', 'github'].filter(
        (p) => !providers.some((sl) => sl.provider === p)
      ),
    });
  } catch (error) {
    console.error('Get OAuth providers error:', error);

    return c.json(
      {
        error: 'fetch_failed',
        message: 'Failed to fetch linked providers',
      },
      500
    );
  }
});

// Unlink provider schema
const unlinkSchema = z.object({
  provider: z.enum(['google', 'github']),
});

/**
 * DELETE /api/v1/auth/oauth/providers/:provider
 * Unlink an OAuth provider from current user
 */
app.delete('/providers/:provider', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const provider = c.req.param('provider') as 'google' | 'github';
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  if (!['google', 'github'].includes(provider)) {
    return c.json(
      {
        error: 'invalid_provider',
        message: 'Invalid OAuth provider',
      },
      400
    );
  }

  try {
    const result = await unlinkSocialLogin({
      userId: user.id,
      provider,
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    });

    return c.json({
      success: true,
      message: result.emailVerificationReset
        ? `${provider} account unlinked. Your email is no longer verified - please verify it again.`
        : `${provider} account unlinked successfully.`,
      email_verification_reset: result.emailVerificationReset,
    });
  } catch (error) {
    console.error('Unlink OAuth provider error:', error);
    const message = error instanceof Error ? error.message : 'Failed to unlink provider';

    return c.json(
      {
        error: 'unlink_failed',
        message,
      },
      500
    );
  }
});

// Complete signup schema for OAuth users
const completeSignupSchema = z.object({
  // Plan Selection
  plan: z.enum(['core', 'flow', 'scale', 'enterprise']).optional().default('core'),
  billing_cycle: z.enum(['monthly', 'annual']).optional().default('monthly'),
  license_count: z.number().int().min(1).max(1000).optional(),

  // User Details (optional - can be derived from OAuth profile)
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  // Password for OAuth users (set during signup flow)
  password: z.string().min(12).optional(),
  phone: z.string().min(5).max(20).optional(),
  phone_country_code: z.string().min(1).max(5).optional(),
  country: z.string().length(2).optional(),
  city: z.string().min(1).max(100).optional(),

  // Company Details (optional)
  company_name: z.string().min(2).max(200).optional(),
  industry: z.enum(['technology', 'finance', 'healthcare', 'manufacturing', 'retail', 'other']).optional(),
  company_size: z.enum(['1-10', '11-50', '51-200', '201-500', '500+']).optional(),

  // Workspace Setup
  workspace_name: z.string().min(2).max(100).optional(),
  workspace_subdomain: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/),
  compliance_requirements: z.array(z.enum(['GDPR', 'HIPAA', 'SOC2', 'PCI-DSS', 'ISO27001', 'CCPA', 'CPRA', 'APPI'])).optional().default([]),

  // Legal (already accepted during initial OAuth signup)
  terms_accepted: z.boolean().optional().default(true),
});

/**
 * POST /api/v1/auth/oauth/complete-signup
 * Complete signup for OAuth users with onboarding data
 * Requires Supabase access token in Authorization header
 */
app.post('/complete-signup', zValidator('json', completeSignupSchema), async (c) => {
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  // Get access token from Authorization header
  const authHeader = c.req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: 'unauthorized',
        message: 'Missing or invalid authorization header',
      },
      401
    );
  }

  const accessToken = authHeader.substring(7);

  try {
    // Verify token with Supabase and get user info
    const { user: supabaseUser, error: sessionError } = await getSession(accessToken);

    if (sessionError || !supabaseUser) {
      return c.json(
        {
          error: 'invalid_token',
          message: sessionError || 'Invalid or expired access token',
        },
        401
      );
    }

    // Get provider from Supabase user
    const provider = supabaseUser.app_metadata?.provider as 'google' | 'github' | undefined;
    if (!provider || !['google', 'github'].includes(provider)) {
      return c.json(
        {
          error: 'invalid_provider',
          message: 'OAuth provider not found or unsupported',
        },
        400
      );
    }

    // Check if user already exists in our database
    const existingUser = await getUserByEmail(supabaseUser.email!);

    // If user exists, create a new tenant for them instead of erroring
    if (existingUser) {
      // Check if the requested slug is available
      const slugAvailable = await isSlugAvailable(body.workspace_subdomain);
      if (!slugAvailable) {
        return c.json(
          {
            error: 'slug_unavailable',
            message: 'This workspace URL is already taken. Please choose a different subdomain.',
          },
          409
        );
      }

      // Derive workspace name from subdomain if not provided
      const workspaceName = body.workspace_name ||
        body.workspace_subdomain.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      // Create a new tenant for the existing user
      const tenantResult = await createTenant({
        name: workspaceName,
        slug: body.workspace_subdomain,
        type: body.plan === 'core' ? 'personal' : 'organization',
        ownerUserId: existingUser.id,
      });

      if (!tenantResult) {
        return c.json(
          {
            error: 'tenant_creation_failed',
            message: 'Failed to create workspace',
          },
          500
        );
      }

      // Get avatar from existing user or Supabase metadata
      const userMeta = supabaseUser.user_metadata || {};
      const avatarUrl = existingUser.avatarUrl || userMeta.avatar_url || userMeta.picture;

      // Update email_verified_via if not already set (for users created before this field existed)
      if (!existingUser.emailVerifiedVia && existingUser.emailVerified) {
        const db = getDb();
        await db
          .update(users)
          .set({
            emailVerifiedVia: provider,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUser.id));
      }

      // Generate secure opaque auth token stored in Redis
      const authToken = await createAuthToken({
        userId: existingUser.id,
        tenantId: tenantResult.tenant.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        avatarUrl: avatarUrl,
        avatarSource: existingUser.avatarSource || undefined,
        emailVerified: existingUser.emailVerified,
        emailVerifiedVia: existingUser.emailVerifiedVia || provider,
        roleId: tenantResult.ownerRole.id,
        roleName: tenantResult.ownerRole.name,
        roleSlug: tenantResult.ownerRole.slug,
        isOwner: tenantResult.membership.isOwner,
        supabaseAccessToken: accessToken,
      });

      // Check verification status - users can access dashboard during grace period
      const verificationStatus = await checkVerificationStatus(existingUser, tenantResult.tenant.id);
      const dashboardUrl = `https://${tenantResult.tenant.slug}.zygo.tech?auth_token=${authToken}`;

      return c.json(
        {
          success: true,
          user: {
            id: existingUser.id,
            email: existingUser.email,
            firstName: existingUser.firstName,
            lastName: existingUser.lastName,
            avatarUrl: avatarUrl,
          },
          tenant: tenantResult.tenant,
          role: tenantResult.ownerRole,
          auth_token: authToken,
          redirect_url: verificationStatus.complete ? dashboardUrl : '/complete-profile',
          dashboard_url: dashboardUrl,
          verification_status: {
            complete: verificationStatus.complete,
            missing: verificationStatus.missing,
            deadlines: verificationStatus.deadlines,
          },
        },
        201
      );
    }

    // Extract name from OAuth profile if not provided
    const userMeta = supabaseUser.user_metadata || {};
    const fullName = userMeta.full_name || userMeta.name || '';
    const nameParts = fullName.split(' ');
    const derivedFirstName = nameParts[0] || 'User';
    const derivedLastName = nameParts.slice(1).join(' ') || '';

    // Derive workspace name from subdomain if not provided
    const workspaceName = body.workspace_name ||
      body.workspace_subdomain.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    // Get avatar from OAuth provider
    const avatarUrl = userMeta.avatar_url || userMeta.picture;

    // Get the external provider's user ID (e.g., Google's sub claim)
    // This is stored in user_metadata.sub by Supabase
    const externalProviderUserId = userMeta.sub || userMeta.provider_id || supabaseUser.id;

    // Create user and tenant using signupWithOAuth
    const result = await signupWithOAuth({
      provider,
      supabaseUserId: supabaseUser.id, // Supabase auth.users UUID - for public.users.id
      providerUserId: externalProviderUserId, // External OAuth provider ID - for social_logins
      email: supabaseUser.email!,
      password: body.password, // Password set during OAuth signup flow
      firstName: body.first_name || derivedFirstName,
      lastName: body.last_name || derivedLastName,
      avatarUrl: avatarUrl, // Pass OAuth avatar URL

      plan: body.plan,
      billingCycle: body.billing_cycle,
      licenseCount: body.license_count,

      phone: body.phone,
      phoneCountryCode: body.phone_country_code,
      country: body.country,
      city: body.city,

      companyName: body.company_name,
      industry: body.industry,
      companySize: body.company_size,

      workspaceName: workspaceName,
      workspaceSubdomain: body.workspace_subdomain,
      complianceRequirements: body.compliance_requirements,

      termsAccepted: body.terms_accepted ?? true,
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    });

    // Generate secure opaque auth token stored in Redis
    const authToken = await createAuthToken({
      userId: result.user.id,
      tenantId: result.tenant.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      avatarUrl: avatarUrl,
      avatarSource: avatarUrl ? 'oauth' : undefined, // New OAuth signup
      emailVerified: result.user.emailVerified, // OAuth users are email-verified
      emailVerifiedVia: provider,
      roleId: result.role.id,
      roleName: result.role.name,
      roleSlug: result.role.slug,
      isOwner: true, // New signup = owner
      supabaseAccessToken: accessToken,
    });

    // Check if user needs to complete profile verification
    // Users can access dashboard during grace period for phone (3 days) and MFA (7 days)
    const verificationStatus = await checkVerificationStatus(result.user, result.tenant.id);
    const dashboardUrl = `https://${result.tenant.slug}.zygo.tech?auth_token=${authToken}`;

    // Only redirect to complete-profile if verification is actually required now
    // (profile incomplete, email unverified, or deadline passed)
    const redirectUrl = verificationStatus.complete ? dashboardUrl : '/complete-profile';

    return c.json(
      {
        success: true,
        user: { ...result.user, avatarUrl },
        tenant: result.tenant,
        role: result.role,
        auth_token: authToken,
        redirect_url: redirectUrl,
        dashboard_url: dashboardUrl,
        verification_status: {
          complete: verificationStatus.complete,
          missing: verificationStatus.missing,
          deadlines: verificationStatus.deadlines,
        },
      },
      201
    );
  } catch (error) {
    console.error('OAuth complete signup error:', error);
    const message = error instanceof Error ? error.message : 'Signup failed';

    if (message.includes('email already exists')) {
      return c.json(
        {
          error: 'email_exists',
          message: 'An account with this email already exists',
        },
        409
      );
    }

    if (message.includes('workspace URL') || message.includes('slug')) {
      return c.json(
        {
          error: 'slug_unavailable',
          message,
        },
        409
      );
    }

    return c.json(
      {
        error: 'signup_failed',
        message,
      },
      400
    );
  }
});

export default app;
