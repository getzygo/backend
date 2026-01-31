/**
 * Environment Configuration
 *
 * Validates and loads environment variables using Zod.
 */

import { z } from 'zod';

const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string(),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TOKEN_EXPIRY: z.coerce.number().default(3600), // 1 hour
  JWT_REFRESH_TOKEN_EXPIRY: z.coerce.number().default(604800), // 7 days

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),

  // GitHub OAuth
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),

  // Encryption
  ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex

  // Session
  SESSION_COOKIE_SECRET: z.string().min(32),
  SESSION_COOKIE_SECURE: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  RATE_LIMIT_AUTH_MAX_REQUESTS: z.coerce.number().default(5),

  // Twilio (Phone Verification)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),

  // SMTP (Email Verification)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  EMAIL_FROM: z.string().default('noreply@zygo.tech'),
});

export type Env = z.infer<typeof envSchema>;

let env: Env;

export function loadEnv(): Env {
  if (env) return env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Invalid environment configuration');
  }

  env = result.data;
  return env;
}

export function getEnv(): Env {
  if (!env) {
    throw new Error('Environment not loaded. Call loadEnv() first.');
  }
  return env;
}
