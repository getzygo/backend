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
 * Refresh a session using a refresh token
 */
export async function refreshSession(refreshToken: string): Promise<AuthResult> {
  const supabase = getSupabase();

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error) {
    return { user: null, session: null, error: error.message };
  }

  return { user: data.user, session: data.session, error: null };
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
 * Sign out a user from all sessions (admin operation)
 * Used when revoking sessions to ensure tokens are invalidated server-side
 */
export async function signOutUser(userId: string): Promise<{ error: string | null }> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.auth.admin.signOut(userId, 'global');

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

/**
 * Generate session tokens for a user (admin operation)
 * Used for magic link authentication where we need to create a session
 * without the user providing a password.
 */
export async function generateSessionForUser(userId: string): Promise<AuthResult> {
  const supabase = getSupabaseAdmin();

  // First get the user to get their email
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);

  if (userError || !userData.user) {
    return { user: null, session: null, error: userError?.message || 'User not found' };
  }

  // Generate a magic link which includes session tokens
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: userData.user.email!,
  });

  if (error) {
    return { user: null, session: null, error: error.message };
  }

  // The generateLink response includes the hashed_token which we can use
  // to create a session. However, for simpler approach, we'll use the
  // admin API to directly set a session.

  // Alternative: Use the token from the link to verify and get session
  // For now, we'll return the properties which include tokens
  if (data.properties?.access_token && data.properties?.refresh_token) {
    return {
      user: data.user,
      session: {
        access_token: data.properties.access_token,
        refresh_token: data.properties.refresh_token,
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: data.user,
      } as Session,
      error: null,
    };
  }

  // If properties don't have tokens, the Supabase version might not support it
  // In this case, we return an error
  return {
    user: data.user,
    session: null,
    error: 'Session tokens not available in generateLink response'
  };
}

export const supabaseService = {
  getSupabase,
  getSupabaseAdmin,
  createAuthUser,
  signInWithPassword,
  getSession,
  refreshSession,
  updateAuthUser,
  deleteAuthUser,
  signOut,
  signOutUser,
  generatePasswordResetLink,
  generateSessionForUser,
};
