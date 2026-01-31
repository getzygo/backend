/**
 * Signup Routes
 *
 * POST /api/v1/auth/signup - Create new account with tenant
 * Per UNIFIED_AUTH_STRATEGY.md Section 5.3.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { signup } from '../../services/signup.service';

const app = new Hono();

// Signup request schema
const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  tenant_name: z.string().min(2, 'Workspace name must be at least 2 characters').max(100),
  tenant_slug: z
    .string()
    .min(3, 'Workspace URL must be at least 3 characters')
    .max(50)
    .regex(
      /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/,
      'Workspace URL can only contain lowercase letters, numbers, and hyphens'
    ),
  tenant_type: z.enum(['personal', 'organization']).default('organization'),
  terms_accepted: z.boolean().refine((v) => v === true, {
    message: 'You must accept the terms of service',
  }),
});

/**
 * POST /api/v1/auth/signup
 * Create a new user account with a new tenant
 */
app.post('/', zValidator('json', signupSchema), async (c) => {
  const body = c.req.valid('json');

  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  try {
    const result = await signup({
      email: body.email,
      password: body.password,
      firstName: body.first_name,
      lastName: body.last_name,
      tenantName: body.tenant_name,
      tenantSlug: body.tenant_slug,
      tenantType: body.tenant_type,
      termsVersion: '1.0',
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    });

    return c.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        first_name: result.user.firstName,
        last_name: result.user.lastName,
        email_verified: result.user.emailVerified,
        phone_verified: result.user.phoneVerified,
        mfa_enabled: result.user.mfaEnabled,
      },
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        slug: result.tenant.slug,
        type: result.tenant.type,
        plan: result.tenant.plan,
        trial_expires_at: result.tenant.trialExpiresAt,
      },
      role: {
        id: result.role.id,
        name: result.role.name,
        hierarchy_level: result.role.hierarchyLevel,
        is_protected: result.role.isProtected,
      },
      requires_email_verification: result.requiresEmailVerification,
      verification_email_sent: result.verificationEmailSent,
      redirect_url: result.redirectUrl,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Signup failed';

    // Check for specific error types
    if (message.includes('email already exists')) {
      return c.json(
        {
          error: 'email_exists',
          message: 'An account with this email already exists',
        },
        409
      );
    }

    if (message.includes('slug') || message.includes('workspace URL')) {
      return c.json(
        {
          error: 'slug_unavailable',
          message,
        },
        409
      );
    }

    console.error('Signup error:', error);
    return c.json(
      {
        error: 'signup_failed',
        message,
      },
      400
    );
  }
});

// Check slug availability
app.get('/check-slug/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();

  // Import here to avoid circular dependency
  const { isSlugAvailable } = await import('../../services/tenant.service');

  const available = await isSlugAvailable(slug);

  return c.json({
    slug,
    available,
  });
});

export default app;
