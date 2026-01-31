# Zygo Authentication Strategy

**Version:** 1.1.0
**Last Updated:** January 26, 2026
**Status:** Production-Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication Methods](#authentication-methods)
3. [Supabase Auth Integration](#supabase-auth-integration)
4. [Email/Password Authentication](#emailpassword-authentication)
5. [Social Authentication](#social-authentication)
6. [Enterprise SSO](#enterprise-sso)
7. [Session Management](#session-management)
8. [Multi-Factor Authentication](#multi-factor-authentication)
9. [Suspicious Activity Detection](#suspicious-activity-detection)
10. [Phone Verification with Twilio SMS](#phone-verification-with-twilio-sms)
11. [Security Measures](#security-measures)
12. [API Endpoints](#api-endpoints)
13. [Database Schema](#database-schema)
14. [Implementation Guide](#implementation-guide)

---

## Overview

### Authentication Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Zygo Authentication Layer                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Email/     │  │   Social     │  │  Enterprise  │  │    Magic     │ │
│  │   Password   │  │   OAuth      │  │     SSO      │  │    Link      │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                 │                 │          │
│         └────────────┬────┴────────┬────────┴────────┬────────┘          │
│                      │             │                 │                   │
│                      ▼             ▼                 ▼                   │
│              ┌─────────────────────────────────────────┐                 │
│              │           Supabase Auth                 │                 │
│              │    (GoTrue - Authentication Server)     │                 │
│              └─────────────────┬───────────────────────┘                 │
│                                │                                         │
│                                ▼                                         │
│              ┌─────────────────────────────────────────┐                 │
│              │         JWT Token Generation            │                 │
│              │    + Custom Claims (tenant, role)       │                 │
│              └─────────────────┬───────────────────────┘                 │
│                                │                                         │
│                                ▼                                         │
│              ┌─────────────────────────────────────────┐                 │
│              │            Zygo Backend                 │                 │
│              │     (Hono + Auth Middleware)            │                 │
│              └─────────────────────────────────────────┘                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Supported Authentication Methods

| Method | Use Case | MFA Support | Enterprise |
|--------|----------|-------------|------------|
| Email/Password | Standard signup/login | ✅ Yes | ✅ Yes |
| Google OAuth | Social login | ✅ Yes | ✅ Yes |
| GitHub OAuth | Developer login | ✅ Yes | ✅ Yes |
| Microsoft OAuth | Enterprise login | ✅ Yes | ✅ Yes |
| Apple OAuth | iOS/Mac users | ✅ Yes | ✅ Yes |
| SAML 2.0 | Enterprise SSO | ✅ Yes | ✅ Required |
| OIDC | Enterprise SSO | ✅ Yes | ✅ Required |
| Magic Link | Passwordless | ❌ No | ❌ No |

---

## Authentication Methods

### Method Priority by Tenant Type

```typescript
interface AuthMethodConfig {
  // Available for all tenants
  emailPassword: boolean;
  magicLink: boolean;

  // Social providers (configurable per tenant)
  google: boolean;
  github: boolean;
  microsoft: boolean;
  apple: boolean;

  // Enterprise only (Business/Enterprise plans)
  saml: boolean;
  oidc: boolean;

  // Enforcement
  mfaRequired: boolean;
  ssoEnforced: boolean;  // Disables other methods when true
}

// Default configurations by plan
const AUTH_CONFIG_BY_PLAN: Record<string, AuthMethodConfig> = {
  free: {
    emailPassword: true,
    magicLink: true,
    google: true,
    github: true,
    microsoft: false,
    apple: false,
    saml: false,
    oidc: false,
    mfaRequired: false,
    ssoEnforced: false,
  },
  basic: {
    emailPassword: true,
    magicLink: true,
    google: true,
    github: true,
    microsoft: true,
    apple: true,
    saml: false,
    oidc: false,
    mfaRequired: false,
    ssoEnforced: false,
  },
  business: {
    emailPassword: true,
    magicLink: true,
    google: true,
    github: true,
    microsoft: true,
    apple: true,
    saml: true,
    oidc: true,
    mfaRequired: false,  // Configurable
    ssoEnforced: false,  // Configurable
  },
  enterprise: {
    emailPassword: true,
    magicLink: true,
    google: true,
    github: true,
    microsoft: true,
    apple: true,
    saml: true,
    oidc: true,
    mfaRequired: true,   // Default on
    ssoEnforced: false,  // Configurable
  },
};
```

---

## Supabase Auth Integration

### How Zygo Uses Supabase Auth

Zygo leverages Supabase Auth (GoTrue) as the authentication backbone:

```typescript
// supabase/config.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',  // Use PKCE for security
    },
  }
);
```

### Custom JWT Claims

Zygo injects custom claims into Supabase JWTs via database hooks:

```sql
-- Function to add custom claims to JWT
CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claims jsonb;
  user_tenant_id uuid;
  user_role text;
  user_permissions text[];
  is_global_admin boolean;
BEGIN
  -- Get user's tenant and role
  SELECT
    tm.tenant_id,
    r.name,
    ARRAY_AGG(DISTINCT p.name),
    COALESCE(u.is_global_admin, false)
  INTO user_tenant_id, user_role, user_permissions, is_global_admin
  FROM auth.users au
  LEFT JOIN public.users u ON u.auth_id = au.id
  LEFT JOIN public.tenant_memberships tm ON tm.user_id = u.id AND tm.is_active = true
  LEFT JOIN public.roles r ON r.id = tm.role_id
  LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
  LEFT JOIN public.permissions p ON p.id = rp.permission_id
  WHERE au.id = (event->>'user_id')::uuid
  GROUP BY tm.tenant_id, r.name, u.is_global_admin
  LIMIT 1;

  -- Build custom claims
  claims := event->'claims';
  claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_tenant_id));
  claims := jsonb_set(claims, '{role}', to_jsonb(user_role));
  claims := jsonb_set(claims, '{permissions}', to_jsonb(user_permissions));
  claims := jsonb_set(claims, '{is_global_admin}', to_jsonb(is_global_admin));

  -- Return modified event
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Register the hook
ALTER ROLE supabase_auth_admin SET pgrst.db_extra_search_path = 'auth';
```

### JWT Token Structure

```typescript
interface ZygoJWTPayload {
  // Standard Supabase claims
  aud: string;           // "authenticated"
  exp: number;           // Expiration timestamp
  iat: number;           // Issued at timestamp
  iss: string;           // Issuer URL
  sub: string;           // User UUID (auth.users.id)
  email: string;
  email_confirmed_at: string;
  phone: string;
  phone_confirmed_at: string;

  // Zygo custom claims
  tenant_id: string;     // Current tenant UUID
  role: string;          // Role name (owner, admin, member, etc.)
  permissions: string[]; // Array of permission names
  is_global_admin: boolean;

  // Auth metadata
  app_metadata: {
    provider: string;    // "email", "google", "github", etc.
    providers: string[];
  };
  user_metadata: {
    full_name?: string;
    avatar_url?: string;
  };
}
```

---

## Email/Password Authentication

### Signup Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User    │     │  Zygo    │     │ Supabase │     │  Email   │     │ Database │
│  Browser │     │  API     │     │   Auth   │     │ Service  │     │          │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │                │
     │ 1. POST /auth/signup            │                │                │
     │ {email, password, company_name} │                │                │
     │───────────────>│                │                │                │
     │                │                │                │                │
     │                │ 2. Validate    │                │                │
     │                │    input       │                │                │
     │                │                │                │                │
     │                │ 3. signUp()    │                │                │
     │                │───────────────>│                │                │
     │                │                │                │                │
     │                │                │ 4. Create user │                │
     │                │                │───────────────────────────────>│
     │                │                │                │                │
     │                │                │ 5. Send verification email     │
     │                │                │───────────────>│                │
     │                │                │                │                │
     │                │ 6. Return      │                │                │
     │                │    session     │                │                │
     │                │<───────────────│                │                │
     │                │                │                │                │
     │                │ 7. Create tenant & user profile │                │
     │                │─────────────────────────────────────────────────>│
     │                │                │                │                │
     │ 8. Return session + redirect   │                │                │
     │<───────────────│                │                │                │
     │                │                │                │                │
     │ 9. User clicks verification link                │                │
     │───────────────────────────────>│                │                │
     │                │                │                │                │
     │                │                │ 10. Verify email               │
     │                │                │───────────────────────────────>│
     │                │                │                │                │
```

```typescript
// POST /api/v1/auth/signup
interface SignupRequest {
  email: string;
  password: string;
  company_name: string;
  full_name?: string;
  phone?: string;
  referral_code?: string;
  plan?: 'free' | 'basic' | 'business';
  compliance?: ('gdpr' | 'ccpa' | 'hipaa')[];
}

interface SignupResponse {
  user: {
    id: string;
    email: string;
    email_confirmed: boolean;
  };
  tenant: {
    id: string;
    name: string;
    subdomain: string;
  };
  session: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at: number;
  };
  requires_email_verification: boolean;
}

// Implementation
async function signup(req: SignupRequest): Promise<SignupResponse> {
  // 1. Validate input
  const validated = signupSchema.parse(req);

  // 2. Check if email already exists
  const existing = await supabase.auth.admin.getUserByEmail(validated.email);
  if (existing.data.user) {
    throw new AuthError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
  }

  // 3. Create auth user with Supabase
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: validated.email,
    password: validated.password,
    options: {
      data: {
        full_name: validated.full_name,
      },
      emailRedirectTo: `${APP_URL}/auth/callback`,
    },
  });

  if (authError) throw authError;

  // 4. Create tenant
  const tenant = await db.insert(tenants).values({
    name: validated.company_name,
    subdomain: generateSubdomain(validated.company_name),
    plan: validated.plan || 'free',
    compliance_frameworks: validated.compliance || [],
    owner_id: authData.user!.id,
  }).returning();

  // 5. Create user profile
  const user = await db.insert(users).values({
    auth_id: authData.user!.id,
    email: validated.email,
    full_name: validated.full_name,
    tenant_id: tenant[0].id,
  }).returning();

  // 6. Assign owner role
  const ownerRole = await db.query.roles.findFirst({
    where: eq(roles.name, 'owner'),
  });

  await db.insert(tenantMemberships).values({
    tenant_id: tenant[0].id,
    user_id: user[0].id,
    role_id: ownerRole!.id,
    is_active: true,
  });

  // 7. Log audit event
  await auditLog({
    action: 'user.signup',
    actor_id: user[0].id,
    tenant_id: tenant[0].id,
    details: { provider: 'email', plan: validated.plan },
  });

  return {
    user: {
      id: user[0].id,
      email: validated.email,
      email_confirmed: false,
    },
    tenant: {
      id: tenant[0].id,
      name: tenant[0].name,
      subdomain: tenant[0].subdomain,
    },
    session: {
      access_token: authData.session!.access_token,
      refresh_token: authData.session!.refresh_token,
      expires_in: authData.session!.expires_in!,
      expires_at: authData.session!.expires_at!,
    },
    requires_email_verification: true,
  };
}
```

### Login Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User    │     │  Zygo    │     │ Supabase │     │ Database │
│  Browser │     │  API     │     │   Auth   │     │          │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │
     │ 1. POST /auth/login             │                │
     │ {email, password}               │                │
     │───────────────>│                │                │
     │                │                │                │
     │                │ 2. Check rate  │                │
     │                │    limit       │                │
     │                │                │                │
     │                │ 3. signInWithPassword()        │
     │                │───────────────>│                │
     │                │                │                │
     │                │                │ 4. Verify     │
     │                │                │    credentials │
     │                │                │                │
     │                │ 5. Return JWT  │                │
     │                │<───────────────│                │
     │                │                │                │
     │                │ 6. Check MFA   │                │
     │                │    requirement │                │
     │                │───────────────────────────────>│
     │                │                │                │
     │                │ 7. Update last_login           │
     │                │───────────────────────────────>│
     │                │                │                │
     │ 8. Return session (or MFA challenge)           │
     │<───────────────│                │                │
     │                │                │                │
```

```typescript
// POST /api/v1/auth/login
interface LoginRequest {
  email: string;
  password: string;
  remember_me?: boolean;
}

interface LoginResponse {
  session?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at: number;
  };
  user?: {
    id: string;
    email: string;
    full_name: string;
    avatar_url: string;
  };
  tenant?: {
    id: string;
    name: string;
    subdomain: string;
  };
  // MFA challenge (if MFA enabled)
  mfa_required?: boolean;
  mfa_challenge?: {
    challenge_id: string;
    factors: Array<{
      id: string;
      type: 'totp' | 'phone';
      friendly_name: string;
    }>;
  };
}

// Implementation
async function login(req: LoginRequest): Promise<LoginResponse> {
  const { email, password, remember_me } = req;

  // 1. Rate limit check
  const rateLimitKey = `login:${email}`;
  const attempts = await redis.incr(rateLimitKey);
  if (attempts === 1) {
    await redis.expire(rateLimitKey, 900); // 15 minutes
  }
  if (attempts > 5) {
    throw new AuthError('TOO_MANY_ATTEMPTS', 'Too many login attempts. Try again in 15 minutes.');
  }

  // 2. Authenticate with Supabase
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Log failed attempt
    await auditLog({
      action: 'auth.login_failed',
      details: { email, reason: error.message },
    });
    throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // 3. Clear rate limit on success
  await redis.del(rateLimitKey);

  // 4. Get user profile with tenant
  const user = await db.query.users.findFirst({
    where: eq(users.auth_id, data.user.id),
    with: {
      tenantMemberships: {
        where: eq(tenantMemberships.is_active, true),
        with: {
          tenant: true,
          role: true,
        },
      },
    },
  });

  if (!user) {
    throw new AuthError('USER_NOT_FOUND', 'User profile not found');
  }

  // 5. Check if MFA is required
  const { data: mfaFactors } = await supabase.auth.mfa.listFactors();
  const hasActiveMFA = mfaFactors?.totp?.some(f => f.status === 'verified');

  if (hasActiveMFA) {
    // Return MFA challenge
    const { data: challenge } = await supabase.auth.mfa.challenge({
      factorId: mfaFactors!.totp![0].id,
    });

    return {
      mfa_required: true,
      mfa_challenge: {
        challenge_id: challenge!.id,
        factors: mfaFactors!.totp!.map(f => ({
          id: f.id,
          type: 'totp',
          friendly_name: f.friendly_name || 'Authenticator App',
        })),
      },
    };
  }

  // 6. Update last login
  await db.update(users)
    .set({ last_login_at: new Date() })
    .where(eq(users.id, user.id));

  // 7. Log successful login
  await auditLog({
    action: 'auth.login',
    actor_id: user.id,
    tenant_id: user.tenantMemberships[0]?.tenant_id,
    details: { provider: 'email' },
  });

  const membership = user.tenantMemberships[0];

  return {
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
    },
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      avatar_url: user.avatar_url,
    },
    tenant: membership ? {
      id: membership.tenant.id,
      name: membership.tenant.name,
      subdomain: membership.tenant.subdomain,
    } : undefined,
  };
}
```

### Password Reset Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User    │     │  Zygo    │     │ Supabase │     │  Email   │
│  Browser │     │  API     │     │   Auth   │     │ Service  │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │
     │ 1. POST /auth/forgot-password   │                │
     │ {email}        │                │                │
     │───────────────>│                │                │
     │                │                │                │
     │                │ 2. Rate limit  │                │
     │                │    check       │                │
     │                │                │                │
     │                │ 3. Generate    │                │
     │                │    6-digit code│                │
     │                │                │                │
     │                │ 4. Store code  │                │
     │                │    (Redis)     │                │
     │                │                │                │
     │                │ 5. Send email  │                │
     │                │───────────────────────────────>│
     │                │                │                │
     │ 6. Return success (always)     │                │
     │<───────────────│                │                │
     │                │                │                │
     │ 7. POST /auth/verify-code      │                │
     │ {email, code}  │                │                │
     │───────────────>│                │                │
     │                │                │                │
     │                │ 8. Verify code │                │
     │                │                │                │
     │ 9. Return reset_token          │                │
     │<───────────────│                │                │
     │                │                │                │
     │ 10. POST /auth/reset-password  │                │
     │ {token, new_password}          │                │
     │───────────────>│                │                │
     │                │                │                │
     │                │ 11. Update password            │
     │                │───────────────>│                │
     │                │                │                │
     │ 12. Success    │                │                │
     │<───────────────│                │                │
     │                │                │                │
```

```typescript
// Step 1: Request password reset
// POST /api/v1/auth/forgot-password
interface ForgotPasswordRequest {
  email: string;
}

async function forgotPassword(req: ForgotPasswordRequest): Promise<void> {
  const { email } = req;

  // Rate limit: 3 requests per email per hour
  const rateLimitKey = `password_reset:${email}`;
  const attempts = await redis.incr(rateLimitKey);
  if (attempts === 1) await redis.expire(rateLimitKey, 3600);
  if (attempts > 3) {
    // Still return success to prevent email enumeration
    return;
  }

  // Check if user exists (silently fail if not)
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (!user) {
    // Return success anyway to prevent email enumeration
    return;
  }

  // Generate 6-digit code
  const code = crypto.randomInt(100000, 999999).toString();

  // Store code in Redis with 15-minute expiry
  await redis.setex(
    `password_reset_code:${email}`,
    900, // 15 minutes
    JSON.stringify({
      code,
      attempts: 0,
      created_at: Date.now(),
    })
  );

  // Send email
  await emailService.send({
    to: email,
    template: 'password-reset-code',
    data: {
      code,
      expires_in: '15 minutes',
      user_name: user.full_name,
    },
  });

  // Audit log
  await auditLog({
    action: 'auth.password_reset_requested',
    actor_id: user.id,
    details: { email },
  });
}

// Step 2: Verify code
// POST /api/v1/auth/verify-code
interface VerifyCodeRequest {
  email: string;
  code: string;
}

interface VerifyCodeResponse {
  reset_token: string;
  expires_at: string;
}

async function verifyResetCode(req: VerifyCodeRequest): Promise<VerifyCodeResponse> {
  const { email, code } = req;

  const storedData = await redis.get(`password_reset_code:${email}`);
  if (!storedData) {
    throw new AuthError('CODE_EXPIRED', 'Reset code has expired. Please request a new one.');
  }

  const { code: storedCode, attempts } = JSON.parse(storedData);

  // Max 5 attempts
  if (attempts >= 5) {
    await redis.del(`password_reset_code:${email}`);
    throw new AuthError('TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Please request a new code.');
  }

  if (code !== storedCode) {
    // Increment attempts
    await redis.setex(
      `password_reset_code:${email}`,
      await redis.ttl(`password_reset_code:${email}`),
      JSON.stringify({ code: storedCode, attempts: attempts + 1 })
    );
    throw new AuthError('INVALID_CODE', 'Invalid verification code');
  }

  // Code verified - generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Store reset token
  await redis.setex(
    `password_reset_token:${resetToken}`,
    600, // 10 minutes
    email
  );

  // Delete the code
  await redis.del(`password_reset_code:${email}`);

  return {
    reset_token: resetToken,
    expires_at: expiresAt.toISOString(),
  };
}

// Step 3: Reset password
// POST /api/v1/auth/reset-password
interface ResetPasswordRequest {
  token: string;
  new_password: string;
}

async function resetPassword(req: ResetPasswordRequest): Promise<void> {
  const { token, new_password } = req;

  // Validate password strength
  validatePasswordStrength(new_password);

  // Get email from token
  const email = await redis.get(`password_reset_token:${token}`);
  if (!email) {
    throw new AuthError('INVALID_TOKEN', 'Reset token is invalid or has expired');
  }

  // Get user
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    throw new AuthError('USER_NOT_FOUND', 'User not found');
  }

  // Update password via Supabase Admin
  const { error } = await supabase.auth.admin.updateUserById(user.auth_id, {
    password: new_password,
  });

  if (error) {
    throw new AuthError('PASSWORD_UPDATE_FAILED', 'Failed to update password');
  }

  // Invalidate all sessions
  await supabase.auth.admin.signOut(user.auth_id, 'global');

  // Delete reset token
  await redis.del(`password_reset_token:${token}`);

  // Audit log
  await auditLog({
    action: 'auth.password_reset',
    actor_id: user.id,
    details: { method: 'email_code' },
  });

  // Send confirmation email
  await emailService.send({
    to: email,
    template: 'password-changed',
    data: {
      user_name: user.full_name,
      changed_at: new Date().toISOString(),
    },
  });
}

// Password validation
function validatePasswordStrength(password: string): void {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  if (errors.length > 0) {
    throw new ValidationError('WEAK_PASSWORD', errors.join('. '));
  }
}
```

### Logout Flow

```typescript
// POST /api/v1/auth/logout
interface LogoutRequest {
  scope?: 'local' | 'global'; // Default: 'local'
}

async function logout(req: LogoutRequest, ctx: AuthContext): Promise<void> {
  const { scope = 'local' } = req;

  if (scope === 'global') {
    // Sign out all devices
    await supabase.auth.admin.signOut(ctx.user.auth_id, 'global');
  } else {
    // Sign out current session only
    await supabase.auth.signOut();
  }

  // Audit log
  await auditLog({
    action: 'auth.logout',
    actor_id: ctx.user.id,
    tenant_id: ctx.tenant_id,
    details: { scope },
  });
}
```

---

## Social Authentication

### Google Sign-In

```typescript
// Initiate Google OAuth
// GET /api/v1/auth/oauth/google
async function initiateGoogleAuth(req: Request): Promise<Response> {
  const redirectTo = req.query.redirect_to || '/dashboard';

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${APP_URL}/auth/callback?redirect_to=${redirectTo}`,
      scopes: 'email profile',
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) throw error;

  return Response.redirect(data.url);
}

// Handle Google callback
// GET /api/v1/auth/oauth/google/callback
async function handleGoogleCallback(req: Request): Promise<Response> {
  const code = req.query.code;
  const redirectTo = req.query.redirect_to || '/dashboard';

  // Exchange code for session
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return Response.redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // Check if user profile exists
  let user = await db.query.users.findFirst({
    where: eq(users.auth_id, data.user.id),
  });

  if (!user) {
    // New user - create profile and tenant
    const tenant = await createTenantForSocialUser(data.user);
    user = await createUserProfile(data.user, tenant.id);

    // Redirect to onboarding
    return Response.redirect('/onboarding');
  }

  // Existing user - update social login
  await upsertSocialLogin({
    user_id: user.id,
    provider: 'google',
    provider_user_id: data.user.user_metadata.provider_id,
    email: data.user.email,
    name: data.user.user_metadata.full_name,
    avatar_url: data.user.user_metadata.avatar_url,
  });

  // Audit log
  await auditLog({
    action: 'auth.social_login',
    actor_id: user.id,
    tenant_id: user.tenant_id,
    details: { provider: 'google' },
  });

  return Response.redirect(redirectTo);
}
```

### GitHub Sign-In

```typescript
// Initiate GitHub OAuth
// GET /api/v1/auth/oauth/github
async function initiateGitHubAuth(req: Request): Promise<Response> {
  const redirectTo = req.query.redirect_to || '/dashboard';

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${APP_URL}/auth/callback?redirect_to=${redirectTo}`,
      scopes: 'read:user user:email',
    },
  });

  if (error) throw error;

  return Response.redirect(data.url);
}

// Handle GitHub callback
// GET /api/v1/auth/oauth/github/callback
async function handleGitHubCallback(req: Request): Promise<Response> {
  const code = req.query.code;
  const redirectTo = req.query.redirect_to || '/dashboard';

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return Response.redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // Check if user profile exists
  let user = await db.query.users.findFirst({
    where: eq(users.auth_id, data.user.id),
  });

  if (!user) {
    // New user - create profile and tenant
    const tenant = await createTenantForSocialUser(data.user);
    user = await createUserProfile(data.user, tenant.id);

    return Response.redirect('/onboarding');
  }

  // Existing user - update social login
  await upsertSocialLogin({
    user_id: user.id,
    provider: 'github',
    provider_user_id: data.user.user_metadata.provider_id,
    email: data.user.email,
    name: data.user.user_metadata.full_name || data.user.user_metadata.user_name,
    avatar_url: data.user.user_metadata.avatar_url,
  });

  await auditLog({
    action: 'auth.social_login',
    actor_id: user.id,
    tenant_id: user.tenant_id,
    details: { provider: 'github' },
  });

  return Response.redirect(redirectTo);
}
```

### Social Login UI Integration

```typescript
// Login page component showing social buttons
interface LoginPageProps {
  enabledProviders: ('google' | 'github' | 'microsoft' | 'apple')[];
  ssoEnforced?: boolean;
}

// API to get enabled providers for a tenant (or default)
// GET /api/v1/auth/providers?domain=example.com
interface AuthProvidersResponse {
  email_password: boolean;
  magic_link: boolean;
  social: {
    google: boolean;
    github: boolean;
    microsoft: boolean;
    apple: boolean;
  };
  enterprise_sso?: {
    enabled: boolean;
    provider: 'saml' | 'oidc';
    login_url: string;
    button_text: string;  // e.g., "Sign in with Acme Corp SSO"
  };
  sso_enforced: boolean;  // If true, only show SSO option
}
```

---

## Enterprise SSO

### SAML 2.0 Configuration

```typescript
interface SAMLConfiguration {
  id: string;
  tenant_id: string;

  // Identity Provider (IdP) settings
  idp_entity_id: string;           // e.g., "https://idp.example.com/saml"
  idp_sso_url: string;             // Login URL
  idp_slo_url?: string;            // Logout URL (optional)
  idp_certificate: string;         // X.509 certificate (PEM format)

  // Service Provider (SP) settings - Zygo
  sp_entity_id: string;            // e.g., "https://zygo.tech/saml/acme"
  sp_acs_url: string;              // Assertion Consumer Service URL
  sp_slo_url?: string;             // Single Logout URL

  // Attribute mapping
  attribute_mapping: {
    email: string;                 // e.g., "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
    first_name?: string;
    last_name?: string;
    full_name?: string;
    groups?: string;               // For role mapping
  };

  // Role mapping (IdP groups -> Zygo roles)
  role_mapping?: Record<string, string>;  // e.g., { "Admins": "admin", "Users": "member" }
  default_role: string;            // Default role if no mapping matches

  // Settings
  enforce_sso: boolean;            // Disable other auth methods
  allow_unverified_email: boolean;
  auto_provision_users: boolean;   // Create users on first login

  // Status
  status: 'pending' | 'active' | 'disabled';
  verified_at?: string;

  created_at: string;
  updated_at: string;
}
```

### OIDC Configuration

```typescript
interface OIDCConfiguration {
  id: string;
  tenant_id: string;

  // Provider settings
  issuer_url: string;              // e.g., "https://login.example.com"
  client_id: string;
  client_secret: string;           // Encrypted

  // Discovery (auto-populated from .well-known/openid-configuration)
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;

  // Scopes
  scopes: string[];                // e.g., ["openid", "profile", "email", "groups"]

  // Claim mapping
  claim_mapping: {
    email: string;                 // e.g., "email"
    name?: string;
    given_name?: string;
    family_name?: string;
    groups?: string;               // e.g., "groups" or "roles"
  };

  // Role mapping
  role_mapping?: Record<string, string>;
  default_role: string;

  // Settings
  enforce_sso: boolean;
  auto_provision_users: boolean;

  // PKCE settings
  use_pkce: boolean;               // Recommended: true

  status: 'pending' | 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}
```

### Enterprise SSO Setup Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Enterprise SSO Setup Wizard                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Step 1: Choose Provider Type                                           │
│  ┌─────────────────────┐  ┌─────────────────────┐                       │
│  │     SAML 2.0        │  │      OIDC           │                       │
│  │  ○ Okta             │  │  ○ Azure AD         │                       │
│  │  ○ OneLogin         │  │  ○ Google Workspace │                       │
│  │  ○ PingIdentity     │  │  ○ Auth0            │                       │
│  │  ○ ADFS             │  │  ○ Custom OIDC      │                       │
│  │  ○ Custom SAML      │  │                     │                       │
│  └─────────────────────┘  └─────────────────────┘                       │
│                                                                          │
│  Step 2: Configure Identity Provider                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Entity ID / Issuer URL:  [_______________________________]      │   │
│  │ SSO URL:                 [_______________________________]      │   │
│  │ Certificate:             [Upload X.509 Certificate]             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Step 3: Map Attributes                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Email attribute:    [email________________________] (required)   │   │
│  │ Name attribute:     [displayName_________________] (optional)    │   │
│  │ Groups attribute:   [groups______________________] (optional)    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Step 4: Test Connection                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [Test SSO Login]                                                 │   │
│  │                                                                   │   │
│  │ ✅ Connection successful                                         │   │
│  │ ✅ User attributes received                                      │   │
│  │ ✅ Email: admin@example.com                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Step 5: Enforcement Settings                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ☐ Enforce SSO for all users (disable email/password login)      │   │
│  │ ☑ Auto-provision new users on first SSO login                   │   │
│  │ ☐ Allow existing users to link SSO to their account             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│                              [Cancel]  [Save & Activate]                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### SSO Migration Strategy

When a tenant migrates from social/email auth to Enterprise SSO:

```typescript
// Migration phases
enum SSOMigrationPhase {
  DISABLED = 'disabled',           // SSO not configured
  CONFIGURED = 'configured',       // SSO configured but not enforced
  PILOT = 'pilot',                 // SSO available, select users testing
  SOFT_ENFORCE = 'soft_enforce',   // SSO encouraged, others still work
  HARD_ENFORCE = 'hard_enforce',   // SSO only, others disabled
}

interface SSOMigration {
  tenant_id: string;
  phase: SSOMigrationPhase;

  // Migration settings
  pilot_users?: string[];          // User IDs in pilot group
  grace_period_end?: string;       // When soft_enforce becomes hard_enforce

  // User mapping
  email_domain: string;            // e.g., "example.com"
  auto_link_existing: boolean;     // Link existing users by email

  // Fallback settings (during transition)
  allow_recovery_codes: boolean;   // Allow backup access
  admin_bypass_emails: string[];   // Admins who can still use email/password
}

// Migration API
// POST /api/v1/admin/sso/migration
interface StartMigrationRequest {
  target_phase: SSOMigrationPhase;
  grace_period_days?: number;      // For soft_enforce
  notify_users: boolean;
}

async function startSSOMigration(req: StartMigrationRequest, ctx: AuthContext): Promise<void> {
  // Verify tenant has SSO configured
  const ssoConfig = await db.query.ssoConfigurations.findFirst({
    where: and(
      eq(ssoConfigurations.tenant_id, ctx.tenant_id),
      eq(ssoConfigurations.status, 'active')
    ),
  });

  if (!ssoConfig) {
    throw new Error('SSO must be configured and active before migration');
  }

  // Update migration phase
  await db.update(tenants)
    .set({
      sso_migration_phase: req.target_phase,
      sso_grace_period_end: req.grace_period_days
        ? new Date(Date.now() + req.grace_period_days * 24 * 60 * 60 * 1000)
        : null,
    })
    .where(eq(tenants.id, ctx.tenant_id));

  // Notify users if requested
  if (req.notify_users) {
    const users = await db.query.users.findMany({
      where: eq(users.tenant_id, ctx.tenant_id),
    });

    await emailService.sendBulk(
      users.map(u => ({
        to: u.email,
        template: 'sso-migration-notice',
        data: {
          phase: req.target_phase,
          grace_period_end: req.target_phase === 'soft_enforce'
            ? req.grace_period_days
            : null,
        },
      }))
    );
  }

  await auditLog({
    action: 'sso.migration_started',
    actor_id: ctx.user.id,
    tenant_id: ctx.tenant_id,
    details: { target_phase: req.target_phase },
  });
}
```

### Linking Existing Accounts to SSO

```typescript
// When user logs in via SSO, link to existing account
async function handleSSOLogin(ssoUser: SSOUser, tenant: Tenant): Promise<User> {
  // Check if SSO identity already linked
  const existingLink = await db.query.ssoIdentities.findFirst({
    where: and(
      eq(ssoIdentities.tenant_id, tenant.id),
      eq(ssoIdentities.provider_user_id, ssoUser.provider_user_id)
    ),
  });

  if (existingLink) {
    // Existing SSO user - just update tokens and return
    await db.update(ssoIdentities)
      .set({ last_login_at: new Date() })
      .where(eq(ssoIdentities.id, existingLink.id));

    return db.query.users.findFirst({
      where: eq(users.id, existingLink.user_id),
    });
  }

  // Check for existing user with same email
  const existingUser = await db.query.users.findFirst({
    where: and(
      eq(users.email, ssoUser.email.toLowerCase()),
      eq(users.tenant_id, tenant.id)
    ),
  });

  if (existingUser) {
    // Link SSO to existing account
    if (tenant.sso_auto_link_existing) {
      await db.insert(ssoIdentities).values({
        tenant_id: tenant.id,
        user_id: existingUser.id,
        provider: ssoUser.provider,
        provider_user_id: ssoUser.provider_user_id,
        email: ssoUser.email,
      });

      await auditLog({
        action: 'sso.account_linked',
        actor_id: existingUser.id,
        tenant_id: tenant.id,
        details: {
          provider: ssoUser.provider,
          method: 'auto_link',
        },
      });

      return existingUser;
    } else {
      // Require manual linking
      throw new AuthError(
        'ACCOUNT_EXISTS',
        'An account with this email already exists. Please log in with your password and link your SSO account.'
      );
    }
  }

  // New user - auto-provision if enabled
  if (tenant.sso_auto_provision_users) {
    const newUser = await createUserFromSSO(ssoUser, tenant);
    return newUser;
  }

  throw new AuthError(
    'USER_NOT_PROVISIONED',
    'Your account has not been provisioned. Please contact your administrator.'
  );
}
```

---

## Session Management

### Token Lifecycle

```typescript
// Token configuration
const TOKEN_CONFIG = {
  access_token: {
    lifetime: 3600,           // 1 hour
    refresh_threshold: 300,   // Refresh when < 5 minutes remaining
  },
  refresh_token: {
    lifetime: 604800,         // 7 days (default)
    lifetime_remember_me: 2592000,  // 30 days (remember me)
    reuse_interval: 10,       // 10 seconds reuse window
  },
};

// Token refresh middleware
async function tokenRefreshMiddleware(ctx: Context, next: () => Promise<void>) {
  const session = ctx.get('session');

  if (session) {
    const expiresAt = session.expires_at * 1000;
    const refreshThreshold = TOKEN_CONFIG.access_token.refresh_threshold * 1000;

    // Check if token needs refresh
    if (expiresAt - Date.now() < refreshThreshold) {
      try {
        const { data, error } = await supabase.auth.refreshSession({
          refresh_token: session.refresh_token,
        });

        if (!error && data.session) {
          // Set new tokens in response
          ctx.set('new_session', {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
          });
        }
      } catch (e) {
        // Log but don't block request
        console.error('Token refresh failed:', e);
      }
    }
  }

  await next();
}
```

### Multi-Device Session Management

```typescript
// Get all active sessions for a user
// GET /api/v1/auth/sessions
interface Session {
  id: string;
  created_at: string;
  last_active_at: string;
  ip_address: string;
  user_agent: string;
  device: {
    type: 'desktop' | 'mobile' | 'tablet';
    os: string;
    browser: string;
  };
  location?: {
    city: string;
    country: string;
  };
  is_current: boolean;
}

async function getSessions(ctx: AuthContext): Promise<Session[]> {
  const sessions = await db.query.userSessions.findMany({
    where: and(
      eq(userSessions.user_id, ctx.user.id),
      eq(userSessions.is_active, true)
    ),
    orderBy: [desc(userSessions.last_active_at)],
  });

  return sessions.map(s => ({
    id: s.id,
    created_at: s.created_at,
    last_active_at: s.last_active_at,
    ip_address: maskIP(s.ip_address),
    user_agent: s.user_agent,
    device: parseUserAgent(s.user_agent),
    location: s.location,
    is_current: s.id === ctx.session_id,
  }));
}

// Revoke a specific session
// DELETE /api/v1/auth/sessions/:sessionId
async function revokeSession(sessionId: string, ctx: AuthContext): Promise<void> {
  const session = await db.query.userSessions.findFirst({
    where: and(
      eq(userSessions.id, sessionId),
      eq(userSessions.user_id, ctx.user.id)
    ),
  });

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  // Revoke in Supabase
  await supabase.auth.admin.signOut(ctx.user.auth_id, 'others');

  // Mark as inactive
  await db.update(userSessions)
    .set({ is_active: false, revoked_at: new Date() })
    .where(eq(userSessions.id, sessionId));

  await auditLog({
    action: 'auth.session_revoked',
    actor_id: ctx.user.id,
    details: { revoked_session_id: sessionId },
  });
}

// Revoke all sessions except current
// DELETE /api/v1/auth/sessions
async function revokeAllSessions(ctx: AuthContext): Promise<void> {
  await supabase.auth.admin.signOut(ctx.user.auth_id, 'others');

  await db.update(userSessions)
    .set({ is_active: false, revoked_at: new Date() })
    .where(and(
      eq(userSessions.user_id, ctx.user.id),
      ne(userSessions.id, ctx.session_id)
    ));

  await auditLog({
    action: 'auth.all_sessions_revoked',
    actor_id: ctx.user.id,
  });
}
```

---

## Multi-Factor Authentication

### MFA Setup Flow

```typescript
// Enable TOTP MFA
// POST /api/v1/auth/mfa/enable
interface EnableMFAResponse {
  totp: {
    qr_code: string;      // Data URL for QR code image
    secret: string;       // Base32 secret for manual entry
    uri: string;          // otpauth:// URI
  };
}

async function enableMFA(ctx: AuthContext): Promise<EnableMFAResponse> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator App',
  });

  if (error) throw error;

  return {
    totp: {
      qr_code: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    },
  };
}

// Verify TOTP and activate MFA
// POST /api/v1/auth/mfa/verify
interface VerifyMFARequest {
  factor_id: string;
  code: string;
}

interface VerifyMFAResponse {
  verified: boolean;
  backup_codes: string[];  // One-time display only!
}

async function verifyMFA(req: VerifyMFARequest, ctx: AuthContext): Promise<VerifyMFAResponse> {
  const { data: challenge } = await supabase.auth.mfa.challenge({
    factorId: req.factor_id,
  });

  const { data, error } = await supabase.auth.mfa.verify({
    factorId: req.factor_id,
    challengeId: challenge.id,
    code: req.code,
  });

  if (error) {
    throw new AuthError('INVALID_MFA_CODE', 'Invalid verification code');
  }

  // Generate backup codes
  const backupCodes = generateBackupCodes(10);

  // Store hashed backup codes
  await db.insert(mfaBackupCodes).values(
    backupCodes.map(code => ({
      user_id: ctx.user.id,
      code_hash: hashBackupCode(code),
      is_used: false,
    }))
  );

  await auditLog({
    action: 'auth.mfa_enabled',
    actor_id: ctx.user.id,
    details: { factor_type: 'totp' },
  });

  return {
    verified: true,
    backup_codes: backupCodes,  // Show once, never stored in plain text
  };
}

// MFA challenge during login
// POST /api/v1/auth/mfa/challenge
interface MFAChallengeRequest {
  challenge_id: string;
  code: string;
}

async function verifyMFAChallenge(req: MFAChallengeRequest): Promise<LoginResponse> {
  const { data, error } = await supabase.auth.mfa.verify({
    factorId: req.factor_id,
    challengeId: req.challenge_id,
    code: req.code,
  });

  if (error) {
    // Check if it's a backup code
    const isBackupCode = await verifyBackupCode(req.code, data.user.id);
    if (!isBackupCode) {
      throw new AuthError('INVALID_MFA_CODE', 'Invalid verification code');
    }
  }

  // Return full session
  return buildLoginResponse(data);
}

// Backup code verification
async function verifyBackupCode(code: string, userId: string): Promise<boolean> {
  const backupCodes = await db.query.mfaBackupCodes.findMany({
    where: and(
      eq(mfaBackupCodes.user_id, userId),
      eq(mfaBackupCodes.is_used, false)
    ),
  });

  for (const bc of backupCodes) {
    if (verifyBackupCodeHash(code, bc.code_hash)) {
      // Mark as used
      await db.update(mfaBackupCodes)
        .set({ is_used: true, used_at: new Date() })
        .where(eq(mfaBackupCodes.id, bc.id));

      await auditLog({
        action: 'auth.backup_code_used',
        actor_id: userId,
      });

      return true;
    }
  }

  return false;
}
```

---

## Suspicious Activity Detection

### Overview

Zygo implements intelligent suspicious login detection to protect user accounts from unauthorized access. When suspicious activity is detected, users must verify their identity via email before gaining access.

### Suspicious Activity Indicators

```typescript
interface LoginContext {
  user_id: string;
  email: string;
  ip_address: string;
  user_agent: string;
  timestamp: Date;

  // Derived context
  device_fingerprint: string;
  geo_location: GeoLocation;
  is_vpn: boolean;
  is_tor: boolean;
}

interface GeoLocation {
  country: string;
  country_code: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

// Risk factors and their weights
const RISK_FACTORS = {
  new_device: 30,              // First time seeing this device fingerprint
  new_location: 25,            // Login from new country/city
  unusual_time: 15,            // Login outside normal hours (learned over time)
  rapid_location_change: 40,   // Impossible travel (e.g., NYC to Tokyo in 1 hour)
  vpn_detected: 10,            // VPN usage detected
  tor_detected: 35,            // Tor exit node detected
  failed_attempts_before: 20,  // Recent failed login attempts
  password_recently_changed: 15, // Login soon after password change
  long_inactive: 20,           // First login after 30+ days
  multiple_sessions: 10,       // Already has many active sessions
};

// Risk threshold for requiring verification
const RISK_THRESHOLD = 50;  // Score >= 50 triggers verification
```

### Risk Scoring Algorithm

```typescript
interface RiskAssessment {
  score: number;              // 0-100
  factors: RiskFactor[];      // Contributing factors
  requires_verification: boolean;
  verification_method: 'email' | 'sms' | 'both';
  recommendation: 'allow' | 'verify' | 'block';
}

interface RiskFactor {
  name: string;
  weight: number;
  triggered: boolean;
  details: string;
}

async function assessLoginRisk(ctx: LoginContext): Promise<RiskAssessment> {
  const factors: RiskFactor[] = [];
  let totalScore = 0;

  // 1. Check for new device
  const knownDevices = await db.query.userDevices.findMany({
    where: eq(userDevices.user_id, ctx.user_id),
  });

  const isNewDevice = !knownDevices.some(d => d.fingerprint === ctx.device_fingerprint);
  if (isNewDevice) {
    factors.push({
      name: 'new_device',
      weight: RISK_FACTORS.new_device,
      triggered: true,
      details: 'Login from unrecognized device',
    });
    totalScore += RISK_FACTORS.new_device;
  }

  // 2. Check for new location
  const recentLogins = await db.query.userSessions.findMany({
    where: and(
      eq(userSessions.user_id, ctx.user_id),
      gte(userSessions.created_at, subDays(new Date(), 30))
    ),
    orderBy: [desc(userSessions.created_at)],
    limit: 10,
  });

  const knownCountries = new Set(recentLogins.map(l => l.location?.country_code));
  if (!knownCountries.has(ctx.geo_location.country_code)) {
    factors.push({
      name: 'new_location',
      weight: RISK_FACTORS.new_location,
      triggered: true,
      details: `Login from new country: ${ctx.geo_location.country}`,
    });
    totalScore += RISK_FACTORS.new_location;
  }

  // 3. Check for impossible travel
  const lastLogin = recentLogins[0];
  if (lastLogin && lastLogin.location) {
    const timeDiffHours = (ctx.timestamp.getTime() - new Date(lastLogin.created_at).getTime()) / (1000 * 60 * 60);
    const distanceKm = calculateDistance(
      lastLogin.location.latitude, lastLogin.location.longitude,
      ctx.geo_location.latitude, ctx.geo_location.longitude
    );

    // Max realistic travel speed: 1000 km/h (fast jet)
    const maxPossibleDistance = timeDiffHours * 1000;

    if (distanceKm > maxPossibleDistance) {
      factors.push({
        name: 'rapid_location_change',
        weight: RISK_FACTORS.rapid_location_change,
        triggered: true,
        details: `Impossible travel: ${Math.round(distanceKm)}km in ${timeDiffHours.toFixed(1)} hours`,
      });
      totalScore += RISK_FACTORS.rapid_location_change;
    }
  }

  // 4. Check for VPN/Tor
  if (ctx.is_vpn) {
    factors.push({
      name: 'vpn_detected',
      weight: RISK_FACTORS.vpn_detected,
      triggered: true,
      details: 'VPN connection detected',
    });
    totalScore += RISK_FACTORS.vpn_detected;
  }

  if (ctx.is_tor) {
    factors.push({
      name: 'tor_detected',
      weight: RISK_FACTORS.tor_detected,
      triggered: true,
      details: 'Tor exit node detected',
    });
    totalScore += RISK_FACTORS.tor_detected;
  }

  // 5. Check for unusual login time
  const loginHour = ctx.timestamp.getHours();
  const userLoginPattern = await getUserLoginPattern(ctx.user_id);
  if (userLoginPattern && !userLoginPattern.typical_hours.includes(loginHour)) {
    factors.push({
      name: 'unusual_time',
      weight: RISK_FACTORS.unusual_time,
      triggered: true,
      details: `Login at unusual hour: ${loginHour}:00`,
    });
    totalScore += RISK_FACTORS.unusual_time;
  }

  // 6. Check for recent failed attempts
  const recentFailures = await redis.get(`failed_attempts:${ctx.email}`);
  if (recentFailures && parseInt(recentFailures) >= 3) {
    factors.push({
      name: 'failed_attempts_before',
      weight: RISK_FACTORS.failed_attempts_before,
      triggered: true,
      details: `${recentFailures} recent failed login attempts`,
    });
    totalScore += RISK_FACTORS.failed_attempts_before;
  }

  // 7. Check for long inactivity
  if (lastLogin) {
    const daysSinceLastLogin = (ctx.timestamp.getTime() - new Date(lastLogin.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastLogin > 30) {
      factors.push({
        name: 'long_inactive',
        weight: RISK_FACTORS.long_inactive,
        triggered: true,
        details: `First login in ${Math.round(daysSinceLastLogin)} days`,
      });
      totalScore += RISK_FACTORS.long_inactive;
    }
  }

  // Determine verification requirement
  const requiresVerification = totalScore >= RISK_THRESHOLD;

  // Determine verification method based on score
  let verificationMethod: 'email' | 'sms' | 'both' = 'email';
  if (totalScore >= 70) {
    verificationMethod = 'both';  // High risk: require both
  } else if (totalScore >= 60) {
    verificationMethod = 'sms';   // Medium-high risk: SMS (faster)
  }

  // Determine recommendation
  let recommendation: 'allow' | 'verify' | 'block' = 'allow';
  if (totalScore >= 80) {
    recommendation = 'block';     // Very high risk: block and alert user
  } else if (requiresVerification) {
    recommendation = 'verify';
  }

  return {
    score: Math.min(totalScore, 100),
    factors,
    requires_verification: requiresVerification,
    verification_method: verificationMethod,
    recommendation,
  };
}

// Haversine formula for distance calculation
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
```

### Suspicious Login Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User    │     │  Zygo    │     │   Risk   │     │  Email/  │     │ Database │
│  Browser │     │  API     │     │  Engine  │     │   SMS    │     │          │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │                │
     │ 1. POST /auth/login             │                │                │
     │ {email, password}               │                │                │
     │───────────────>│                │                │                │
     │                │                │                │                │
     │                │ 2. Verify credentials           │                │
     │                │──────────────────────────────────────────────────>
     │                │                │                │                │
     │                │ 3. Credentials valid            │                │
     │                │<──────────────────────────────────────────────────
     │                │                │                │                │
     │                │ 4. Assess risk │                │                │
     │                │───────────────>│                │                │
     │                │                │                │                │
     │                │                │ 5. Query login history          │
     │                │                │───────────────────────────────>│
     │                │                │                │                │
     │                │                │ 6. Return history               │
     │                │                │<───────────────────────────────│
     │                │                │                │                │
     │                │ 7. Risk score  │                │                │
     │                │<───────────────│                │                │
     │                │                │                │                │
     │                │    [If risk >= 50]              │                │
     │                │ 8. Generate verification code   │                │
     │                │──────────────────────────────────────────────────>
     │                │                │                │                │
     │                │ 9. Send verification email/SMS  │                │
     │                │───────────────────────────────>│                │
     │                │                │                │                │
     │ 10. Return     │                │                │                │
     │ {requires_verification: true, verification_id}  │                │
     │<───────────────│                │                │                │
     │                │                │                │                │
     │ 11. User receives email/SMS with code           │                │
     │<────────────────────────────────────────────────│                │
     │                │                │                │                │
     │ 12. POST /auth/verify-suspicious-login          │                │
     │ {verification_id, code}         │                │                │
     │───────────────>│                │                │                │
     │                │                │                │                │
     │                │ 13. Verify code                 │                │
     │                │──────────────────────────────────────────────────>
     │                │                │                │                │
     │                │ 14. Mark device as trusted      │                │
     │                │──────────────────────────────────────────────────>
     │                │                │                │                │
     │ 15. Return session (login complete)             │                │
     │<───────────────│                │                │                │
     │                │                │                │                │
```

### Suspicious Login API Implementation

```typescript
// Enhanced login with risk assessment
// POST /api/v1/auth/login
async function loginWithRiskAssessment(req: LoginRequest, ctx: Context): Promise<LoginResponse | SuspiciousLoginResponse> {
  const { email, password, remember_me } = req;

  // 1. Rate limit check (existing)
  await checkRateLimit(email);

  // 2. Authenticate with Supabase
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    await recordFailedAttempt(email);
    throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // 3. Build login context
  const loginContext: LoginContext = {
    user_id: data.user.id,
    email,
    ip_address: ctx.req.header('x-forwarded-for') || ctx.req.ip,
    user_agent: ctx.req.header('user-agent') || '',
    timestamp: new Date(),
    device_fingerprint: ctx.req.header('x-device-fingerprint') || generateFingerprint(ctx.req),
    geo_location: await getGeoLocation(ctx.req.header('x-forwarded-for') || ctx.req.ip),
    is_vpn: await isVpnIp(ctx.req.ip),
    is_tor: await isTorExitNode(ctx.req.ip),
  };

  // 4. Assess risk
  const riskAssessment = await assessLoginRisk(loginContext);

  // 5. Log security event
  await auditLog({
    action: 'auth.login_risk_assessed',
    actor_id: data.user.id,
    details: {
      risk_score: riskAssessment.score,
      factors: riskAssessment.factors.filter(f => f.triggered).map(f => f.name),
      requires_verification: riskAssessment.requires_verification,
    },
  });

  // 6. Handle based on recommendation
  if (riskAssessment.recommendation === 'block') {
    // Sign out the temporary session
    await supabase.auth.signOut();

    // Notify user of blocked attempt
    await sendSecurityAlertEmail(email, {
      type: 'blocked_login_attempt',
      ip_address: loginContext.ip_address,
      location: loginContext.geo_location,
      timestamp: loginContext.timestamp,
      risk_factors: riskAssessment.factors.filter(f => f.triggered),
    });

    throw new AuthError(
      'LOGIN_BLOCKED',
      'This login attempt was blocked due to suspicious activity. Please check your email for details.'
    );
  }

  if (riskAssessment.requires_verification) {
    // Create pending verification
    const verificationId = crypto.randomUUID();
    const code = crypto.randomInt(100000, 999999).toString();

    // Store verification state
    await redis.setex(
      `suspicious_login:${verificationId}`,
      600, // 10 minutes
      JSON.stringify({
        user_id: data.user.id,
        email,
        code,
        attempts: 0,
        risk_score: riskAssessment.score,
        factors: riskAssessment.factors,
        device_fingerprint: loginContext.device_fingerprint,
        session_data: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
        created_at: Date.now(),
      })
    );

    // Send verification based on method
    if (riskAssessment.verification_method === 'email' || riskAssessment.verification_method === 'both') {
      await emailService.send({
        to: email,
        template: 'suspicious-login-verification',
        data: {
          code,
          ip_address: loginContext.ip_address,
          location: `${loginContext.geo_location.city}, ${loginContext.geo_location.country}`,
          device: parseUserAgent(loginContext.user_agent),
          timestamp: loginContext.timestamp.toISOString(),
          expires_in: '10 minutes',
          risk_factors: riskAssessment.factors.filter(f => f.triggered).map(f => f.details),
        },
      });
    }

    if (riskAssessment.verification_method === 'sms' || riskAssessment.verification_method === 'both') {
      // Get user's phone number
      const user = await db.query.users.findFirst({
        where: eq(users.auth_id, data.user.id),
      });

      if (user?.phone && user.phone_verified) {
        await twilioService.sendSMS({
          to: user.phone,
          body: `Your Zygo verification code is: ${code}. This code expires in 10 minutes. If you didn't try to log in, please secure your account immediately.`,
        });
      }
    }

    return {
      requires_verification: true,
      verification_id: verificationId,
      verification_method: riskAssessment.verification_method,
      risk_score: riskAssessment.score,
      risk_factors: riskAssessment.factors
        .filter(f => f.triggered)
        .map(f => ({ name: f.name, details: f.details })),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  // 7. Low risk - proceed with normal login
  // ... (rest of existing login code)
  return buildLoginResponse(data);
}

// Verify suspicious login
// POST /api/v1/auth/verify-suspicious-login
interface VerifySuspiciousLoginRequest {
  verification_id: string;
  code: string;
  trust_device?: boolean;  // Remember this device for 30 days
}

async function verifySuspiciousLogin(req: VerifySuspiciousLoginRequest): Promise<LoginResponse> {
  const { verification_id, code, trust_device } = req;

  // 1. Get stored verification data
  const storedData = await redis.get(`suspicious_login:${verification_id}`);
  if (!storedData) {
    throw new AuthError('VERIFICATION_EXPIRED', 'Verification has expired. Please try logging in again.');
  }

  const verification = JSON.parse(storedData);

  // 2. Check attempts
  if (verification.attempts >= 5) {
    await redis.del(`suspicious_login:${verification_id}`);
    throw new AuthError('TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Please try logging in again.');
  }

  // 3. Verify code
  if (code !== verification.code) {
    // Increment attempts
    verification.attempts += 1;
    await redis.setex(
      `suspicious_login:${verification_id}`,
      await redis.ttl(`suspicious_login:${verification_id}`),
      JSON.stringify(verification)
    );
    throw new AuthError('INVALID_CODE', 'Invalid verification code');
  }

  // 4. Code verified - complete login
  await redis.del(`suspicious_login:${verification_id}`);

  // 5. Trust device if requested
  if (trust_device) {
    await db.insert(userDevices).values({
      user_id: verification.user_id,
      fingerprint: verification.device_fingerprint,
      name: 'Trusted Device',
      trusted_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    }).onConflictDoUpdate({
      target: [userDevices.user_id, userDevices.fingerprint],
      set: { trusted_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
  }

  // 6. Log successful verification
  await auditLog({
    action: 'auth.suspicious_login_verified',
    actor_id: verification.user_id,
    details: {
      risk_score: verification.risk_score,
      device_trusted: trust_device,
    },
  });

  // 7. Return the stored session
  return {
    session: {
      access_token: verification.session_data.access_token,
      refresh_token: verification.session_data.refresh_token,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
    // ... user and tenant data
  };
}
```

### Response Types

```typescript
interface SuspiciousLoginResponse {
  requires_verification: true;
  verification_id: string;
  verification_method: 'email' | 'sms' | 'both';
  risk_score: number;
  risk_factors: Array<{
    name: string;
    details: string;
  }>;
  expires_at: string;
}
```

### Security Alert Emails

```typescript
// Email template for blocked login
interface BlockedLoginAlertData {
  type: 'blocked_login_attempt';
  ip_address: string;
  location: GeoLocation;
  timestamp: Date;
  risk_factors: RiskFactor[];
}

// Email template for suspicious login verification
interface SuspiciousLoginVerificationData {
  code: string;
  ip_address: string;
  location: string;
  device: DeviceInfo;
  timestamp: string;
  expires_in: string;
  risk_factors: string[];
}
```

### Trusted Devices Management

```typescript
// GET /api/v1/auth/devices
interface TrustedDevice {
  id: string;
  name: string;
  fingerprint: string;
  last_used_at: string;
  trusted_until: string;
  device_info: {
    type: 'desktop' | 'mobile' | 'tablet';
    os: string;
    browser: string;
  };
  location?: {
    city: string;
    country: string;
  };
}

// DELETE /api/v1/auth/devices/:deviceId
// Revoke trust for a specific device

// DELETE /api/v1/auth/devices
// Revoke trust for all devices (requires MFA if enabled)
```

---

## Phone Verification with Twilio SMS

### Overview

Zygo uses Twilio as the SMS provider for phone number verification and SMS-based authentication features. Phone verification is used for:

1. **Account phone verification** - Verifying user phone numbers during profile setup
2. **Suspicious login verification** - Additional security for risky logins
3. **SMS-based MFA** - Alternative to TOTP for multi-factor authentication
4. **Account recovery** - Phone-based password reset option

### Twilio Configuration

```typescript
// Environment variables
interface TwilioConfig {
  TWILIO_ACCOUNT_SID: string;        // Account SID from Twilio Console
  TWILIO_AUTH_TOKEN: string;         // Auth Token from Twilio Console
  TWILIO_VERIFY_SERVICE_SID: string; // Verify Service SID
  TWILIO_FROM_NUMBER: string;        // Your Twilio phone number
  TWILIO_MESSAGING_SERVICE_SID?: string; // Optional: Messaging Service for scaling
}

// config/twilio.ts
import twilio from 'twilio';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export const twilioVerify = twilioClient.verify.v2.services(
  process.env.TWILIO_VERIFY_SERVICE_SID!
);

export const twilioMessaging = twilioClient.messages;
```

### Twilio Service Implementation

```typescript
// services/twilio.service.ts
import { twilioVerify, twilioMessaging } from '@/config/twilio';

export class TwilioService {
  private readonly verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID!;
  private readonly fromNumber = process.env.TWILIO_FROM_NUMBER!;

  /**
   * Send a verification code to a phone number
   * Uses Twilio Verify API for secure OTP delivery
   */
  async sendVerificationCode(phoneNumber: string, channel: 'sms' | 'call' = 'sms'): Promise<{
    status: string;
    sid: string;
  }> {
    try {
      const verification = await twilioVerify.verifications.create({
        to: phoneNumber,
        channel,
        locale: 'en', // Can be made dynamic based on user preference
      });

      return {
        status: verification.status,
        sid: verification.sid,
      };
    } catch (error) {
      // Handle Twilio-specific errors
      if (error.code === 60200) {
        throw new ValidationError('INVALID_PHONE', 'Invalid phone number format');
      }
      if (error.code === 60203) {
        throw new RateLimitError('SMS_RATE_LIMIT', 'Too many verification attempts. Please try again later.');
      }
      if (error.code === 60205) {
        throw new ValidationError('SMS_NOT_SUPPORTED', 'SMS is not supported for this phone number');
      }
      throw error;
    }
  }

  /**
   * Verify the code entered by user
   * Uses Twilio Verify API for secure verification
   */
  async verifyCode(phoneNumber: string, code: string): Promise<{
    valid: boolean;
    status: string;
  }> {
    try {
      const verificationCheck = await twilioVerify.verificationChecks.create({
        to: phoneNumber,
        code,
      });

      return {
        valid: verificationCheck.status === 'approved',
        status: verificationCheck.status,
      };
    } catch (error) {
      if (error.code === 20404) {
        throw new AuthError('VERIFICATION_NOT_FOUND', 'No pending verification found. Please request a new code.');
      }
      throw error;
    }
  }

  /**
   * Send a custom SMS message
   * Used for security alerts, notifications, etc.
   */
  async sendSMS(params: {
    to: string;
    body: string;
    statusCallback?: string;
  }): Promise<{
    sid: string;
    status: string;
  }> {
    try {
      const message = await twilioMessaging.create({
        to: params.to,
        from: this.fromNumber,
        body: params.body,
        statusCallback: params.statusCallback,
      });

      return {
        sid: message.sid,
        status: message.status,
      };
    } catch (error) {
      // Log error but don't expose Twilio internals
      console.error('SMS send failed:', error);
      throw new ServiceError('SMS_SEND_FAILED', 'Failed to send SMS. Please try again.');
    }
  }

  /**
   * Format phone number to E.164 format
   */
  formatPhoneNumber(phoneNumber: string, countryCode: string = 'US'): string {
    // Remove all non-numeric characters
    const cleaned = phoneNumber.replace(/\D/g, '');

    // Add country code if not present
    if (!cleaned.startsWith('+')) {
      const countryCodes: Record<string, string> = {
        US: '+1',
        UK: '+44',
        DE: '+49',
        FR: '+33',
        JP: '+81',
        AU: '+61',
        // Add more as needed
      };
      return `${countryCodes[countryCode] || '+1'}${cleaned}`;
    }

    return `+${cleaned}`;
  }
}

export const twilioService = new TwilioService();
```

### Phone Verification Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User    │     │  Zygo    │     │  Twilio  │     │ Database │
│  Browser │     │  API     │     │   API    │     │          │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │
     │ 1. POST /auth/send-phone-verification           │
     │ {phone_number} │                │                │
     │───────────────>│                │                │
     │                │                │                │
     │                │ 2. Validate &  │                │
     │                │    format phone│                │
     │                │                │                │
     │                │ 3. Rate limit  │                │
     │                │    check       │                │
     │                │                │                │
     │                │ 4. Send verification            │
     │                │───────────────>│                │
     │                │                │                │
     │                │                │ 5. Deliver SMS │
     │                │                │ to user's phone│
     │                │                │                │
     │                │ 6. Return SID  │                │
     │                │<───────────────│                │
     │                │                │                │
     │                │ 7. Store pending verification   │
     │                │───────────────────────────────>│
     │                │                │                │
     │ 8. Return success               │                │
     │<───────────────│                │                │
     │                │                │                │
     │ 9. User receives SMS            │                │
     │<────────────────────────────────│                │
     │                │                │                │
     │ 10. POST /auth/verify-phone     │                │
     │ {phone_number, code}            │                │
     │───────────────>│                │                │
     │                │                │                │
     │                │ 11. Verify code│                │
     │                │───────────────>│                │
     │                │                │                │
     │                │ 12. Approved   │                │
     │                │<───────────────│                │
     │                │                │                │
     │                │ 13. Update user phone_verified  │
     │                │───────────────────────────────>│
     │                │                │                │
     │ 14. Return success              │                │
     │<───────────────│                │                │
     │                │                │                │
```

### Phone Verification API Endpoints

```typescript
// POST /api/v1/auth/send-phone-verification
interface SendPhoneVerificationRequest {
  phone_number: string;
  country_code?: string;  // ISO 3166-1 alpha-2 (e.g., 'US', 'UK')
  channel?: 'sms' | 'call';  // Default: 'sms'
}

interface SendPhoneVerificationResponse {
  success: boolean;
  message: string;
  expires_in: number;  // seconds
  retry_after?: number;  // seconds until can retry
}

async function sendPhoneVerification(
  req: SendPhoneVerificationRequest,
  ctx: AuthContext
): Promise<SendPhoneVerificationResponse> {
  const { phone_number, country_code = 'US', channel = 'sms' } = req;

  // 1. Format phone number
  const formattedPhone = twilioService.formatPhoneNumber(phone_number, country_code);

  // 2. Validate phone number format
  if (!isValidPhoneNumber(formattedPhone)) {
    throw new ValidationError('INVALID_PHONE', 'Invalid phone number format');
  }

  // 3. Rate limit: 3 requests per phone per hour
  const rateLimitKey = `phone_verify:${formattedPhone}`;
  const attempts = await redis.incr(rateLimitKey);
  if (attempts === 1) {
    await redis.expire(rateLimitKey, 3600);
  }
  if (attempts > 3) {
    const ttl = await redis.ttl(rateLimitKey);
    throw new RateLimitError('RATE_LIMIT_EXCEEDED', `Too many attempts. Try again in ${Math.ceil(ttl / 60)} minutes.`);
  }

  // 4. Check if phone already verified by another user (prevent reuse)
  const existingUser = await db.query.users.findFirst({
    where: and(
      eq(users.phone, formattedPhone),
      eq(users.phone_verified, true),
      ne(users.id, ctx.user.id)
    ),
  });

  if (existingUser) {
    throw new ValidationError('PHONE_IN_USE', 'This phone number is already associated with another account');
  }

  // 5. Send verification via Twilio
  const result = await twilioService.sendVerificationCode(formattedPhone, channel);

  // 6. Store pending verification
  await db.insert(phoneVerifications).values({
    user_id: ctx.user.id,
    phone_number: formattedPhone,
    twilio_sid: result.sid,
    status: 'pending',
    channel,
    expires_at: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  }).onConflictDoUpdate({
    target: [phoneVerifications.user_id],
    set: {
      phone_number: formattedPhone,
      twilio_sid: result.sid,
      status: 'pending',
      attempts: 0,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  // 7. Audit log
  await auditLog({
    action: 'auth.phone_verification_sent',
    actor_id: ctx.user.id,
    details: {
      phone_masked: maskPhoneNumber(formattedPhone),
      channel,
    },
  });

  return {
    success: true,
    message: channel === 'sms'
      ? 'Verification code sent via SMS'
      : 'You will receive a verification call shortly',
    expires_in: 600, // 10 minutes
  };
}

// POST /api/v1/auth/verify-phone
interface VerifyPhoneRequest {
  phone_number: string;
  code: string;
}

interface VerifyPhoneResponse {
  success: boolean;
  message: string;
  phone_verified: boolean;
}

async function verifyPhone(
  req: VerifyPhoneRequest,
  ctx: AuthContext
): Promise<VerifyPhoneResponse> {
  const { phone_number, code } = req;

  // 1. Format phone number
  const formattedPhone = twilioService.formatPhoneNumber(phone_number);

  // 2. Get pending verification
  const pendingVerification = await db.query.phoneVerifications.findFirst({
    where: and(
      eq(phoneVerifications.user_id, ctx.user.id),
      eq(phoneVerifications.phone_number, formattedPhone),
      eq(phoneVerifications.status, 'pending')
    ),
  });

  if (!pendingVerification) {
    throw new AuthError('NO_PENDING_VERIFICATION', 'No pending verification found. Please request a new code.');
  }

  // 3. Check expiry
  if (new Date() > pendingVerification.expires_at) {
    await db.update(phoneVerifications)
      .set({ status: 'expired' })
      .where(eq(phoneVerifications.id, pendingVerification.id));
    throw new AuthError('VERIFICATION_EXPIRED', 'Verification code has expired. Please request a new one.');
  }

  // 4. Check attempts
  if (pendingVerification.attempts >= 5) {
    await db.update(phoneVerifications)
      .set({ status: 'failed' })
      .where(eq(phoneVerifications.id, pendingVerification.id));
    throw new AuthError('TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Please request a new code.');
  }

  // 5. Verify with Twilio
  const result = await twilioService.verifyCode(formattedPhone, code);

  if (!result.valid) {
    // Increment attempts
    await db.update(phoneVerifications)
      .set({ attempts: pendingVerification.attempts + 1 })
      .where(eq(phoneVerifications.id, pendingVerification.id));
    throw new AuthError('INVALID_CODE', 'Invalid verification code');
  }

  // 6. Mark verification as approved
  await db.update(phoneVerifications)
    .set({
      status: 'approved',
      verified_at: new Date(),
    })
    .where(eq(phoneVerifications.id, pendingVerification.id));

  // 7. Update user's phone as verified
  await db.update(users)
    .set({
      phone: formattedPhone,
      phone_verified: true,
      phone_verified_at: new Date(),
    })
    .where(eq(users.id, ctx.user.id));

  // 8. Audit log
  await auditLog({
    action: 'auth.phone_verified',
    actor_id: ctx.user.id,
    details: {
      phone_masked: maskPhoneNumber(formattedPhone),
    },
  });

  return {
    success: true,
    message: 'Phone number verified successfully',
    phone_verified: true,
  };
}

// Utility function to mask phone numbers for display
function maskPhoneNumber(phone: string): string {
  if (phone.length < 6) return '****';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}
```

### SMS-Based MFA (Alternative to TOTP)

```typescript
// Enable SMS MFA
// POST /api/v1/auth/mfa/sms/enable
interface EnableSMSMFARequest {
  phone_number: string;
}

interface EnableSMSMFAResponse {
  success: boolean;
  message: string;
  verification_required: boolean;
}

async function enableSMSMFA(
  req: EnableSMSMFARequest,
  ctx: AuthContext
): Promise<EnableSMSMFAResponse> {
  const { phone_number } = req;

  // 1. Check if phone is already verified for this user
  const user = await db.query.users.findFirst({
    where: eq(users.id, ctx.user.id),
  });

  if (!user?.phone_verified || user.phone !== twilioService.formatPhoneNumber(phone_number)) {
    // Phone needs to be verified first
    return {
      success: false,
      message: 'Please verify your phone number first',
      verification_required: true,
    };
  }

  // 2. Enable SMS MFA for the user
  await db.insert(userMfaFactors).values({
    user_id: ctx.user.id,
    factor_type: 'sms',
    phone_number: user.phone,
    status: 'verified',
    created_at: new Date(),
  });

  // 3. Audit log
  await auditLog({
    action: 'auth.mfa_sms_enabled',
    actor_id: ctx.user.id,
    details: {
      phone_masked: maskPhoneNumber(user.phone),
    },
  });

  return {
    success: true,
    message: 'SMS-based MFA enabled successfully',
    verification_required: false,
  };
}

// SMS MFA challenge during login
// POST /api/v1/auth/mfa/sms/challenge
interface SMSMFAChallengeRequest {
  factor_id: string;
}

async function sendSMSMFAChallenge(req: SMSMFAChallengeRequest): Promise<{
  challenge_id: string;
  expires_at: string;
}> {
  const { factor_id } = req;

  // 1. Get the MFA factor
  const factor = await db.query.userMfaFactors.findFirst({
    where: and(
      eq(userMfaFactors.id, factor_id),
      eq(userMfaFactors.factor_type, 'sms'),
      eq(userMfaFactors.status, 'verified')
    ),
  });

  if (!factor) {
    throw new AuthError('FACTOR_NOT_FOUND', 'MFA factor not found');
  }

  // 2. Send verification code
  await twilioService.sendVerificationCode(factor.phone_number, 'sms');

  // 3. Create challenge
  const challengeId = crypto.randomUUID();
  await redis.setex(
    `mfa_sms_challenge:${challengeId}`,
    300, // 5 minutes
    JSON.stringify({
      factor_id,
      phone_number: factor.phone_number,
      user_id: factor.user_id,
      created_at: Date.now(),
    })
  );

  return {
    challenge_id: challengeId,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

// Verify SMS MFA
// POST /api/v1/auth/mfa/sms/verify
interface VerifySMSMFARequest {
  challenge_id: string;
  code: string;
}

async function verifySMSMFA(req: VerifySMSMFARequest): Promise<LoginResponse> {
  const { challenge_id, code } = req;

  // 1. Get challenge data
  const challengeData = await redis.get(`mfa_sms_challenge:${challenge_id}`);
  if (!challengeData) {
    throw new AuthError('CHALLENGE_EXPIRED', 'MFA challenge has expired');
  }

  const challenge = JSON.parse(challengeData);

  // 2. Verify code with Twilio
  const result = await twilioService.verifyCode(challenge.phone_number, code);

  if (!result.valid) {
    throw new AuthError('INVALID_MFA_CODE', 'Invalid verification code');
  }

  // 3. Delete challenge
  await redis.del(`mfa_sms_challenge:${challenge_id}`);

  // 4. Complete login (return session)
  // ... (similar to TOTP MFA completion)
}
```

### Twilio Webhook Handling

```typescript
// POST /api/v1/webhooks/twilio/status
// Handles SMS delivery status callbacks
async function handleTwilioStatusCallback(req: Request): Promise<Response> {
  // 1. Verify Twilio signature
  const signature = req.headers.get('x-twilio-signature');
  const url = `${process.env.APP_URL}/api/v1/webhooks/twilio/status`;
  const params = await req.formData();

  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature!,
    url,
    Object.fromEntries(params)
  );

  if (!isValid) {
    return new Response('Invalid signature', { status: 403 });
  }

  // 2. Process status update
  const messageSid = params.get('MessageSid');
  const messageStatus = params.get('MessageStatus');
  const errorCode = params.get('ErrorCode');

  // 3. Log delivery status
  await db.insert(smsDeliveryLogs).values({
    twilio_sid: messageSid,
    status: messageStatus,
    error_code: errorCode,
    raw_payload: Object.fromEntries(params),
    created_at: new Date(),
  });

  // 4. Handle failed deliveries
  if (messageStatus === 'failed' || messageStatus === 'undelivered') {
    console.error(`SMS delivery failed: ${messageSid}, error: ${errorCode}`);
    // Could trigger alert or retry logic here
  }

  return new Response('OK', { status: 200 });
}
```

### Phone Number Validation

```typescript
// Using libphonenumber-js for validation
import { parsePhoneNumber, isValidPhoneNumber as isValidPN } from 'libphonenumber-js';

function isValidPhoneNumber(phoneNumber: string): boolean {
  try {
    return isValidPN(phoneNumber);
  } catch {
    return false;
  }
}

function getPhoneNumberInfo(phoneNumber: string): {
  country: string;
  national: string;
  international: string;
  type: string;
} | null {
  try {
    const parsed = parsePhoneNumber(phoneNumber);
    if (!parsed) return null;

    return {
      country: parsed.country || 'Unknown',
      national: parsed.formatNational(),
      international: parsed.formatInternational(),
      type: parsed.getType() || 'UNKNOWN',
    };
  } catch {
    return null;
  }
}
```

### Rate Limiting for SMS

```typescript
const SMS_RATE_LIMITS = {
  // Per phone number limits
  perPhone: {
    window: '1h',
    max: 5,
    keyGenerator: (phone: string) => `sms:phone:${phone}`,
  },

  // Per user limits
  perUser: {
    window: '1h',
    max: 10,
    keyGenerator: (userId: string) => `sms:user:${userId}`,
  },

  // Global limits (prevent abuse)
  global: {
    window: '1m',
    max: 100,
    keyGenerator: () => 'sms:global',
  },
};
```

---

## Security Measures

### Password Requirements

```typescript
const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  specialChars: '!@#$%^&*(),.?":{}|<>',

  // History
  preventReuse: 5,  // Cannot reuse last 5 passwords

  // Expiry (enterprise only)
  maxAgeDays: null,  // No expiry by default

  // Breach checking
  checkHaveIBeenPwned: true,
};

// Check password against HaveIBeenPwned
async function checkPasswordBreach(password: string): Promise<boolean> {
  const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  const text = await response.text();

  return text.includes(suffix);
}
```

### Account Lockout Policy

```typescript
const LOCKOUT_POLICY = {
  maxFailedAttempts: 5,
  lockoutDurationMinutes: 15,
  resetWindowMinutes: 15,

  // Progressive lockout
  progressiveLockout: [
    { attempts: 5, lockoutMinutes: 15 },
    { attempts: 10, lockoutMinutes: 60 },
    { attempts: 15, lockoutMinutes: 1440 },  // 24 hours
  ],
};

async function checkAccountLockout(email: string): Promise<void> {
  const lockoutKey = `lockout:${email}`;
  const lockout = await redis.get(lockoutKey);

  if (lockout) {
    const data = JSON.parse(lockout);
    const remainingSeconds = Math.ceil((data.lockedUntil - Date.now()) / 1000);

    if (remainingSeconds > 0) {
      throw new AuthError(
        'ACCOUNT_LOCKED',
        `Account temporarily locked. Try again in ${Math.ceil(remainingSeconds / 60)} minutes.`
      );
    }
  }
}

async function recordFailedAttempt(email: string): Promise<void> {
  const attemptsKey = `failed_attempts:${email}`;
  const attempts = await redis.incr(attemptsKey);

  if (attempts === 1) {
    await redis.expire(attemptsKey, LOCKOUT_POLICY.resetWindowMinutes * 60);
  }

  // Check for lockout threshold
  for (const tier of LOCKOUT_POLICY.progressiveLockout.reverse()) {
    if (attempts >= tier.attempts) {
      await redis.setex(
        `lockout:${email}`,
        tier.lockoutMinutes * 60,
        JSON.stringify({
          lockedUntil: Date.now() + tier.lockoutMinutes * 60 * 1000,
          attempts,
        })
      );
      break;
    }
  }
}
```

### Rate Limiting

```typescript
// Auth-specific rate limits (see RATE_LIMITING.md for full spec)
const AUTH_RATE_LIMITS = {
  login: {
    window: '15m',
    max: 5,
    keyGenerator: (req) => `login:${req.body.email}`,
  },
  signup: {
    window: '1h',
    max: 3,
    keyGenerator: (req) => `signup:${req.ip}`,
  },
  passwordReset: {
    window: '1h',
    max: 3,
    keyGenerator: (req) => `reset:${req.body.email}`,
  },
  mfaVerify: {
    window: '5m',
    max: 5,
    keyGenerator: (req) => `mfa:${req.user.id}`,
  },
};
```

---

## API Endpoints

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/signup` | Create new account | No |
| POST | `/auth/login` | Email/password login | No |
| POST | `/auth/logout` | End session | Yes |
| POST | `/auth/refresh` | Refresh access token | Yes (refresh token) |
| GET | `/auth/session` | Get current session | Yes |
| GET | `/auth/permissions` | Get user permissions | Yes |

### Password Management

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/forgot-password` | Request password reset | No |
| POST | `/auth/verify-code` | Verify reset code | No |
| POST | `/auth/reset-password` | Set new password | No (with token) |
| POST | `/auth/change-password` | Change password (logged in) | Yes |

### Email/Phone Verification

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/send-email-verification` | Send verification email | Yes |
| POST | `/auth/verify-email` | Verify email with code | Yes |
| POST | `/auth/send-phone-verification` | Send verification SMS (Twilio) | Yes |
| POST | `/auth/verify-phone` | Verify phone with code (Twilio) | Yes |
| POST | `/auth/resend-phone-verification` | Resend phone verification SMS | Yes |

### Suspicious Login Detection

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/verify-suspicious-login` | Complete suspicious login verification | No (with verification_id) |
| GET | `/auth/devices` | List trusted devices | Yes |
| DELETE | `/auth/devices/:deviceId` | Remove trusted device | Yes |
| DELETE | `/auth/devices` | Remove all trusted devices | Yes + MFA |
| POST | `/auth/devices/:deviceId/trust` | Extend device trust period | Yes |

### SMS MFA (Twilio)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/mfa/sms/enable` | Enable SMS-based MFA | Yes |
| POST | `/auth/mfa/sms/disable` | Disable SMS-based MFA | Yes + MFA |
| POST | `/auth/mfa/sms/challenge` | Send SMS MFA challenge code | No (partial session) |
| POST | `/auth/mfa/sms/verify` | Verify SMS MFA code | No (with challenge_id) |

### Twilio Webhooks

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/webhooks/twilio/status` | SMS delivery status callback | No (Twilio signature) |
| POST | `/webhooks/twilio/inbound` | Inbound SMS handler (future) | No (Twilio signature) |

### Social OAuth

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/auth/oauth/google` | Initiate Google OAuth | No |
| GET | `/auth/oauth/google/callback` | Google OAuth callback | No |
| GET | `/auth/oauth/github` | Initiate GitHub OAuth | No |
| GET | `/auth/oauth/github/callback` | GitHub OAuth callback | No |
| GET | `/auth/oauth/microsoft` | Initiate Microsoft OAuth | No |
| GET | `/auth/oauth/microsoft/callback` | Microsoft OAuth callback | No |
| GET | `/auth/oauth/apple` | Initiate Apple OAuth | No |
| GET | `/auth/oauth/apple/callback` | Apple OAuth callback | No |

### Enterprise SSO

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/auth/sso/saml/login` | Initiate SAML login | No |
| POST | `/auth/sso/saml/acs` | SAML assertion consumer | No |
| GET | `/auth/sso/saml/metadata` | Get SP metadata | No |
| GET | `/auth/sso/oidc/login` | Initiate OIDC login | No |
| GET | `/auth/sso/oidc/callback` | OIDC callback | No |

### MFA

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/mfa/enable` | Start MFA enrollment | Yes |
| POST | `/auth/mfa/verify` | Verify and activate MFA | Yes |
| POST | `/auth/mfa/disable` | Disable MFA | Yes + MFA |
| GET | `/auth/mfa/backup-codes` | Generate new backup codes | Yes + MFA |
| POST | `/auth/mfa/challenge` | Verify MFA during login | No (partial session) |

### Session Management

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/auth/sessions` | List active sessions | Yes |
| DELETE | `/auth/sessions/:id` | Revoke specific session | Yes |
| DELETE | `/auth/sessions` | Revoke all other sessions | Yes |

### Admin SSO Configuration

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/admin/sso/config` | Get SSO configuration | Yes (admin) |
| POST | `/admin/sso/saml` | Configure SAML | Yes (admin) |
| POST | `/admin/sso/oidc` | Configure OIDC | Yes (admin) |
| POST | `/admin/sso/test` | Test SSO connection | Yes (admin) |
| POST | `/admin/sso/migrate` | Start SSO migration | Yes (owner) |

---

## Database Schema

### Core Authentication Tables

```sql
-- User sessions (extends Supabase auth.sessions)
CREATE TABLE public.user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    auth_session_id UUID,  -- Reference to auth.sessions

    -- Device info
    ip_address INET,
    user_agent TEXT,
    device_type VARCHAR(20),  -- desktop, mobile, tablet
    os VARCHAR(50),
    browser VARCHAR(50),

    -- Location (from IP)
    location JSONB,  -- { city, region, country, coordinates }

    -- Status
    is_active BOOLEAN DEFAULT true,
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES public.users(id)
);

-- Social login connections
CREATE TABLE public.social_logins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    provider VARCHAR(50) NOT NULL,  -- google, github, microsoft, apple
    provider_user_id VARCHAR(255) NOT NULL,

    email VARCHAR(255),
    name VARCHAR(255),
    avatar_url TEXT,

    access_token TEXT,  -- Encrypted (for API access if needed)
    refresh_token TEXT, -- Encrypted
    expires_at TIMESTAMPTZ,

    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, provider),
    UNIQUE(provider, provider_user_id)
);

-- MFA backup codes
CREATE TABLE public.mfa_backup_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    code_hash VARCHAR(255) NOT NULL,  -- bcrypt hash
    is_used BOOLEAN DEFAULT false,
    used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Password reset tokens
CREATE TABLE public.password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    token_hash VARCHAR(255) NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Password history (for reuse prevention)
CREATE TABLE public.password_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    password_hash VARCHAR(255) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Enterprise SSO Tables

```sql
-- SAML configurations
CREATE TABLE public.saml_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

    -- IdP settings
    idp_entity_id VARCHAR(500) NOT NULL,
    idp_sso_url VARCHAR(500) NOT NULL,
    idp_slo_url VARCHAR(500),
    idp_certificate TEXT NOT NULL,

    -- SP settings
    sp_entity_id VARCHAR(500) NOT NULL,
    sp_acs_url VARCHAR(500) NOT NULL,

    -- Attribute mapping
    attribute_mapping JSONB NOT NULL DEFAULT '{}',
    role_mapping JSONB DEFAULT '{}',
    default_role VARCHAR(50) DEFAULT 'member',

    -- Settings
    enforce_sso BOOLEAN DEFAULT false,
    auto_provision_users BOOLEAN DEFAULT true,
    allow_unverified_email BOOLEAN DEFAULT false,

    -- Status
    status VARCHAR(20) DEFAULT 'pending',  -- pending, active, disabled
    verified_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(tenant_id)
);

-- OIDC configurations
CREATE TABLE public.oidc_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

    -- Provider settings
    issuer_url VARCHAR(500) NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    client_secret TEXT NOT NULL,  -- Encrypted

    -- Discovery endpoints (auto-populated)
    authorization_endpoint VARCHAR(500),
    token_endpoint VARCHAR(500),
    userinfo_endpoint VARCHAR(500),
    jwks_uri VARCHAR(500),

    -- Scopes and claims
    scopes TEXT[] DEFAULT ARRAY['openid', 'profile', 'email'],
    claim_mapping JSONB NOT NULL DEFAULT '{}',
    role_mapping JSONB DEFAULT '{}',
    default_role VARCHAR(50) DEFAULT 'member',

    -- Settings
    enforce_sso BOOLEAN DEFAULT false,
    auto_provision_users BOOLEAN DEFAULT true,
    use_pkce BOOLEAN DEFAULT true,

    -- Status
    status VARCHAR(20) DEFAULT 'pending',
    verified_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(tenant_id)
);

-- SSO identities (links users to SSO providers)
CREATE TABLE public.sso_identities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    provider VARCHAR(20) NOT NULL,  -- saml, oidc
    provider_user_id VARCHAR(255) NOT NULL,

    email VARCHAR(255),
    name VARCHAR(255),
    groups TEXT[],

    raw_attributes JSONB,  -- Full attributes from IdP

    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(tenant_id, provider, provider_user_id)
);

-- Auth audit log
CREATE TABLE audit.auth_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    event_type VARCHAR(50) NOT NULL,  -- login, logout, signup, password_reset, mfa_enabled, etc.

    user_id UUID,
    tenant_id UUID,

    -- Event details
    provider VARCHAR(50),  -- email, google, github, saml, oidc
    success BOOLEAN NOT NULL,
    failure_reason VARCHAR(255),

    -- Context
    ip_address INET,
    user_agent TEXT,
    location JSONB,

    -- Additional data
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_auth_events_user ON audit.auth_events(user_id, created_at DESC);
CREATE INDEX idx_auth_events_tenant ON audit.auth_events(tenant_id, created_at DESC);
CREATE INDEX idx_auth_events_type ON audit.auth_events(event_type, created_at DESC);
```

### Phone Verification Tables (Twilio)

```sql
-- Phone number verifications
CREATE TABLE public.phone_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    phone_number VARCHAR(20) NOT NULL,  -- E.164 format
    twilio_sid VARCHAR(50),             -- Twilio verification SID

    channel VARCHAR(10) DEFAULT 'sms',  -- 'sms' or 'call'
    status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, expired, failed
    attempts INTEGER DEFAULT 0,

    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)  -- One pending verification per user
);

