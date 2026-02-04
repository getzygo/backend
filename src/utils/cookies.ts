/**
 * Cookie Utilities
 *
 * HTTPOnly cookie handling for secure token storage.
 * Tokens are stored in HTTPOnly cookies to prevent XSS attacks.
 */

import type { Context } from 'hono';
import { getEnv } from '../config/env';

// Cookie names
export const COOKIE_NAMES = {
  ACCESS_TOKEN: 'zygo_access_token',
  REFRESH_TOKEN: 'zygo_refresh_token',
} as const;

// Cookie options
interface CookieOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Get cookie options based on environment
 */
function getCookieOptions(overrides: Partial<CookieOptions> = {}): CookieOptions {
  const env = getEnv();
  const isProduction = env.NODE_ENV === 'production';

  return {
    path: '/',
    httpOnly: true,
    secure: isProduction, // HTTPS only in production
    // Use None for cross-subdomain requests (e.g., demo.zygo.tech → api.zygo.tech)
    // Requires Secure flag to be set
    sameSite: isProduction ? 'None' : 'Lax',
    domain: isProduction ? '.zygo.tech' : undefined, // Allow cross-subdomain in production
    ...overrides,
  };
}

/**
 * Set authentication cookies
 */
export function setAuthCookies(
  c: Context,
  accessToken: string,
  refreshToken: string,
  accessTokenExpiry: number = 3600, // 1 hour default
  refreshTokenExpiry: number = 604800 // 7 days default
): void {
  const accessOptions = getCookieOptions({ maxAge: accessTokenExpiry });
  const refreshOptions = getCookieOptions({ maxAge: refreshTokenExpiry });

  // Set access token cookie
  c.header(
    'Set-Cookie',
    serializeCookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, accessOptions),
    { append: true }
  );

  // Set refresh token cookie
  c.header(
    'Set-Cookie',
    serializeCookie(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, refreshOptions),
    { append: true }
  );
}

/**
 * Clear authentication cookies
 */
export function clearAuthCookies(c: Context): void {
  const clearOptions = getCookieOptions({ maxAge: 0 });

  c.header(
    'Set-Cookie',
    serializeCookie(COOKIE_NAMES.ACCESS_TOKEN, '', clearOptions),
    { append: true }
  );

  c.header(
    'Set-Cookie',
    serializeCookie(COOKIE_NAMES.REFRESH_TOKEN, '', clearOptions),
    { append: true }
  );
}

/**
 * Get access token from cookies or Authorization header
 */
export function getAccessToken(c: Context): string | null {
  // First try cookies
  const cookies = parseCookies(c.req.header('Cookie') || '');
  if (cookies[COOKIE_NAMES.ACCESS_TOKEN]) {
    return cookies[COOKIE_NAMES.ACCESS_TOKEN];
  }

  // Fall back to Authorization header (for API clients, mobile apps, etc.)
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * Get refresh token from cookies
 */
export function getRefreshToken(c: Context): string | null {
  const cookies = parseCookies(c.req.header('Cookie') || '');
  return cookies[COOKIE_NAMES.REFRESH_TOKEN] || null;
}

/**
 * Parse cookies from Cookie header
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = decodeURIComponent(rest.join('='));
    }
  });

  return cookies;
}

/**
 * Serialize cookie for Set-Cookie header
 */
function serializeCookie(name: string, value: string, options: CookieOptions): string {
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (options.maxAge !== undefined) {
    cookie += `; Max-Age=${options.maxAge}`;
  }

  if (options.path) {
    cookie += `; Path=${options.path}`;
  }

  if (options.domain) {
    cookie += `; Domain=${options.domain}`;
  }

  if (options.secure) {
    cookie += '; Secure';
  }

  if (options.httpOnly) {
    cookie += '; HttpOnly';
  }

  if (options.sameSite) {
    cookie += `; SameSite=${options.sameSite}`;
  }

  return cookie;
}
