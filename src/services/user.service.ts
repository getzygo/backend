/**
 * User Service
 *
 * Handles user creation, authentication, and management.
 */

import { eq, and } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { getDb } from '../db/client';
import { users, socialLogins, auditLogs } from '../db/schema';
import type { User, NewUser, NewSocialLogin, NewAuditLog } from '../db/schema';
import type { OAuthProvider, OAuthPendingSignup } from '../types/oauth';

/**
 * Bcrypt salt rounds (OWASP recommended: 10-12)
 */
const BCRYPT_SALT_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Check if a user exists by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getDb();

  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  return result[0] || null;
}

/**
 * Check if a social login exists
 */
export async function getSocialLogin(
  provider: OAuthProvider,
  providerUserId: string
) {
  const db = getDb();

  const result = await db
    .select()
    .from(socialLogins)
    .where(and(
      eq(socialLogins.provider, provider),
      eq(socialLogins.providerUserId, providerUserId)
    ))
    .limit(1);

  return result[0] || null;
}

/**
 * Create a new user with OAuth
 */
export async function createUserWithOAuth(params: {
  email: string;
  password: string;
  provider: OAuthProvider;
  providerUserId: string;
  name?: string;
  termsVersion: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<User> {
  const db = getDb();
  const {
    email,
    password,
    provider,
    providerUserId,
    name,
    termsVersion,
    ipAddress,
    userAgent,
  } = params;

  // Check if user already exists
  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    throw new Error('A user with this email already exists');
  }

  // Check if social login already exists
  const existingSocialLogin = await getSocialLogin(provider, providerUserId);
  if (existingSocialLogin) {
    throw new Error('This social account is already linked to another user');
  }

  // Hash the password
  const passwordHash = await hashPassword(password);

  // Parse name into first/last
  let firstName: string | undefined;
  let lastName: string | undefined;
  if (name) {
    const nameParts = name.trim().split(/\s+/);
    firstName = nameParts[0];
    lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;
  }

  const now = new Date();

  // Create user
  const newUser: NewUser = {
    email: email.toLowerCase(),
    emailVerified: true, // OAuth verified the email
    emailVerifiedVia: provider, // Track which provider verified the email
    passwordHash,
    firstName,
    lastName,
    displayName: name,
    termsAcceptedAt: now,
    termsVersion,
    privacyAcceptedAt: now,
    privacyVersion: termsVersion,
    passwordChangedAt: now,
  };

  const [user] = await db.insert(users).values(newUser).returning();

  // Create social login record
  const newSocialLogin: NewSocialLogin = {
    userId: user.id,
    provider,
    providerUserId,
    providerEmail: email,
    lastLoginAt: now,
  };

  await db.insert(socialLogins).values(newSocialLogin);

  // Create audit log
  const auditLog: NewAuditLog = {
    userId: user.id,
    action: 'signup_oauth',
    resourceType: 'user',
    resourceId: user.id,
    details: {
      provider,
      email,
    },
    ipAddress,
    userAgent,
    status: 'success',
  };

  await db.insert(auditLogs).values(auditLog);

  return user;
}

/**
 * Create a new user with email/password (non-OAuth)
 */
export async function createUser(params: {
  email: string;
  password: string;
  name?: string;
  termsVersion: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<User> {
  const db = getDb();
  const { email, password, name, termsVersion, ipAddress, userAgent } = params;

  // Check if user already exists
  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    throw new Error('A user with this email already exists');
  }

  // Hash the password
  const passwordHash = await hashPassword(password);

  // Parse name
  let firstName: string | undefined;
  let lastName: string | undefined;
  if (name) {
    const nameParts = name.trim().split(/\s+/);
    firstName = nameParts[0];
    lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;
  }

  const now = new Date();

  // Create user
  const newUser: NewUser = {
    email: email.toLowerCase(),
    emailVerified: false,
    passwordHash,
    firstName,
    lastName,
    displayName: name,
    termsAcceptedAt: now,
    termsVersion,
    privacyAcceptedAt: now,
    privacyVersion: termsVersion,
    passwordChangedAt: now,
  };

  const [user] = await db.insert(users).values(newUser).returning();

  // Create audit log
  const auditLog: NewAuditLog = {
    userId: user.id,
    action: 'signup',
    resourceType: 'user',
    resourceId: user.id,
    details: {
      email,
    },
    ipAddress,
    userAgent,
    status: 'success',
  };

  await db.insert(auditLogs).values(auditLog);

  return user;
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const db = getDb();

  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get social logins for a user
 */
export async function getUserSocialLogins(userId: string) {
  const db = getDb();

  const result = await db
    .select()
    .from(socialLogins)
    .where(eq(socialLogins.userId, userId));

  return result;
}

/**
 * Link an OAuth provider to an existing user
 */
export async function linkSocialLogin(params: {
  userId: string;
  provider: OAuthProvider;
  providerUserId: string;
  providerEmail: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  const db = getDb();
  const { userId, provider, providerUserId, providerEmail, ipAddress, userAgent } = params;

  // Check if this social login is already linked to another user
  const existingSocialLogin = await getSocialLogin(provider, providerUserId);
  if (existingSocialLogin) {
    if (existingSocialLogin.userId === userId) {
      // Already linked to this user
      return;
    }
    throw new Error('This social account is already linked to another user');
  }

  // Check if user already has this provider linked
  const userSocialLogins = await getUserSocialLogins(userId);
  const existingProviderLink = userSocialLogins.find((sl) => sl.provider === provider);
  if (existingProviderLink) {
    throw new Error(`You already have a ${provider} account linked`);
  }

  const now = new Date();

  // Create social login record
  const newSocialLogin: NewSocialLogin = {
    userId,
    provider,
    providerUserId,
    providerEmail,
    lastLoginAt: now,
  };

  await db.insert(socialLogins).values(newSocialLogin);

  // Create audit log
  const auditLog: NewAuditLog = {
    userId,
    action: 'oauth_linked',
    resourceType: 'social_login',
    resourceId: provider,
    details: {
      provider,
      providerEmail,
    },
    ipAddress,
    userAgent,
    status: 'success',
  };

  await db.insert(auditLogs).values(auditLog);
}

/**
 * Unlink an OAuth provider from a user
 * If the provider was used to verify the email, resets email verification
 */
export async function unlinkSocialLogin(params: {
  userId: string;
  provider: OAuthProvider;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ emailVerificationReset: boolean }> {
  const db = getDb();
  const { userId, provider, ipAddress, userAgent } = params;

  // Find the social login
  const userSocialLogins = await getUserSocialLogins(userId);
  const socialLogin = userSocialLogins.find((sl) => sl.provider === provider);

  if (!socialLogin) {
    throw new Error(`No ${provider} account is linked`);
  }

  // Get user to check if email was verified via this provider
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { emailVerifiedVia: true },
  });

  let emailVerificationReset = false;

  // If email was verified via this provider, reset verification
  if (user?.emailVerifiedVia === provider) {
    await db
      .update(users)
      .set({
        emailVerified: false,
        emailVerifiedVia: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    emailVerificationReset = true;
  }

  // Delete the social login
  await db
    .delete(socialLogins)
    .where(and(eq(socialLogins.userId, userId), eq(socialLogins.provider, provider)));

  // Create audit log
  const auditLog: NewAuditLog = {
    userId,
    action: 'oauth_unlinked',
    resourceType: 'social_login',
    resourceId: provider,
    details: {
      provider,
      emailVerificationReset,
    },
    ipAddress,
    userAgent,
    status: 'success',
  };

  await db.insert(auditLogs).values(auditLog);

  return { emailVerificationReset };
}

/**
 * Update social login last login time
 */
export async function updateSocialLoginTimestamp(
  provider: OAuthProvider,
  providerUserId: string
): Promise<void> {
  const db = getDb();

  await db
    .update(socialLogins)
    .set({ lastLoginAt: new Date() })
    .where(
      and(eq(socialLogins.provider, provider), eq(socialLogins.providerUserId, providerUserId))
    );
}

export const userService = {
  hashPassword,
  verifyPassword,
  getUserByEmail,
  getUserById,
  getSocialLogin,
  getUserSocialLogins,
  createUserWithOAuth,
  createUser,
  linkSocialLogin,
  unlinkSocialLogin,
  updateSocialLoginTimestamp,
};
