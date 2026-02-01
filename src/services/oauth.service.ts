/**
 * OAuth Service
 *
 * Handles OAuth authentication flows for Google and GitHub.
 * Uses Redis for storing pending signup data.
 */

import crypto from 'crypto';
import { getEnv } from '../config/env';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';
import type {
  OAuthProvider,
  OAuthUserInfo,
  OAuthTokens,
  OAuthPendingSignup,
} from '../types/oauth';

/**
 * Provider configurations
 */
const PROVIDER_CONFIG = {
  google: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    getClientId: () => getEnv().GOOGLE_CLIENT_ID,
    getClientSecret: () => getEnv().GOOGLE_CLIENT_SECRET,
    parseUserInfo: (data: Record<string, unknown>): OAuthUserInfo => ({
      id: String(data.id),
      email: String(data.email),
      name: data.name ? String(data.name) : undefined,
      avatar: data.picture ? String(data.picture) : undefined,
    }),
  },
  github: {
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    emailsUrl: 'https://api.github.com/user/emails',
    getClientId: () => getEnv().GITHUB_CLIENT_ID,
    getClientSecret: () => getEnv().GITHUB_CLIENT_SECRET,
    parseUserInfo: (data: Record<string, unknown>, email: string): OAuthUserInfo => ({
      id: String(data.id),
      email,
      name: data.name ? String(data.name) : data.login ? String(data.login) : undefined,
      avatar: data.avatar_url ? String(data.avatar_url) : undefined,
    }),
  },
};

/**
 * Generate a cryptographically secure token
 */
function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const config = PROVIDER_CONFIG[provider];

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.getClientId(),
    client_secret: config.getClientSecret(),
    redirect_uri: redirectUri,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Token exchange failed for ${provider}:`, errorText);
    throw new Error(`Failed to exchange authorization code: ${response.status}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type || 'Bearer',
  };
}

/**
 * Get user info from Google
 */
async function getGoogleUserInfo(accessToken: string): Promise<OAuthUserInfo> {
  const response = await fetch(PROVIDER_CONFIG.google.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google user info: ${response.status}`);
  }

  const data = await response.json();
  return PROVIDER_CONFIG.google.parseUserInfo(data);
}

/**
 * Get user info from GitHub
 */
async function getGitHubUserInfo(accessToken: string): Promise<OAuthUserInfo> {
  // Get user profile
  const userResponse = await fetch(PROVIDER_CONFIG.github.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!userResponse.ok) {
    throw new Error(`Failed to fetch GitHub user info: ${userResponse.status}`);
  }

  const userData = await userResponse.json();

  // GitHub may not return email in user profile if it's private
  let email = userData.email;

  if (!email) {
    const emailsResponse = await fetch(PROVIDER_CONFIG.github.emailsUrl!, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (emailsResponse.ok) {
      const emails = await emailsResponse.json();
      const primaryEmail = emails.find((e: { primary: boolean }) => e.primary);
      const verifiedEmail = emails.find((e: { verified: boolean }) => e.verified);
      email = primaryEmail?.email || verifiedEmail?.email || emails[0]?.email;
    }
  }

  if (!email) {
    throw new Error(
      'Could not retrieve email from GitHub. Please ensure your email is public or grant email permission.'
    );
  }

  return PROVIDER_CONFIG.github.parseUserInfo(userData, email);
}

/**
 * Store pending signup data in Redis
 */
async function storePendingSignup(
  token: string,
  data: OAuthPendingSignup
): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.OAUTH_PENDING}${token}`;

  await redis.setex(key, REDIS_TTL.OAUTH_PENDING, JSON.stringify(data));
}

/**
 * Get pending signup data from Redis
 */
async function getPendingSignupFromRedis(
  token: string
): Promise<OAuthPendingSignup | null> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.OAUTH_PENDING}${token}`;

  const data = await redis.get(key);
  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as OAuthPendingSignup;
  } catch {
    return null;
  }
}

/**
 * Delete pending signup data from Redis
 */
async function deletePendingSignup(token: string): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.OAUTH_PENDING}${token}`;

  await redis.del(key);
}

/**
 * Exchange OAuth code and return user info with a pending signup token
 */
