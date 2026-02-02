/**
 * Signup Routes
 *
 * POST /api/v1/auth/signup - Complete onboarding wizard signup
 * GET /api/v1/auth/signup/check-slug/:slug - Check workspace URL availability
 * GET /api/v1/auth/signup/plans - Get available plans
 *
 * Per UNIFIED_AUTH_STRATEGY.md Section 5.
 *
 * Onboarding Steps:
 * 1. Plan Selection (plan, billing_cycle, license_count)
 * 2. User Details (name, phone, country, city)
 * 3. Company Details (company_name, industry, company_size) - skippable for Core plan
 * 4. Workspace Setup (subdomain, compliance_requirements)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { signup } from '../../services/signup.service';
import { createAuthToken } from '../../services/auth-token.service';
import { getDb } from '../../db/client';
import { users } from '../../db/schema';

const app = new Hono();

// Plan types
const planEnum = z.enum(['core', 'flow', 'scale', 'enterprise']);
const billingCycleEnum = z.enum(['monthly', 'annual']);
const industryEnum = z.enum(['technology', 'finance', 'healthcare', 'manufacturing', 'retail', 'other']);
const companySizeEnum = z.enum(['1-10', '11-50', '51-200', '201-500', '500+']);
const complianceEnum = z.enum(['GDPR', 'HIPAA', 'SOC2', 'PCI-DSS', 'ISO27001']);

// Complete onboarding signup schema
const signupSchema = z.object({
  // Step 1: Plan Selection
  plan: planEnum,
  billing_cycle: billingCycleEnum,
  license_count: z.number().int().min(1).max(1000).optional(),

  // Step 2: User Details
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  first_name: z.string().max(100).optional().default(''),
  last_name: z.string().max(100).optional().default(''),
  phone: z.string().min(5, 'Phone number is required').max(20),
  phone_country_code: z.string().min(1).max(5),
  country: z.string().length(2, 'Country must be ISO 3166-1 alpha-2 code'),
  city: z.string().min(1, 'City is required').max(100),

  // Step 3: Company Details (optional for Core plan)
  company_name: z.string().min(2).max(200).optional(),
  industry: industryEnum.optional(),
  company_size: companySizeEnum.optional(),

  // Step 4: Workspace Setup
  workspace_name: z.string().min(2, 'Workspace name must be at least 2 characters').max(100),
  workspace_subdomain: z
    .string()
    .min(3, 'Workspace URL must be at least 3 characters')
    .max(50)
    .regex(
      /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/,
      'Workspace URL can only contain lowercase letters, numbers, and hyphens'
    ),
  compliance_requirements: z.array(complianceEnum).optional().default([]),

  // Legal
  terms_accepted: z.boolean().refine((v) => v === true, {
    message: 'You must accept the terms of service',
  }),
}).refine(
  // Company details required for non-core plans
  (data) => {
    if (data.plan !== 'core') {
      return !!data.company_name;
    }
    return true;
  },
  {
    message: 'Company name is required for organization plans',
    path: ['company_name'],
  }
);

/**
 * POST /api/v1/auth/signup
 * Complete onboarding wizard signup
 */