-- SMS delivery logs (from Twilio webhooks)
CREATE TABLE public.sms_delivery_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    twilio_sid VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,  -- queued, sent, delivered, failed, undelivered
    error_code VARCHAR(20),
    error_message TEXT,

    phone_number VARCHAR(20),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,

    raw_payload JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS MFA factors
CREATE TABLE public.user_mfa_factors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    factor_type VARCHAR(20) NOT NULL,  -- 'totp', 'sms', 'email'
    phone_number VARCHAR(20),          -- For SMS factor
    email VARCHAR(255),                -- For email factor

    status VARCHAR(20) DEFAULT 'pending',  -- pending, verified, disabled
    friendly_name VARCHAR(100),

    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, factor_type)
);

-- Indexes
CREATE INDEX idx_phone_verifications_user ON public.phone_verifications(user_id);
CREATE INDEX idx_phone_verifications_phone ON public.phone_verifications(phone_number);
CREATE INDEX idx_sms_delivery_logs_sid ON public.sms_delivery_logs(twilio_sid);
CREATE INDEX idx_user_mfa_factors_user ON public.user_mfa_factors(user_id);
```

### Suspicious Activity Detection Tables

```sql
-- User trusted devices
CREATE TABLE public.user_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    fingerprint VARCHAR(255) NOT NULL,  -- Device fingerprint hash
    name VARCHAR(100),                  -- User-friendly device name

    -- Device information
    device_type VARCHAR(20),            -- desktop, mobile, tablet
    os VARCHAR(50),
    os_version VARCHAR(20),
    browser VARCHAR(50),
    browser_version VARCHAR(20),

    -- Trust settings
    is_trusted BOOLEAN DEFAULT true,
    trusted_until TIMESTAMPTZ,          -- Trust expiration (null = permanent)

    -- Location info
    last_ip_address INET,
    last_location JSONB,                -- { city, country, coordinates }

    -- Activity
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    login_count INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, fingerprint)
);