export async function handleOAuthCallback(
  code: string,
  provider: OAuthProvider,
  redirectUri: string
): Promise<{ email: string; name?: string; oauthToken: string }> {
  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(provider, code, redirectUri);

  // Get user info from provider
  let userInfo: OAuthUserInfo;
  if (provider === 'google') {
    userInfo = await getGoogleUserInfo(tokens.accessToken);
  } else {
    userInfo = await getGitHubUserInfo(tokens.accessToken);
  }

  // Generate a secure token for the pending signup
  const oauthToken = generateSecureToken();

  // Store pending signup data in Redis
  const pendingSignup: OAuthPendingSignup = {
    provider,
    providerUserId: userInfo.id,
    email: userInfo.email,
    name: userInfo.name,
    createdAt: Date.now(),
  };

  await storePendingSignup(oauthToken, pendingSignup);

  return {
    email: userInfo.email,
    name: userInfo.name,
    oauthToken,
  };
}

/**
 * Get pending signup data by token
 */
export async function getPendingSignup(
  oauthToken: string
): Promise<OAuthPendingSignup | null> {
  return getPendingSignupFromRedis(oauthToken);
}

/**
 * Remove pending signup after successful registration
 */
export async function clearPendingSignup(oauthToken: string): Promise<void> {
  await deletePendingSignup(oauthToken);
}

/**
 * Store pending link request in Redis (for users with tenants)
 */
interface OAuthPendingLink {
  provider: OAuthProvider;
  providerUserId: string;
  providerEmail: string;
  userId: string;
  verificationCode: string;
  attempts: number;
  createdAt: number;
}

async function storePendingLink(token: string, data: OAuthPendingLink): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.OAUTH_PENDING}link:${token}`;
  // Link verifications expire in 15 minutes
  await redis.setex(key, 900, JSON.stringify(data));
}

async function getPendingLinkFromRedis(token: string): Promise<OAuthPendingLink | null> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.OAUTH_PENDING}link:${token}`;
  const data = await redis.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as OAuthPendingLink;
  } catch {
    return null;
  }
}

async function updatePendingLink(token: string, data: OAuthPendingLink): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.OAUTH_PENDING}link:${token}`;
  // Get remaining TTL
  const ttl = await redis.ttl(key);
  if (ttl > 0) {
    await redis.setex(key, ttl, JSON.stringify(data));
  }
}

async function deletePendingLink(token: string): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.OAUTH_PENDING}link:${token}`;
  await redis.del(key);
}

/**
 * Generate a 6-digit verification code
 */
function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Create a pending link request (requires email verification)
 * Per Section 10.2 - users with existing tenants must verify via email
 */
export async function createPendingLinkRequest(
  userId: string,
  provider: OAuthProvider,
  providerUserId: string,
  providerEmail: string
): Promise<{ linkToken: string; verificationCode: string }> {
  const linkToken = generateSecureToken();
  const verificationCode = generateVerificationCode();

  const pendingLink: OAuthPendingLink = {
    provider,
    providerUserId,
    providerEmail,
    userId,
    verificationCode,
    attempts: 0,
    createdAt: Date.now(),
  };

  await storePendingLink(linkToken, pendingLink);

  return { linkToken, verificationCode };
}

/**
 * Verify link request code
 * Returns provider info if successful, null if invalid/expired
 */
export async function verifyLinkCode(
  linkToken: string,
  code: string
): Promise<{ provider: OAuthProvider; providerUserId: string; providerEmail: string } | null> {
  const pendingLink = await getPendingLinkFromRedis(linkToken);

  if (!pendingLink) {
    return null; // Expired or invalid token
  }

  // Check max attempts (3)
  if (pendingLink.attempts >= 3) {
    await deletePendingLink(linkToken);
    return null;
  }

  // Verify code
  if (pendingLink.verificationCode !== code) {
    // Increment attempts
    pendingLink.attempts++;
    await updatePendingLink(linkToken, pendingLink);
    return null;
  }

  // Success - return provider info
  return {
    provider: pendingLink.provider,
    providerUserId: pendingLink.providerUserId,
    providerEmail: pendingLink.providerEmail,
  };
}

/**
 * Get pending link data (for checking status)
 */
export async function getPendingLink(linkToken: string): Promise<{
  userId: string;
  provider: OAuthProvider;
  providerEmail: string;
  attemptsRemaining: number;
} | null> {
  const pendingLink = await getPendingLinkFromRedis(linkToken);

  if (!pendingLink) {
    return null;
  }

  return {
    userId: pendingLink.userId,
    provider: pendingLink.provider,
    providerEmail: pendingLink.providerEmail,
    attemptsRemaining: Math.max(0, 3 - pendingLink.attempts),
  };
}

/**
 * Clear pending link after successful linking
 */
export async function clearPendingLink(linkToken: string): Promise<void> {
  await deletePendingLink(linkToken);
}

export const oauthService = {
  handleOAuthCallback,
  getPendingSignup,
  clearPendingSignup,
  createPendingLinkRequest,
  verifyLinkCode,
  getPendingLink,
  clearPendingLink,
};
