/**
 * WebAuthn Service
 *
 * Handles WebAuthn (Passkeys) registration and authentication.
 * Uses @simplewebauthn/server for server-side operations.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { eq, and, gt } from 'drizzle-orm';
import { getDb } from '../db/client';
import { passkeys, webauthnChallenges, users, auditLogs } from '../db/schema';
import type { Passkey, NewPasskey } from '../db/schema/security';

// WebAuthn configuration
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Zygo';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'zygo.tech';

/**
 * Get allowed origins for WebAuthn verification.
 * Allows any *.zygo.tech subdomain and getzygo.com
 */
function getAllowedOrigins(requestOrigin?: string): string[] {
  const origins = ['https://getzygo.com'];

  // Add the request origin if it's a valid zygo.tech subdomain
  if (requestOrigin && requestOrigin.match(/^https:\/\/[a-z0-9-]+\.zygo\.tech$/)) {
    origins.push(requestOrigin);
  }

  return origins;
}

// Challenge expiration (5 minutes)
const CHALLENGE_EXPIRY_MINUTES = 5;

interface RegisteredPasskey {
  id: string;
  name: string | null;
  deviceType: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * Store a challenge temporarily for verification.
 */
async function storeChallenge(
  userId: string | null,
  challenge: string,
  type: 'registration' | 'authentication'
): Promise<void> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRY_MINUTES * 60 * 1000);

  await db.insert(webauthnChallenges).values({
    userId,
    challenge,
    type,
    expiresAt,
  });
}

/**
 * Get and consume a stored challenge.
 */
async function getChallenge(
  userId: string | null,
  type: 'registration' | 'authentication'
): Promise<string | null> {
  const db = getDb();

  const result = await db.query.webauthnChallenges.findFirst({
    where: and(
      userId ? eq(webauthnChallenges.userId, userId) : undefined,
      eq(webauthnChallenges.type, type),
      gt(webauthnChallenges.expiresAt, new Date())
    ),
    orderBy: (challenges, { desc }) => [desc(challenges.createdAt)],
  });

  if (!result) {
    return null;
  }

  // Delete the challenge (single use)
  await db
    .delete(webauthnChallenges)
    .where(eq(webauthnChallenges.id, result.id));

  return result.challenge;
}

/**
 * Generate registration options for a new passkey.
 */
export async function generateRegistrationOpts(
  userId: string,
  userEmail: string,
  userName: string
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const db = getDb();

  // Get existing passkeys to exclude
  const existingPasskeys = await db.query.passkeys.findMany({
    where: eq(passkeys.userId, userId),
  });

  const excludeCredentials = existingPasskeys.map((pk) => ({
    id: pk.credentialId,
    type: 'public-key' as const,
    transports: (pk.transports as AuthenticatorTransportFuture[]) || undefined,
  }));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(userId),
    userName: userEmail,
    userDisplayName: userName || userEmail,
    attestationType: 'none', // Don't require attestation
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform', // Prefer platform authenticators (Touch ID, Face ID, Windows Hello)
    },
  });

  // Store challenge
  await storeChallenge(userId, options.challenge, 'registration');

  return options;
}

/**
 * Verify a registration response and store the new passkey.
 */
