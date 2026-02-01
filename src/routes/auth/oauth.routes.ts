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
import { getUserTenants } from '../../services/tenant.service';
import { checkVerificationStatus } from '../../services/verification.service';
import { signInWithPassword } from '../../services/supabase.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getDb } from '../../db/client';
import { users, auditLogs } from '../../db/schema';
import type { User } from '../../db/schema';

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

// OAuth signin schema
const signinSchema = z.object({
  provider: z.enum(['google', 'github']),
  oauth_token: z.string().min(1, 'OAuth token is required'),
  tenant_slug: z.string().optional(),
});

/**
 * POST /api/v1/auth/oauth/signin
 * OAuth signin for existing users
 * Per Section 10.1 - Auto-link for users without tenants, verify for users with tenants
 */
app.post('/signin', zValidator('json', signinSchema), async (c) => {
  const { provider, oauth_token, tenant_slug } = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const db = getDb();

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
    } else if (userTenants.length === 1) {
      const tenant = userTenants[0].tenant;
      const verificationStatus = await checkVerificationStatus(user, tenant.id);

      response.current_tenant = {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        type: tenant.type,
        plan: tenant.plan,
      };

      response.verification_status = {
        complete: verificationStatus.complete,
        missing: verificationStatus.missing,
        deadlines: verificationStatus.deadlines,
      };

      response.redirect_url = verificationStatus.complete
        ? `https://${tenant.slug}.zygo.tech`
        : '/complete-profile';
    } else {
      // Multiple tenants - show picker
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
    await unlinkSocialLogin({
      userId: user.id,
      provider,
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    });

    return c.json({
      success: true,
      message: `${provider} account unlinked successfully.`,
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

export default app;
