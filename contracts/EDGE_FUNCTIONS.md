# Supabase Edge Functions

**Version:** 1.0.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready
**Runtime:** Deno

---

## Table of Contents

1. [Overview](#overview)
2. [When to Use Edge Functions](#when-to-use-edge-functions)
3. [Function Registry](#function-registry)
4. [Development Setup](#development-setup)
5. [Function Specifications](#function-specifications)
6. [Shared Utilities](#shared-utilities)
7. [Authentication](#authentication)
8. [Database Access](#database-access)
9. [Error Handling](#error-handling)
10. [Testing](#testing)
11. [Deployment](#deployment)
12. [Monitoring](#monitoring)

---

## Overview

Supabase Edge Functions are serverless Deno functions that run close to your database. They're ideal for lightweight operations that benefit from low latency and direct database access.

### Architecture Role

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EDGE FUNCTIONS ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Client Request                                 │  │
│  └─────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                         │
│                    ┌───────────────┴───────────────┐                        │
│                    ▼                               ▼                        │
│  ┌─────────────────────────────┐   ┌─────────────────────────────┐         │
│  │    Supabase Edge Function   │   │       Hono API Server       │         │
│  │         (Deno)              │   │         (Node.js)           │         │
│  ├─────────────────────────────┤   ├─────────────────────────────┤         │
│  │  ✓ Auth webhooks            │   │  ✓ Complex business logic   │         │
│  │  ✓ Database triggers        │   │  ✓ Long-running operations  │         │
│  │  ✓ Simple transformations   │   │  ✓ Background jobs          │         │
│  │  ✓ Realtime auth            │   │  ✓ WebSocket connections    │         │
│  │  ✓ Webhook handlers         │   │  ✓ External API calls       │         │
│  │                             │   │  ✓ File processing          │         │
│  │  Execution limit: 50s       │   │  No execution limit         │         │
│  │  Memory: 150MB              │   │  Configurable memory        │         │
│  └──────────────┬──────────────┘   └──────────────┬──────────────┘         │
│                 │                                  │                        │
│                 └──────────────┬───────────────────┘                        │
│                                ▼                                            │
│              ┌─────────────────────────────────────┐                        │
│              │         Supabase PostgreSQL         │                        │
│              │            (with RLS)               │                        │
│              └─────────────────────────────────────┘                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Characteristics

| Feature | Edge Functions | Hono API |
|---------|----------------|----------|
| **Runtime** | Deno | Node.js |
| **Execution Limit** | 50 seconds | Unlimited |
| **Memory** | 150MB | Configurable |
| **Cold Start** | ~200ms | None (always running) |
| **Database Access** | Direct via Supabase client | Via connection pool |
| **Best For** | Webhooks, triggers, auth | Complex logic, jobs |

---

## When to Use Edge Functions

### ✅ Use Edge Functions For

| Use Case | Reason |
|----------|--------|
| **Auth Webhooks** | Runs on every signup/login, needs to be fast |
| **Database Triggers** | React to database changes instantly |
| **Realtime Authorization** | Authorize channel subscriptions |
| **Lightweight API Endpoints** | Simple CRUD operations |
| **Webhook Receivers** | Receive external webhooks (Stripe, GitHub) |
| **Data Transformations** | Transform data before storage |

### ❌ Don't Use Edge Functions For

| Use Case | Reason | Use Instead |
|----------|--------|-------------|
| **Long-running operations** | 50s limit | Hono API + BullMQ |
| **Background jobs** | No persistence | BullMQ workers |
| **WebSocket connections** | Not supported | Hono WebSocket |
| **File processing** | Memory limits | Hono API |
| **Complex business logic** | Hard to debug | Hono services |
| **Multiple external API calls** | Timeout risk | Hono API |

---

## Function Registry

### Planned Edge Functions

| Function | Trigger | Purpose | Priority |
|----------|---------|---------|----------|
| `on-user-signup` | Auth webhook | Initialize user profile, send welcome email | P0 |
| `on-user-login` | Auth webhook | Update last login, log audit event | P0 |
| `on-password-reset` | Auth webhook | Log security event, notify user | P1 |
| `realtime-auth` | Realtime | Authorize channel subscriptions | P0 |
| `stripe-webhook` | HTTP POST | Handle Stripe payment events | P0 |
| `github-webhook` | HTTP POST | Handle GitHub repository events | P2 |
| `send-email` | HTTP POST | Send transactional emails | P1 |
| `generate-presigned-url` | HTTP POST | Generate S3 presigned URLs | P1 |
| `validate-workflow` | HTTP POST | Validate workflow JSON before save | P1 |

---

## Development Setup

### Project Structure

```
zygo-backend/
└── supabase/
    ├── functions/
    │   ├── _shared/                    # Shared utilities
    │   │   ├── supabase-client.ts      # Supabase client factory
    │   │   ├── cors.ts                 # CORS headers
    │   │   ├── auth.ts                 # Auth helpers
    │   │   ├── response.ts             # Response helpers
    │   │   └── types.ts                # Shared types
    │   │
    │   ├── on-user-signup/
    │   │   └── index.ts
    │   │
    │   ├── on-user-login/
    │   │   └── index.ts
    │   │
    │   ├── realtime-auth/
    │   │   └── index.ts
    │   │
    │   ├── stripe-webhook/
    │   │   └── index.ts
    │   │
    │   └── send-email/
    │       └── index.ts
    │
    ├── migrations/                     # Database migrations
    ├── seed.sql                        # Seed data
    └── config.toml                     # Supabase configuration
```

### Local Development

```bash
# Install Supabase CLI
npm install -g supabase

# Initialize Supabase (if not already done)
cd zygo-backend
supabase init

# Start local Supabase
supabase start

# Serve functions locally
supabase functions serve

# Serve specific function with env vars
supabase functions serve on-user-signup --env-file ./supabase/.env.local
```

### Environment Variables

```bash
# supabase/.env.local
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your-local-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key

# Production secrets (set via dashboard or CLI)
SMTP_HOST=smtp.example.com
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

---

## Function Specifications

### on-user-signup

Triggered when a new user signs up via Supabase Auth.

```typescript
// supabase/functions/on-user-signup/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders } from '../_shared/cors.ts';

interface AuthWebhookPayload {
  type: 'signup' | 'login' | 'password_recovery';
  table: string;
  record: {
    id: string;
    email: string;
    email_confirmed_at: string | null;
    phone: string | null;
    created_at: string;
    updated_at: string;
    raw_user_meta_data: Record<string, unknown>;
    raw_app_meta_data: Record<string, unknown>;
  };
  schema: string;
  old_record: null;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: AuthWebhookPayload = await req.json();

    // Validate this is a signup event
    if (payload.type !== 'signup') {
      return new Response(
        JSON.stringify({ message: 'Not a signup event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { record: user } = payload;

    // Create Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Extract metadata
    const firstName = user.raw_user_meta_data?.first_name as string | undefined;
    const lastName = user.raw_user_meta_data?.last_name as string | undefined;
    const tenantId = user.raw_user_meta_data?.tenant_id as string | undefined;

    // Create user profile in our users table
    const { error: profileError } = await supabaseAdmin
      .from('users')
      .insert({
        id: user.id,
        tenant_id: tenantId,
        email: user.email,
        first_name: firstName,
        last_name: lastName,
        display_name: firstName && lastName ? `${firstName} ${lastName}` : undefined,
        status: 'pending',
        email_verified: !!user.email_confirmed_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
      });

    if (profileError) {
      console.error('Failed to create user profile:', profileError);
      throw profileError;
    }

    // Assign default role (if tenant exists)
    if (tenantId) {
      const { data: defaultRole } = await supabaseAdmin
        .from('roles')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', 'member')
        .single();

      if (defaultRole) {
        await supabaseAdmin.from('user_roles').insert({
          user_id: user.id,
          role_id: defaultRole.id,
          tenant_id: tenantId,
        });
      }
    }

    // Log audit event
    await supabaseAdmin.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: user.id,
      event_type: 'user.signup',
      event_category: 'auth',
      action: 'create',
      status: 'success',
      resource_type: 'user',
      resource_id: user.id,
      new_values: {
        email: user.email,
        first_name: firstName,
        last_name: lastName,
      },
    });

    // Queue welcome email (call Hono API or use edge function)
    // This keeps the webhook fast
    await fetch(`${Deno.env.get('API_URL')}/internal/email/welcome`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': Deno.env.get('INTERNAL_API_KEY') ?? '',
      },
      body: JSON.stringify({
        userId: user.id,
        email: user.email,
        firstName,
      }),
    });

    return new Response(
      JSON.stringify({ success: true, userId: user.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('on-user-signup error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

### on-user-login

Triggered when a user logs in.

```typescript
// supabase/functions/on-user-login/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders } from '../_shared/cors.ts';

interface LoginWebhookPayload {
  type: 'login';
  table: string;
  record: {
    id: string;
    email: string;
    last_sign_in_at: string;
  };
  schema: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: LoginWebhookPayload = await req.json();

    if (payload.type !== 'login') {
      return new Response(JSON.stringify({ message: 'Not a login event' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { record: user } = payload;

    // Get client IP and user agent from headers
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    const userAgent = req.headers.get('user-agent') ?? 'unknown';

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Update last login timestamp
    await supabaseAdmin
      .from('users')
      .update({
        last_login_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    // Get user's tenant for audit log
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    // Log audit event
    await supabaseAdmin.from('audit_logs').insert({
      tenant_id: userData?.tenant_id,
      user_id: user.id,
      user_email: user.email,
      event_type: 'user.login',
      event_category: 'auth',
      action: 'login',
      status: 'success',
      ip_address: clientIp,
      user_agent: userAgent,
      metadata: {
        login_method: 'password', // or oauth provider
      },
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('on-user-login error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

### realtime-auth

Authorizes Realtime channel subscriptions.

```typescript
// supabase/functions/realtime-auth/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders } from '../_shared/cors.ts';

interface RealtimeAuthPayload {
  channel: string;
  socket_id: string;
  claims: {
    sub: string; // user_id
    role: string;
    aal: string;
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: RealtimeAuthPayload = await req.json();
    const { channel, claims } = payload;

    // Extract channel info
    // Format: tenant:{tenant_id}:executions or tenant:{tenant_id}:notifications
    const channelParts = channel.split(':');

    if (channelParts[0] !== 'tenant' || channelParts.length < 3) {
      return new Response(
        JSON.stringify({ authorized: false, reason: 'Invalid channel format' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tenantId = channelParts[1];
    const channelType = channelParts[2];

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user belongs to tenant
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, tenant_id, status')
      .eq('id', claims.sub)
      .single();

    if (error || !user) {
      return new Response(
        JSON.stringify({ authorized: false, reason: 'User not found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check tenant membership
    if (user.tenant_id !== tenantId) {
      return new Response(
        JSON.stringify({ authorized: false, reason: 'Not a member of this tenant' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check user status
    if (user.status !== 'active') {
      return new Response(
        JSON.stringify({ authorized: false, reason: 'User account is not active' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Additional checks based on channel type
    if (channelType === 'admin') {
      // Verify user has admin permissions
      const { data: permissions } = await supabaseAdmin
        .rpc('get_user_permissions', { p_user_id: claims.sub });

      const hasAdminAccess = permissions?.some(
        (p: string) => p === 'canViewAdminDashboard' || p === 'canManageTenant'
      );

      if (!hasAdminAccess) {
        return new Response(
          JSON.stringify({ authorized: false, reason: 'Insufficient permissions' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ authorized: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('realtime-auth error:', error);
    return new Response(
      JSON.stringify({ authorized: false, reason: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

### stripe-webhook

Handles Stripe webhook events.

```typescript
// supabase/functions/stripe-webhook/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.10.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return new Response(
        JSON.stringify({ error: 'Missing signature' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(supabaseAdmin, session);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(supabaseAdmin, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCancelled(supabaseAdmin, subscription);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(supabaseAdmin, invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(supabaseAdmin, invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('stripe-webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function handleCheckoutComplete(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session
) {
  const tenantId = session.metadata?.tenant_id;
  if (!tenantId) return;

  // Update tenant subscription
  await supabase
    .from('subscriptions')
    .update({
      stripe_subscription_id: session.subscription as string,
      stripe_customer_id: session.customer as string,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId);

  // Log audit event
  await supabase.from('audit_logs').insert({
    tenant_id: tenantId,
    event_type: 'subscription.checkout_completed',
    event_category: 'billing',
    action: 'create',
    status: 'success',
    metadata: {
      session_id: session.id,
      amount_total: session.amount_total,
    },
  });
}

async function handleSubscriptionUpdate(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription
) {
  // Get tenant by Stripe customer ID
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tenant_id')
    .eq('stripe_customer_id', subscription.customer)
    .single();

  if (!sub) return;

  // Map Stripe status to our status
  const statusMap: Record<string, string> = {
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled',
    unpaid: 'unpaid',
    trialing: 'trialing',
  };

  await supabase
    .from('subscriptions')
    .update({
      status: statusMap[subscription.status] || subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);
}

async function handleSubscriptionCancelled(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription
) {
  await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);
}

async function handleInvoicePaid(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice
) {
  // Record invoice
  await supabase.from('invoices').upsert({
    stripe_invoice_id: invoice.id,
    stripe_customer_id: invoice.customer as string,
    amount: invoice.amount_paid,
    currency: invoice.currency,
    status: 'paid',
    paid_at: new Date().toISOString(),
    invoice_url: invoice.hosted_invoice_url,
    invoice_pdf: invoice.invoice_pdf,
  });
}

async function handlePaymentFailed(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice
) {
  // Get tenant
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tenant_id')
    .eq('stripe_customer_id', invoice.customer)
    .single();

  if (!sub) return;

  // Log audit event
  await supabase.from('audit_logs').insert({
    tenant_id: sub.tenant_id,
    event_type: 'payment.failed',
    event_category: 'billing',
    action: 'update',
    status: 'failure',
    metadata: {
      invoice_id: invoice.id,
      amount: invoice.amount_due,
      attempt_count: invoice.attempt_count,
    },
  });

  // TODO: Send notification to tenant owner
}
```

### send-email

Sends transactional emails.

```typescript
// supabase/functions/send-email/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { SMTPClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface EmailRequest {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
}

const templates: Record<string, (data: Record<string, unknown>) => string> = {
  welcome: (data) => `
    <h1>Welcome to Zygo, ${data.firstName}!</h1>
    <p>We're excited to have you on board.</p>
    <p>Get started by <a href="${data.dashboardUrl}">logging into your dashboard</a>.</p>
  `,

  password_reset: (data) => `
    <h1>Reset Your Password</h1>
    <p>Click the link below to reset your password:</p>
    <p><a href="${data.resetUrl}">${data.resetUrl}</a></p>
    <p>This link expires in 1 hour.</p>
  `,

  invitation: (data) => `
    <h1>You've Been Invited!</h1>
    <p>${data.inviterName} has invited you to join ${data.tenantName} on Zygo.</p>
    <p><a href="${data.inviteUrl}">Accept Invitation</a></p>
  `,

  workflow_complete: (data) => `
    <h1>Workflow Completed</h1>
    <p>Your workflow "${data.workflowName}" has completed successfully.</p>
    <p>Duration: ${data.duration}</p>
    <p><a href="${data.executionUrl}">View Execution Details</a></p>
  `,

  workflow_failed: (data) => `
    <h1>Workflow Failed</h1>
    <p>Your workflow "${data.workflowName}" has failed.</p>
    <p>Error: ${data.errorMessage}</p>
    <p><a href="${data.executionUrl}">View Execution Details</a></p>
  `,
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Verify internal API key
  const apiKey = req.headers.get('x-internal-key');
  if (apiKey !== Deno.env.get('INTERNAL_API_KEY')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { to, subject, template, data }: EmailRequest = await req.json();

    // Get template
    const templateFn = templates[template];
    if (!templateFn) {
      return new Response(
        JSON.stringify({ error: `Unknown template: ${template}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = templateFn(data);

    // Create SMTP client
    const client = new SMTPClient({
      connection: {
        hostname: Deno.env.get('SMTP_HOST') ?? '',
        port: parseInt(Deno.env.get('SMTP_PORT') ?? '587'),
        tls: true,
        auth: {
          username: Deno.env.get('SMTP_USER') ?? '',
          password: Deno.env.get('SMTP_PASS') ?? '',
        },
      },
    });

    // Send email
    await client.send({
      from: Deno.env.get('EMAIL_FROM') ?? 'noreply@zygo.tech',
      to,
      subject,
      content: 'auto',
      html,
    });

    await client.close();

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('send-email error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

---

## Shared Utilities

### CORS Headers

```typescript
// supabase/functions/_shared/cors.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
```

### Supabase Client Factory

```typescript
// supabase/functions/_shared/supabase-client.ts
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export function createSupabaseAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export function createSupabaseClient(authHeader: string): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: { Authorization: authHeader },
      },
    }
  );
}
```

### Response Helpers

```typescript
// supabase/functions/_shared/response.ts
import { corsHeaders } from './cors.ts';

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

export function successResponse(data: unknown = { success: true }): Response {
  return jsonResponse(data, 200);
}
```

---

## Testing

### Local Testing

```bash
# Serve function locally
supabase functions serve on-user-signup --env-file ./supabase/.env.local

# Test with curl
curl -X POST http://localhost:54321/functions/v1/on-user-signup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d '{
    "type": "signup",
    "record": {
      "id": "test-user-id",
      "email": "test@example.com",
      "raw_user_meta_data": {
        "first_name": "Test",
        "last_name": "User"
      }
    }
  }'
```

### Unit Tests

```typescript
// supabase/functions/on-user-signup/index.test.ts
import { assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';

Deno.test('on-user-signup creates user profile', async () => {
  // Mock Supabase client
  // Test function logic
});
```

---

## Deployment

### Deploy All Functions

```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy on-user-signup
```

### Set Secrets

```bash
# Set secrets for production
supabase secrets set SMTP_HOST=smtp.example.com
supabase secrets set SMTP_USER=your-user
supabase secrets set SMTP_PASS=your-password
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
supabase secrets set INTERNAL_API_KEY=your-internal-key

# List secrets
supabase secrets list
```

### Configure Auth Webhooks

In Supabase Dashboard → Authentication → Hooks:

| Hook | Function URL |
|------|--------------|
| On User Created | `https://your-project.supabase.co/functions/v1/on-user-signup` |
| On User Signed In | `https://your-project.supabase.co/functions/v1/on-user-login` |

---

## Monitoring

### View Logs

```bash
# View function logs
supabase functions logs on-user-signup

# Follow logs in real-time
supabase functions logs on-user-signup --follow
```

### Metrics

Monitor in Supabase Dashboard → Edge Functions:
- Invocation count
- Error rate
- Execution duration
- Cold start frequency

---

## Changelog

### v1.0.0 (January 26, 2026)
- Initial Edge Functions specification
- Auth webhook functions (signup, login)
- Realtime authorization
- Stripe webhook handler
- Email sending function
- Shared utilities
- Testing and deployment guides
