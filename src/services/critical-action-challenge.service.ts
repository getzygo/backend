/**
 * Critical Action Challenge Service
 *
 * Generic service for critical action challenges (reusable for tenant deletion, account deletion, etc.)
 * Implements two-phase verification: email code + optional MFA verification.
 *
 * Redis key format: critical_action_challenge:{userId}:{action}:{resourceId}
 * TTL: 10 minutes
 */

import { randomInt } from 'crypto';
import { getRedis } from '../db/redis';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verifyMfaCode } from './mfa.service';

// TTL for challenges (10 minutes)
const CHALLENGE_TTL = 10 * 60;

// Redis key prefix
const CHALLENGE_KEY_PREFIX = 'critical_action_challenge:';

// Supported action types
export type CriticalActionType = 'tenant_deletion' | 'account_deletion' | 'data_export';

/**
 * Challenge data stored in Redis
 */
export interface ChallengeData {
  userId: string;
  action: CriticalActionType;
  resourceId: string;
  emailCode: string;
  emailSentTo: string;
  requiresMfa: boolean;
  mfaVerified: boolean;
  emailVerified: boolean;
  createdAt: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result from creating a challenge
 */
export interface CreateChallengeResult {
  challengeId: string;
  expiresIn: number;
  emailSentTo: string;
  requiresMfa: boolean;
  error?: string;
}

/**
 * Result from verification operations
 */
export interface VerificationResult {
  verified: boolean;
  error?: string;
}

/**
 * Generate Redis key for a challenge
 */
function getChallengeKey(userId: string, action: CriticalActionType, resourceId: string): string {
  return `${CHALLENGE_KEY_PREFIX}${userId}:${action}:${resourceId}`;
}

/**
 * Generate a cryptographically secure 6-digit verification code
 */
function generateCode(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * Mask email address for display (e.g., "a***@example.com")
 */
function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!domain) return email;

  if (localPart.length <= 1) {
    return `${localPart}***@${domain}`;
  }

  return `${localPart[0]}***@${domain}`;
}

/**
 * Check if user has MFA enabled
 */
async function userHasMfaEnabled(userId: string): Promise<boolean> {
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { mfaEnabled: true },
  });
  return user?.mfaEnabled ?? false;
}

/**
 * Create a new challenge for a critical action
 *
 * @param userId - The user initiating the action
 * @param action - The type of critical action
 * @param resourceId - The resource being acted upon (e.g., tenantId)
 * @param email - The email to send the verification code to
 * @param metadata - Optional metadata to store with the challenge
 * @returns Challenge details including whether MFA is required
 */
export async function createChallenge(
  userId: string,
  action: CriticalActionType,
  resourceId: string,
  email: string,
  metadata?: Record<string, unknown>
): Promise<CreateChallengeResult> {
  try {
    const redis = getRedis();
    const key = getChallengeKey(userId, action, resourceId);

    // Check if user has MFA enabled
    const requiresMfa = await userHasMfaEnabled(userId);

    // Generate verification code
    const emailCode = generateCode();

    // Calculate timestamps
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL * 1000);

    // Create challenge data
    const challengeData: ChallengeData = {
      userId,
      action,
      resourceId,
      emailCode,
      emailSentTo: email,
      requiresMfa,
      mfaVerified: false,
      emailVerified: false,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metadata,
    };

    // Store in Redis with TTL
    await redis.setex(key, CHALLENGE_TTL, JSON.stringify(challengeData));

    return {
      challengeId: key,
      expiresIn: CHALLENGE_TTL,
      emailSentTo: maskEmail(email),
      requiresMfa,
    };
  } catch (error) {
    console.error('[CriticalActionChallenge] Failed to create challenge:', error);
    return {
      challengeId: '',
      expiresIn: 0,
      emailSentTo: '',
      requiresMfa: false,
      error: 'Failed to create challenge',
    };
  }
}

/**
 * Get the raw email code for a challenge (used by email service)
 * This should only be called internally after createChallenge
 */
export async function getChallengeEmailCode(
  userId: string,
  action: CriticalActionType,
  resourceId: string
): Promise<string | null> {
  const redis = getRedis();
  const key = getChallengeKey(userId, action, resourceId);

  const dataStr = await redis.get(key);
  if (!dataStr) return null;

  try {
    const data: ChallengeData = JSON.parse(dataStr);
    return data.emailCode;
  } catch {
    return null;
  }
}

/**
 * Verify the email code for a challenge
 *
 * @param userId - The user verifying
 * @param action - The type of critical action
 * @param resourceId - The resource being acted upon
 * @param code - The code entered by the user
 * @returns Verification result
 */