export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  passkeyyName?: string,
  ipAddress?: string,
  userAgent?: string,
  requestOrigin?: string
): Promise<{ success: boolean; passkeyId?: string; error?: string }> {
  const db = getDb();

  // Get stored challenge
  const expectedChallenge = await getChallenge(userId, 'registration');
  if (!expectedChallenge) {
    return { success: false, error: 'challenge_expired' };
  }

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: getAllowedOrigins(requestOrigin),
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { success: false, error: 'verification_failed' };
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Store the new passkey
    const [newPasskey] = await db
      .insert(passkeys)
      .values({
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: response.response.transports || [],
        deviceType: credentialDeviceType,
        name: passkeyyName || `Passkey ${new Date().toLocaleDateString()}`,
        aaguid: verification.registrationInfo.aaguid,
        lastUsedAt: new Date(),
      })
      .returning();

    // Update user's webauthn_enabled flag
    await db
      .update(users)
      .set({ webauthnEnabled: true })
      .where(eq(users.id, userId));

    // Audit log
    await db.insert(auditLogs).values({
      userId,
      action: 'passkey_register',
      resourceType: 'passkey',
      resourceId: newPasskey.id,
      details: {
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
        name: newPasskey.name,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return { success: true, passkeyId: newPasskey.id };
  } catch (error) {
    console.error('[WebAuthn] Registration verification failed:', error);
    return { success: false, error: 'verification_failed' };
  }
}

/**
 * Generate authentication options for passkey login.
 */
export async function generateAuthenticationOpts(
  userEmail?: string
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const db = getDb();

  let allowCredentials: { id: string; type: 'public-key'; transports?: AuthenticatorTransportFuture[] }[] = [];

  // If email provided, get user's passkeys
  if (userEmail) {
    const user = await db.query.users.findFirst({
      where: eq(users.email, userEmail.toLowerCase().trim()),
    });

    if (user) {
      const userPasskeys = await db.query.passkeys.findMany({
        where: eq(passkeys.userId, user.id),
      });

      allowCredentials = userPasskeys.map((pk) => ({
        id: pk.credentialId,
        type: 'public-key' as const,
        transports: (pk.transports as AuthenticatorTransportFuture[]) || undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
    userVerification: 'preferred',
  });

  // Store challenge (no user ID for authentication - user determined by credential)
  await storeChallenge(null, options.challenge, 'authentication');

  return options;
}

/**
 * Verify an authentication response.
 */
export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  ipAddress?: string,
  userAgent?: string,
  requestOrigin?: string
): Promise<{
  success: boolean;
  userId?: string;
  email?: string;
  error?: string;
}> {
  const db = getDb();

  // Find the passkey by credential ID
  const passkey = await db.query.passkeys.findFirst({
    where: eq(passkeys.credentialId, response.id),
    with: {
      user: true,
    },
  });

  if (!passkey) {
    return { success: false, error: 'credential_not_found' };
  }

  // Get stored challenge
  const expectedChallenge = await getChallenge(null, 'authentication');
  if (!expectedChallenge) {
    return { success: false, error: 'challenge_expired' };
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: getAllowedOrigins(requestOrigin),
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')),
        counter: passkey.counter,
        transports: (passkey.transports as AuthenticatorTransportFuture[]) || undefined,
      },
    });

    if (!verification.verified) {
      return { success: false, error: 'verification_failed' };
    }

    // Update counter and last used time
    await db
      .update(passkeys)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      })
      .where(eq(passkeys.id, passkey.id));

    // Audit log
    await db.insert(auditLogs).values({
      userId: passkey.userId,
      action: 'login',
      resourceType: 'user',
      resourceId: passkey.userId,
      details: { method: 'passkey', passkey_id: passkey.id },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return {
      success: true,
      userId: passkey.userId,
      email: passkey.user?.email,
    };
  } catch (error) {
    console.error('[WebAuthn] Authentication verification failed:', error);
    return { success: false, error: 'verification_failed' };
  }
}

/**
 * Get all passkeys for a user.
 */
export async function getUserPasskeys(userId: string): Promise<RegisteredPasskey[]> {
  const db = getDb();

  const userPasskeys = await db.query.passkeys.findMany({
    where: eq(passkeys.userId, userId),
    orderBy: (passkeys, { desc }) => [desc(passkeys.createdAt)],
  });

  return userPasskeys.map((pk) => ({
    id: pk.id,
    name: pk.name,
    deviceType: pk.deviceType,
    lastUsedAt: pk.lastUsedAt,
    createdAt: pk.createdAt,
  }));
}

/**
 * Delete a passkey.
 */
export async function deletePasskey(
  passkeyId: string,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<boolean> {
  const db = getDb();

  // Verify passkey belongs to user
  const passkey = await db.query.passkeys.findFirst({
    where: and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)),
  });

  if (!passkey) {
    return false;
  }

  // Delete the passkey
  await db.delete(passkeys).where(eq(passkeys.id, passkeyId));

  // Check if user has any remaining passkeys
  const remainingPasskeys = await db.query.passkeys.findMany({
    where: eq(passkeys.userId, userId),
  });

  // Update webauthn_enabled flag
  if (remainingPasskeys.length === 0) {
    await db
      .update(users)
      .set({ webauthnEnabled: false })
      .where(eq(users.id, userId));
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId,
    action: 'passkey_remove',
    resourceType: 'passkey',
    resourceId: passkeyId,
    details: { name: passkey.name },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return true;
}

/**
 * Rename a passkey.
 */
export async function renamePasskey(
  passkeyId: string,
  userId: string,
  newName: string
): Promise<boolean> {
  const db = getDb();

  // Verify passkey belongs to user
  const passkey = await db.query.passkeys.findFirst({
    where: and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)),
  });

  if (!passkey) {
    return false;
  }

  await db
    .update(passkeys)
    .set({ name: newName })
    .where(eq(passkeys.id, passkeyId));

  return true;
}

/**
 * Clean up expired challenges (for scheduled cleanup).
 */
export async function cleanupExpiredChallenges(): Promise<void> {
  const db = getDb();

  await db
    .delete(webauthnChallenges)
    .where(
      // @ts-ignore - lt works with dates
      gt(new Date(), webauthnChallenges.expiresAt)
    );
}

export default {
  generateRegistrationOpts,
  verifyRegistration,
  generateAuthenticationOpts,
  verifyAuthentication,
  getUserPasskeys,
  deletePasskey,
  renamePasskey,
  cleanupExpiredChallenges,
};
