/**
 * Supabase Auth Service
 *
 * Wrapper around Supabase Auth (GoTrue) for authentication operations.
 * Per UNIFIED_AUTH_STRATEGY.md Section 1.
 */

import { createClient, SupabaseClient, User as SupabaseUser, Session } from '@supabase/supabase-js';
import { getEnv } from '../config/env';

let supabaseClient: SupabaseClient | null = null;
let supabaseAdminClient: SupabaseClient | null = null;

/**
 * Get Cloudflare Access headers for Zero Trust authentication
 */
function getCFAccessHeaders(): Record<string, string> {
  const env = getEnv();
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    return {
      'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
    };
  }
  return {};
}

/**
 * Get Supabase client (anon key - for client-side operations)
 */
export function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const env = getEnv();
  supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: getCFAccessHeaders(),
    },
  });

  return supabaseClient;
}

/**
 * Get Supabase admin client (service role key - for server-side operations)
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdminClient) return supabaseAdminClient;

  const env = getEnv();
  supabaseAdminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: getCFAccessHeaders(),
    },
  });

  return supabaseAdminClient;
}

export interface AuthResult {
  user: SupabaseUser | null;
  session: Session | null;
  error: string | null;
}

/**
 * Create a new user in Supabase Auth
 */
export async function createAuthUser(
  email: string,
  password: string,
  metadata?: Record<string, unknown>
): Promise<AuthResult> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Mark as confirmed so Supabase allows sign-in (we verify email separately)
    user_metadata: metadata,
  });

  if (error) {
    return { user: null, session: null, error: error.message };
  }

  return { user: data.user, session: null, error: null };
}

/**
 * Sign in a user with email and password
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<AuthResult> {
  const supabase = getSupabase();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { user: null, session: null, error: error.message };
  }

  return { user: data.user, session: data.session, error: null };
}

/**
 * Validate an access token and return the session
 */
export async function getSession(accessToken: string): Promise<{
  user: SupabaseUser | null;
  session: Session | null;
  error: string | null;
}> {
  const supabase = getSupabase();

  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error) {
    return { user: null, session: null, error: error.message };
  }

  return { user: data.user, session: null, error: null };
}

/**
 * Update user data in Supabase Auth
 */
export async function updateAuthUser(
  userId: string,
  data: {
    email?: string;
    password?: string;
    phone?: string;
    user_metadata?: Record<string, unknown>;
  }
): Promise<{ user: SupabaseUser | null; error: string | null }> {
  const supabase = getSupabaseAdmin();

  const { data: result, error } = await supabase.auth.admin.updateUserById(userId, data);

  if (error) {
    return { user: null, error: error.message };
  }

  return { user: result.user, error: null };
}

/**
 * Delete a user from Supabase Auth
 */
export async function deleteAuthUser(userId: string): Promise<{ error: string | null }> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

/**
 * Sign out a user (invalidate session)
 */
export async function signOut(accessToken: string): Promise<{ error: string | null }> {
  const supabase = getSupabase();

  // Set the session first
  await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: '',
  });

  const { error } = await supabase.auth.signOut();

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

/**
 * Generate a password reset link
 */
export async function generatePasswordResetLink(email: string): Promise<{
  link: string | null;
  error: string | null;
}> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
  });

  if (error) {
    return { link: null, error: error.message };
  }

  return { link: data.properties.action_link, error: null };
}

export const supabaseService = {
  getSupabase,
  getSupabaseAdmin,
  createAuthUser,
  signInWithPassword,
  getSession,
  updateAuthUser,
  deleteAuthUser,
  signOut,
  generatePasswordResetLink,
};