export async function verifyEmailCode(
  userId: string,
  action: CriticalActionType,
  resourceId: string,
  code: string
): Promise<VerificationResult> {
  const redis = getRedis();
  const key = getChallengeKey(userId, action, resourceId);

  const dataStr = await redis.get(key);
  if (!dataStr) {
    return { verified: false, error: 'Challenge expired or not found' };
  }

  try {
    const data: ChallengeData = JSON.parse(dataStr);

    // Check if already verified
    if (data.emailVerified) {
      return { verified: true };
    }

    // Verify code
    if (data.emailCode !== code) {
      return { verified: false, error: 'Invalid code' };
    }

    // Update challenge with verified status
    data.emailVerified = true;

    // Calculate remaining TTL
    const remainingTtl = await redis.ttl(key);
    if (remainingTtl > 0) {
      await redis.setex(key, remainingTtl, JSON.stringify(data));
    }

    return { verified: true };
  } catch (error) {
    console.error('[CriticalActionChallenge] Failed to verify email code:', error);
    return { verified: false, error: 'Verification failed' };
  }
}

/**
 * Verify the MFA code for a challenge
 *
 * @param userId - The user verifying
 * @param action - The type of critical action
 * @param resourceId - The resource being acted upon
 * @param code - The MFA code entered by the user
 * @returns Verification result
 */
export async function verifyCriticalActionMfaCode(
  userId: string,
  action: CriticalActionType,
  resourceId: string,
  code: string
): Promise<VerificationResult> {
  const redis = getRedis();
  const key = getChallengeKey(userId, action, resourceId);

  const dataStr = await redis.get(key);
  if (!dataStr) {
    return { verified: false, error: 'Challenge expired or not found' };
  }

  try {
    const data: ChallengeData = JSON.parse(dataStr);

    // Check if MFA is required
    if (!data.requiresMfa) {
      return { verified: true };
    }

    // Check if already verified
    if (data.mfaVerified) {
      return { verified: true };
    }

    // Verify MFA code using the MFA service
    const mfaResult = await verifyMfaCode(userId, code);
    if (!mfaResult.verified) {
      return { verified: false, error: mfaResult.error || 'Invalid MFA code' };
    }

    // Update challenge with verified status
    data.mfaVerified = true;

    // Calculate remaining TTL
    const remainingTtl = await redis.ttl(key);
    if (remainingTtl > 0) {
      await redis.setex(key, remainingTtl, JSON.stringify(data));
    }

    return { verified: true };
  } catch (error) {
    console.error('[CriticalActionChallenge] Failed to verify MFA code:', error);
    return { verified: false, error: 'MFA verification failed' };
  }
}

/**
 * Get the current status of a challenge
 *
 * @param userId - The user
 * @param action - The type of critical action
 * @param resourceId - The resource being acted upon
 * @returns Challenge data or null if not found/expired
 */
export async function getChallengeStatus(
  userId: string,
  action: CriticalActionType,
  resourceId: string
): Promise<ChallengeData | null> {
  const redis = getRedis();
  const key = getChallengeKey(userId, action, resourceId);

  const dataStr = await redis.get(key);
  if (!dataStr) return null;

  try {
    return JSON.parse(dataStr) as ChallengeData;
  } catch {
    return null;
  }
}

/**
 * Consume (verify and delete) a challenge
 * This should be called after all verifications pass to proceed with the action.
 *
 * @param userId - The user
 * @param action - The type of critical action
 * @param resourceId - The resource being acted upon
 * @returns Challenge data if valid and consumed, null otherwise
 */
export async function consumeChallenge(
  userId: string,
  action: CriticalActionType,
  resourceId: string
): Promise<{ data: ChallengeData | null; error?: string }> {
  const redis = getRedis();
  const key = getChallengeKey(userId, action, resourceId);

  const dataStr = await redis.get(key);
  if (!dataStr) {
    return { data: null, error: 'challenge_expired' };
  }

  try {
    const data: ChallengeData = JSON.parse(dataStr);

    // Verify email code was verified
    if (!data.emailVerified) {
      return { data: null, error: 'email_code_required' };
    }

    // Verify MFA if required
    if (data.requiresMfa && !data.mfaVerified) {
      return { data: null, error: 'mfa_code_required' };
    }

    // Delete the challenge (consume it)
    await redis.del(key);

    return { data };
  } catch (error) {
    console.error('[CriticalActionChallenge] Failed to consume challenge:', error);
    return { data: null, error: 'challenge_invalid' };
  }
}

/**
 * Delete a challenge without consuming it
 *
 * @param userId - The user
 * @param action - The type of critical action
 * @param resourceId - The resource being acted upon
 */
export async function deleteChallenge(
  userId: string,
  action: CriticalActionType,
  resourceId: string
): Promise<void> {
  const redis = getRedis();
  const key = getChallengeKey(userId, action, resourceId);
  await redis.del(key);
}

/**
 * Check if a challenge is fully verified (both email and MFA if required)
 */
export async function isChallengeFullyVerified(
  userId: string,
  action: CriticalActionType,
  resourceId: string
): Promise<boolean> {
  const challenge = await getChallengeStatus(userId, action, resourceId);
  if (!challenge) return false;

  if (!challenge.emailVerified) return false;
  if (challenge.requiresMfa && !challenge.mfaVerified) return false;

  return true;
}

// Export service object for backwards compatibility
export const criticalActionChallengeService = {
  createChallenge,
  getChallengeEmailCode,
  verifyEmailCode,
  verifyCriticalActionMfaCode,
  getChallengeStatus,
  consumeChallenge,
  deleteChallenge,
  isChallengeFullyVerified,
};