-- Login risk assessments
CREATE TABLE public.login_risk_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Context
    ip_address INET NOT NULL,
    user_agent TEXT,
    device_fingerprint VARCHAR(255),

    -- Location
    geo_location JSONB,  -- { country, city, lat, lon, timezone }
    is_vpn BOOLEAN DEFAULT false,
    is_tor BOOLEAN DEFAULT false,

    -- Risk assessment
    risk_score INTEGER NOT NULL,  -- 0-100
    risk_factors JSONB,           -- Array of triggered factors
    recommendation VARCHAR(20),    -- allow, verify, block

    -- Verification
    requires_verification BOOLEAN DEFAULT false,
    verification_method VARCHAR(20),  -- email, sms, both
    verification_completed BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,

    -- Outcome
    login_allowed BOOLEAN,
    blocked_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User login patterns (for unusual time detection)
CREATE TABLE public.user_login_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Typical login hours (0-23)
    typical_hours INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    -- Typical days (0=Sunday, 6=Saturday)
    typical_days INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    -- Known locations
    known_countries TEXT[] DEFAULT ARRAY[]::TEXT[],
    known_cities TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Statistics
    total_logins INTEGER DEFAULT 0,
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);

-- Security alerts sent to users
CREATE TABLE public.security_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    alert_type VARCHAR(50) NOT NULL,  -- blocked_login, suspicious_login, new_device, etc.

    -- Context
    ip_address INET,
    location JSONB,
    device_info JSONB,
    risk_factors JSONB,

    -- Delivery
    email_sent BOOLEAN DEFAULT false,
    email_sent_at TIMESTAMPTZ,
    sms_sent BOOLEAN DEFAULT false,
    sms_sent_at TIMESTAMPTZ,

    -- User response
    user_acknowledged BOOLEAN DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    user_action VARCHAR(50),  -- confirmed, reported_suspicious, changed_password

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_user_devices_user ON public.user_devices(user_id);
CREATE INDEX idx_user_devices_fingerprint ON public.user_devices(fingerprint);
CREATE INDEX idx_login_risk_user ON public.login_risk_assessments(user_id, created_at DESC);
CREATE INDEX idx_login_risk_ip ON public.login_risk_assessments(ip_address);
CREATE INDEX idx_security_alerts_user ON public.security_alerts(user_id, created_at DESC);
CREATE INDEX idx_security_alerts_type ON public.security_alerts(alert_type, created_at DESC);