app.post('/', zValidator('json', signupSchema), async (c) => {
  const body = c.req.valid('json');

  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  try {
    const result = await signup({
      // Step 1: Plan
      plan: body.plan,
      billingCycle: body.billing_cycle,
      licenseCount: body.license_count,

      // Step 2: User Details
      email: body.email,
      password: body.password,
      firstName: body.first_name,
      lastName: body.last_name,
      phone: body.phone,
      phoneCountryCode: body.phone_country_code,
      country: body.country,
      city: body.city,

      // Step 3: Company Details
      companyName: body.company_name,
      industry: body.industry,
      companySize: body.company_size,

      // Step 4: Workspace
      workspaceName: body.workspace_name,
      workspaceSubdomain: body.workspace_subdomain,
      complianceRequirements: body.compliance_requirements,

      // Meta
      termsAccepted: body.terms_accepted,
      termsVersion: '1.0',
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    });

    // Create auth token for redirect to tenant app
    const authToken = await createAuthToken({
      userId: result.user.id,
      tenantId: result.tenant.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      avatarUrl: undefined,
      emailVerified: result.user.emailVerified,
      emailVerifiedVia: undefined,
      roleId: result.role.id,
      roleName: result.role.name,
      roleSlug: result.role.slug,
      isOwner: true,
    });

    // Build redirect URL with auth token
    const redirectUrl = `https://${result.tenant.slug}.zygo.tech?auth_token=${authToken}`;

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
        billing_cycle: result.tenant.billingCycle,
        license_count: result.tenant.licenseCount,
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
      redirect_url: redirectUrl,
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

    if (message.includes('Company name is required')) {
      return c.json(
        {
          error: 'company_required',
          message,
        },
        400
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

/**
 * GET /api/v1/auth/signup/check-slug/:slug
 * Check if workspace subdomain is available
 */
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

// Schema for existing user creating new workspace
const createWorkspaceSchema = z.object({
  // Authentication
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),

  // Plan Selection
  plan: planEnum,
  billing_cycle: billingCycleEnum,
  license_count: z.number().int().min(1).max(1000).optional(),

  // Workspace Setup
  workspace_name: z.string().min(2, 'Workspace name must be at least 2 characters').max(100),
  workspace_subdomain: z
    .string()
    .min(3, 'Workspace URL must be at least 3 characters')
    .max(50)
    .regex(
      /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/,
      'Workspace URL can only contain lowercase letters, numbers, and hyphens'
    ),
  compliance_requirements: z.array(complianceEnum).optional().default([]),

  // Company Details (optional)
  company_name: z.string().min(2).max(200).optional(),
  industry: industryEnum.optional(),
  company_size: companySizeEnum.optional(),
});

/**
 * POST /api/v1/auth/signup/create-workspace
 * Create a new workspace for an existing user (requires password verification)
 * Similar to OAuth flow but for email/password users
 */
app.post('/create-workspace', zValidator('json', createWorkspaceSchema), async (c) => {
  const body = c.req.valid('json');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const normalizedEmail = body.email.toLowerCase().trim();
  const normalizedSlug = body.workspace_subdomain.toLowerCase().trim();

  try {
    // Import services
    const { signInWithPassword } = await import('../../services/supabase.service');
    const { createTenant, isSlugAvailable, userHasCorePlanTenant, hasUserUsedTrial } = await import('../../services/tenant.service');
    const { getUserByEmail } = await import('../../services/user.service');
    const { checkVerificationStatus } = await import('../../services/verification.service');

    // 1. Verify user exists
    const user = await getUserByEmail(normalizedEmail);
    if (!user) {
      return c.json(
        {
          error: 'user_not_found',
          message: 'No account found with this email. Please sign up first.',
        },
        404
      );
    }

    // 2. Verify password with Supabase
    const authResult = await signInWithPassword(normalizedEmail, body.password);
    if (authResult.error || !authResult.session) {
      return c.json(
        {
          error: 'invalid_credentials',
          message: 'Invalid email or password',
        },
        401
      );
    }

    // 3. Check if slug is available
    const slugAvailable = await isSlugAvailable(normalizedSlug);
    if (!slugAvailable) {
      return c.json(
        {
          error: 'slug_unavailable',
          message: 'This workspace URL is already taken',
        },
        409
      );
    }

    // 4. Check Core plan limit (1 free workspace per user)
    if (body.plan === 'core') {
      const hasCore = await userHasCorePlanTenant(user.id);
      if (hasCore) {
        return c.json(
          {
            error: 'core_limit_reached',
            message: 'You can only have one free (Core) workspace. Please select a paid plan.',
          },
          409
        );
      }
    }

    // 5. Create the new tenant
    const tenantResult = await createTenant({
      name: body.workspace_name,
      slug: normalizedSlug,
      type: body.plan === 'core' ? 'personal' : 'organization',
      ownerUserId: user.id,
      plan: body.plan,
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

    // 6. Create auth token for redirect
    const authToken = await createAuthToken({
      userId: user.id,
      tenantId: tenantResult.tenant.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl || undefined,
      emailVerified: user.emailVerified,
      emailVerifiedVia: user.emailVerifiedVia || undefined,
      roleId: tenantResult.ownerRole.id,
      roleName: tenantResult.ownerRole.name,
      roleSlug: tenantResult.ownerRole.slug,
      isOwner: true,
    });

    // 7. Build redirect URL
    const redirectUrl = `https://${tenantResult.tenant.slug}.zygo.tech?auth_token=${authToken}`;

    // 8. Check verification status for response
    const verificationStatus = await checkVerificationStatus(user, tenantResult.tenant.id);

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        email_verified: user.emailVerified,
      },
      tenant: {
        id: tenantResult.tenant.id,
        name: tenantResult.tenant.name,
        slug: tenantResult.tenant.slug,
        type: tenantResult.tenant.type,
        plan: tenantResult.tenant.plan,
        trial_expires_at: tenantResult.tenant.trialExpiresAt,
        subscription_status: tenantResult.tenant.subscriptionStatus,
      },
      role: {
        id: tenantResult.ownerRole.id,
        name: tenantResult.ownerRole.name,
      },
      verification_status: {
        complete: verificationStatus.complete,
        missing: verificationStatus.missing,
      },
      redirect_url: redirectUrl,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create workspace';

    // Handle specific errors
    if (message.includes('Core') || message.includes('free workspace')) {
      return c.json(
        {
          error: 'core_limit_reached',
          message,
        },
        409
      );
    }

    console.error('Create workspace error:', error);
    return c.json(
      {
        error: 'create_workspace_failed',
        message,
      },
      400
    );
  }
});

/**
 * GET /api/v1/auth/signup/check-email/:email
 * Check if email is available for signup
 * Returns user info if exists (for "create new workspace" flow)
 */
app.get('/check-email/:email', async (c) => {
  const email = c.req.param('email').toLowerCase().trim();

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return c.json({
      email,
      available: false,
      error: 'Invalid email format',
    });
  }

  // Check if email exists in users table
  const db = getDb();
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: {
      id: true,
      firstName: true,
      lastName: true,
      hasUsedTrial: true,
    },
  });

  if (!existingUser) {
    return c.json({
      email,
      available: true,
      user_exists: false,
    });
  }

  // User exists - check their workspace info for the "create new workspace" flow
  const { userHasCorePlanTenant } = await import('../../services/tenant.service');
  const hasCorePlan = await userHasCorePlanTenant(existingUser.id);

  return c.json({
    email,
    available: false,
    user_exists: true,
    can_create_workspace: true,
    has_used_trial: existingUser.hasUsedTrial,
    has_core_plan: hasCorePlan,
  });
});

/**
 * GET /api/v1/auth/signup/plans
 * Get available plans and pricing
 */
app.get('/plans', async (c) => {
  const plans = [
    {
      id: 'core',
      name: 'Core',
      description: 'For individuals and small projects',
      price_monthly: 0,
      price_annual: 0,
      features: [
        'Single user',
        'Up to 10 workflows',
        'Basic AI nodes',
        'Community support',
        '1GB storage',
      ],
      limits: {
        users: 1,
        workflows: 10,
        executions_per_month: 1000,
        storage_gb: 1,
      },
      is_free: true,
      requires_company: false,
    },
    {
      id: 'flow',
      name: 'Flow',
      description: 'For growing teams',
      price_monthly: 29,
      price_annual: 290, // ~17% discount
      features: [
        'Per-user licensing',
        'Unlimited workflows',
        'Advanced AI nodes',
        'Email support',
        '10GB storage',
        'API access',
        'Team collaboration',
      ],
      limits: {
        users: 50,
        workflows: -1, // unlimited
        executions_per_month: 50000,
        storage_gb: 10,
      },
      is_free: false,
      requires_company: true,
      popular: true,
    },
    {
      id: 'scale',
      name: 'Scale',
      description: 'For scaling businesses',
      price_monthly: 99,
      price_annual: 990, // ~17% discount
      features: [
        'Everything in Flow',
        'Priority support',
        'Advanced security',
        'SSO integration',
        'Custom workflows',
        '100GB storage',
        'Audit logs',
      ],
      limits: {
        users: 200,
        workflows: -1,
        executions_per_month: 200000,
        storage_gb: 100,
      },
      is_free: false,
      requires_company: true,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      description: 'For large organizations',
      price_monthly: null, // Custom pricing
      price_annual: null,
      features: [
        'Everything in Scale',
        'Unlimited users',
        'Dedicated support',
        'Custom SLA',
        'On-premise option',
        'Unlimited storage',
        'Custom integrations',
      ],
      limits: {
        users: -1, // unlimited
        workflows: -1,
        executions_per_month: -1,
        storage_gb: -1,
      },
      is_free: false,
      requires_company: true,
      contact_sales: true,
    },
  ];

  const industries = [
    { value: 'technology', label: 'Technology' },
    { value: 'finance', label: 'Finance' },
    { value: 'healthcare', label: 'Healthcare' },
    { value: 'manufacturing', label: 'Manufacturing' },
    { value: 'retail', label: 'Retail' },
    { value: 'other', label: 'Other' },
  ];

  const companySizes = [
    { value: '1-10', label: '1-10 employees' },
    { value: '11-50', label: '11-50 employees' },
    { value: '51-200', label: '51-200 employees' },
    { value: '201-500', label: '201-500 employees' },
    { value: '500+', label: '500+ employees' },
  ];

  const complianceOptions = [
    { value: 'GDPR', label: 'GDPR', description: 'General Data Protection Regulation (EU)' },
    { value: 'HIPAA', label: 'HIPAA', description: 'Health Insurance Portability and Accountability Act (US)' },
    { value: 'SOC2', label: 'SOC 2', description: 'Service Organization Control 2' },
    { value: 'PCI-DSS', label: 'PCI-DSS', description: 'Payment Card Industry Data Security Standard' },
    { value: 'ISO27001', label: 'ISO 27001', description: 'Information Security Management' },
  ];

  return c.json({
    plans,
    industries,
    company_sizes: companySizes,
    compliance_options: complianceOptions,
  });
});

export default app;
