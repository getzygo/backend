/**
 * OAuth Authentication Routes
 *
 * Handles OAuth callback code exchange and OAuth signup completion.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { oauthService } from '../../services/oauth.service';
import { userService } from '../../services/user.service';

const app = new Hono();

/**
 * POST /api/v1/auth/oauth/callback
 *
 * Exchange OAuth authorization code for user info.
 * Returns a temporary oauthToken that must be used to complete signup.
 */
const callbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  provider: z.enum(['google', 'github']),
  redirectUri: z.string().url('Invalid redirect URI'),
});

app.post('/callback', zValidator('json', callbackSchema), async (c) => {
  const { code, provider, redirectUri } = c.req.valid('json');

  try {
    const result = await oauthService.handleOAuthCallback(code, provider, redirectUri);

    return c.json({
      email: result.email,
      name: result.name,
      oauthToken: result.oauthToken,
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

/**
 * POST /api/v1/auth/signup/oauth
 *
 * Complete OAuth signup with password.
 * Requires a valid oauthToken from the callback endpoint.
 */
const signupSchema = z.object({
  provider: z.enum(['google', 'github']),
  oauthToken: z.string().min(1, 'OAuth token is required'),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain a special character'),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms and conditions' }),
  }),
  termsVersion: z.string().min(1, 'Terms version is required'),
});

app.post('/signup/oauth', zValidator('json', signupSchema), async (c) => {
  const { provider, oauthToken, email, password, termsVersion } = c.req.valid('json');

  // Get request metadata
  const ipAddress =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    undefined;
  const userAgent = c.req.header('user-agent') || undefined;

  try {
    // Verify the OAuth token and get pending signup data
    const pendingSignup = await oauthService.getPendingSignup(oauthToken);

    if (!pendingSignup) {
      return c.json(
        {
          error: 'invalid_oauth_token',
          message: 'OAuth session expired or invalid. Please try again.',
        },
        400
      );
    }

    // Verify the email matches
    if (pendingSignup.email.toLowerCase() !== email.toLowerCase()) {
      return c.json(
        {
          error: 'email_mismatch',
          message: 'Email does not match OAuth account',
        },
        400
      );
    }

    // Verify the provider matches
    if (pendingSignup.provider !== provider) {
      return c.json(
        {
          error: 'provider_mismatch',
          message: 'Provider does not match OAuth session',
        },
        400
      );
    }

    // Create the user
    const user = await userService.createUserWithOAuth({
      email: pendingSignup.email,
      password,
      provider: pendingSignup.provider,
      providerUserId: pendingSignup.providerUserId,
      name: pendingSignup.name,
      termsVersion,
      ipAddress,
      userAgent,
    });

    // Clear the pending signup
    await oauthService.clearPendingSignup(oauthToken);

    return c.json({
      success: true,
      userId: user.id,
    });
  } catch (error) {
    console.error('OAuth signup error:', error);

    const message = error instanceof Error ? error.message : 'Signup failed';

    // Check for specific error types
    if (message.includes('already exists')) {
      return c.json(
        {
          error: 'user_exists',
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
      500
    );
  }
});

export default app;