-- RLS Policies
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_login_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_mfa_factors ENABLE ROW LEVEL SECURITY;

-- Users can only see their own devices
CREATE POLICY "users_own_devices" ON public.user_devices
    FOR ALL USING (user_id = auth.uid());

-- Users can only see their own risk assessments
CREATE POLICY "users_own_risk_assessments" ON public.login_risk_assessments
    FOR SELECT USING (user_id = auth.uid());

-- Users can only see their own login patterns
CREATE POLICY "users_own_patterns" ON public.user_login_patterns
    FOR ALL USING (user_id = auth.uid());

-- Users can only see their own security alerts
CREATE POLICY "users_own_alerts" ON public.security_alerts
    FOR ALL USING (user_id = auth.uid());

-- Users can only see their own phone verifications
CREATE POLICY "users_own_phone_verifications" ON public.phone_verifications
    FOR ALL USING (user_id = auth.uid());

-- Users can only see their own MFA factors
CREATE POLICY "users_own_mfa_factors" ON public.user_mfa_factors
    FOR ALL USING (user_id = auth.uid());
```

---

## Implementation Guide

### Frontend Integration

```typescript
// hooks/useAuth.ts
import { useSupabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export function useAuth() {
  const supabase = useSupabase();
  const router = useRouter();

  const signUp = async (data: SignupData) => {
    const response = await fetch('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message);
    }

    const result = await response.json();

    // Set session in Supabase client
    await supabase.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token,
    });

    return result;
  };

  const signIn = async (email: string, password: string) => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message);
    }

    const result = await response.json();

    if (result.mfa_required) {
      // Redirect to MFA verification
      return { mfa_required: true, challenge: result.mfa_challenge };
    }

    await supabase.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token,
    });

    return result;
  };

  const signInWithGoogle = async () => {
    window.location.href = '/api/v1/auth/oauth/google';
  };

  const signInWithGitHub = async () => {
    window.location.href = '/api/v1/auth/oauth/github';
  };

  const signInWithSSO = async (tenantDomain: string) => {
    // Check what SSO is configured for this tenant
    const response = await fetch(`/api/v1/auth/providers?domain=${tenantDomain}`);
    const providers = await response.json();

    if (providers.enterprise_sso?.enabled) {
      window.location.href = providers.enterprise_sso.login_url;
    } else {
      throw new Error('SSO not configured for this organization');
    }
  };

  const signOut = async (scope: 'local' | 'global' = 'local') => {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    });

    await supabase.auth.signOut();
    router.push('/login');
  };

  return {
    signUp,
    signIn,
    signInWithGoogle,
    signInWithGitHub,
    signInWithSSO,
    signOut,
  };
}
```

### Auth Callback Handler

```typescript
// app/auth/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSupabase } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useSupabase();

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const error = searchParams.get('error');
      const redirectTo = searchParams.get('redirect_to') || '/dashboard';

      if (error) {
        router.push(`/login?error=${encodeURIComponent(error)}`);
        return;
      }

      if (code) {
        const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

        if (sessionError) {
          router.push(`/login?error=${encodeURIComponent(sessionError.message)}`);
          return;
        }

        router.push(redirectTo);
      }
    };

    handleCallback();
  }, [searchParams, router, supabase]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      <span className="ml-3">Completing sign in...</span>
    </div>
  );
}
```

---

## Security Checklist

### Implementation Security

- [ ] All passwords hashed with bcrypt (cost factor 12+)
- [ ] Rate limiting on all auth endpoints
- [ ] Account lockout after failed attempts
- [ ] CSRF protection on all forms
- [ ] Secure cookie settings (HttpOnly, Secure, SameSite)
- [ ] Password breach checking (HaveIBeenPwned)
- [ ] Password history to prevent reuse
- [ ] Session invalidation on password change
- [ ] MFA backup codes stored hashed
- [ ] OAuth state parameter for CSRF protection
- [ ] PKCE for all OAuth flows

### Suspicious Activity Detection

- [ ] Risk scoring algorithm implemented (10 factors)
- [ ] Email verification for suspicious logins (score >= 50)
- [ ] High-risk login blocking (score >= 80)
- [ ] Impossible travel detection (geo-velocity)
- [ ] VPN/Tor exit node detection
- [ ] Device fingerprinting for trust management
- [ ] User login pattern learning
- [ ] Security alert email delivery
- [ ] Trusted device management (30-day expiry)

### Phone Verification (Twilio)

- [ ] Twilio Verify API integration
- [ ] E.164 phone number normalization
- [ ] Phone number validation (libphonenumber-js)
- [ ] Rate limiting per phone (5/hour)
- [ ] Rate limiting per user (10/hour)
- [ ] SMS delivery status tracking via webhooks
- [ ] Twilio webhook signature validation
- [ ] Phone number uniqueness enforcement
- [ ] SMS MFA as alternative to TOTP

### Audit & Monitoring

- [ ] Log all auth events (success and failure)
- [ ] Alert on suspicious activity (multiple failures, unusual locations)
- [ ] Track session creation and revocation
- [ ] Monitor for credential stuffing attacks
- [ ] Regular security audits of auth code
- [ ] SMS delivery failure alerting
- [ ] Risk assessment logging for forensics

### Compliance

- [ ] GDPR: Right to deletion includes auth data
- [ ] SOC 2: Auth audit trail maintained
- [ ] Password policy meets security standards
- [ ] MFA available for all users (TOTP + SMS)
- [ ] Enterprise SSO for business customers
- [ ] Phone number privacy (masking in logs)
- [ ] Geo-location data retention policies

---

## Changelog

### v1.1.0 (January 26, 2026)

- **Suspicious Activity Detection**
  - Added intelligent login risk scoring (0-100 scale)
  - 10 risk factors: new device, new location, impossible travel, VPN/Tor, unusual time, failed attempts, etc.
  - Email verification required for suspicious logins (score >= 50)
  - Blocked login alerts for high-risk attempts (score >= 80)
  - Trusted devices management with 30-day trust period
  - User login pattern learning for unusual time detection
  - Security alert emails with detailed risk factor explanations
  - Device fingerprinting and location tracking

- **Phone Verification with Twilio SMS**
  - Complete Twilio Verify API integration
  - SMS and voice call verification channels
  - Phone number validation with libphonenumber-js
  - E.164 format normalization
  - Rate limiting: 5 attempts per phone per hour
  - Delivery status tracking via Twilio webhooks

- **SMS-Based MFA**
  - Alternative to TOTP for multi-factor authentication
  - Requires verified phone number
  - SMS challenge during login
  - Twilio Verify API for secure OTP delivery

- **New API Endpoints**
  - POST `/auth/verify-suspicious-login` - Complete suspicious login verification
  - GET/DELETE `/auth/devices` - Manage trusted devices
  - POST `/auth/mfa/sms/enable` - Enable SMS MFA
  - POST `/auth/mfa/sms/challenge` - Send SMS MFA code
  - POST `/auth/mfa/sms/verify` - Verify SMS MFA code
  - POST `/webhooks/twilio/status` - SMS delivery callback

- **New Database Tables**
  - `phone_verifications` - Twilio verification tracking
  - `sms_delivery_logs` - SMS delivery status from webhooks
  - `user_mfa_factors` - MFA factors (TOTP, SMS, email)
  - `user_devices` - Trusted device management
  - `login_risk_assessments` - Risk scoring history
  - `user_login_patterns` - Learned login behavior
  - `security_alerts` - Alert delivery tracking

### v1.0.0 (January 26, 2026)

- Initial authentication strategy document
- Email/password authentication flows
- Social OAuth (Google, GitHub, Microsoft, Apple)
- Enterprise SSO (SAML 2.0, OIDC)
- SSO migration strategy
- MFA implementation
- Session management
- Security measures and policies
- Complete API endpoint specification
- Database schema for auth tables

---

## Related Documents

- [OAUTH_STRATEGY.md](./OAUTH_STRATEGY.md) - OAuth for external integrations
- [RATE_LIMITING.md](./RATE_LIMITING.md) - Rate limiting specification
- [SETTINGS.md](./SETTINGS.md) - Profile security settings UI
- [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md) - Auth hooks implementation
- [rbac_contract.md](./rbac_contract.md) - Role-based access control
