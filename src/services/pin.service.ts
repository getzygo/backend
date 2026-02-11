/**
 * PIN Service
 *
 * Handles PIN setup, verification, change, and removal for idle lock.
 * Follows mfa.service.ts patterns.
 */

import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { getDb } from '../db/client';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';
import { users } from '../db/schema';
import { verifyPassword } from './user.service';

/**
 * Argon2id config for PIN hashing (same as password hashing)
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

/**
 * Set up a new PIN
 * Requires current password verification first.
 */
export async function setupPin(
  userId: string,
  pin: string,
  currentPassword: string
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      passwordHash: true,
      pinEnabled: true,
    },
  });

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (user.pinEnabled) {
    return { success: false, error: 'PIN is already set up. Remove it first to set a new one.' };
  }

  // Verify current password
  const passwordValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!passwordValid) {
    return { success: false, error: 'Incorrect password' };
  }

  // Validate PIN format
  if (pin.length !== 4 && pin.length !== 6) {
    return { success: false, error: 'PIN must be 4 or 6 digits' };
  }
  if (!/^\d+$/.test(pin)) {
    return { success: false, error: 'PIN must contain only digits' };
  }

  // Hash and store PIN
  const pinHash = await argon2.hash(pin, ARGON2_OPTIONS);

  await db
    .update(users)
    .set({
      pinHash,
      pinEnabled: true,
      pinLength: pin.length,
      pinChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { success: true };
}

/**
 * Verify PIN for idle lock unlock.
 * Tracks failed attempts in Redis.
 */
export async function verifyPin(
  userId: string,
  sessionId: string,
  pin: string,
  maxAttempts: number = 5
): Promise<{
  verified: boolean;
  attemptsRemaining: number | null;
  lockedOut: boolean;
  error?: string;
}> {
  const db = getDb();
  const redis = getRedis();
  const attemptsKey = `${REDIS_KEYS.PIN_ATTEMPTS}${userId}:${sessionId}`;

  // Check current attempt count
  const currentAttempts = parseInt((await redis.get(attemptsKey)) || '0', 10);

  if (currentAttempts >= maxAttempts) {
    return {
      verified: false,
      attemptsRemaining: 0,
      lockedOut: true,
      error: 'Too many failed attempts. Please use your password instead.',
    };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      pinHash: true,
      pinEnabled: true,
    },
  });

  if (!user || !user.pinEnabled || !user.pinHash) {
    return {
      verified: false,
      attemptsRemaining: null,
      lockedOut: false,
      error: 'PIN not set up',
    };
  }

  // Verify PIN
  const isValid = await argon2.verify(user.pinHash, pin);

  if (isValid) {
    // Clear attempts on success
    await redis.del(attemptsKey);
    return {
      verified: true,
      attemptsRemaining: null,
      lockedOut: false,
    };
  }

  // Failed attempt — increment counter
  const newCount = currentAttempts + 1;
  await redis.setex(attemptsKey, REDIS_TTL.PIN_ATTEMPTS, String(newCount));

  const remaining = maxAttempts - newCount;

  return {
    verified: false,
    attemptsRemaining: remaining,
    lockedOut: remaining <= 0,
    error: remaining <= 0
      ? 'Too many failed attempts. Please use your password instead.'
      : 'Incorrect PIN',
  };
}

/**
 * Change PIN (requires current PIN verification)
 */
export async function changePin(
  userId: string,
  currentPin: string,
  newPin: string
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      pinHash: true,
      pinEnabled: true,
    },
  });

  if (!user || !user.pinEnabled || !user.pinHash) {
    return { success: false, error: 'PIN not set up' };
  }

  // Verify current PIN
  const isValid = await argon2.verify(user.pinHash, currentPin);
  if (!isValid) {
    return { success: false, error: 'Incorrect current PIN' };
  }

  // Validate new PIN format
  if (newPin.length !== 4 && newPin.length !== 6) {
    return { success: false, error: 'PIN must be 4 or 6 digits' };
  }
  if (!/^\d+$/.test(newPin)) {
    return { success: false, error: 'PIN must contain only digits' };
  }

  // Hash and store new PIN
  const pinHash = await argon2.hash(newPin, ARGON2_OPTIONS);

  await db
    .update(users)
    .set({
      pinHash,
      pinLength: newPin.length,
      pinChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { success: true };
}

/**
 * Remove PIN (requires password verification)
 */
export async function removePin(
  userId: string,
  currentPassword: string
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      passwordHash: true,
      pinEnabled: true,
    },
  });

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (!user.pinEnabled) {
    return { success: false, error: 'PIN is not set up' };
  }

  // Verify password
  const passwordValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!passwordValid) {
    return { success: false, error: 'Incorrect password' };
  }

  await db
    .update(users)
    .set({
      pinHash: null,
      pinEnabled: false,
      pinLength: null,
      pinChangedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { success: true };
}

/**
 * Get PIN status for a user
 */
export async function getPinStatus(
  userId: string
): Promise<{ enabled: boolean; length: number | null }> {
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      pinEnabled: true,
      pinLength: true,
    },
  });

  if (!user) {
    return { enabled: false, length: null };
  }

  return {
    enabled: user.pinEnabled,
    length: user.pinLength,
  };
}

/**
 * Clear PIN attempts (called after successful password unlock)
 */
export async function clearPinAttempts(
  userId: string,
  sessionId: string
): Promise<void> {
  const redis = getRedis();
  const attemptsKey = `${REDIS_KEYS.PIN_ATTEMPTS}${userId}:${sessionId}`;
  await redis.del(attemptsKey);
}

export const pinService = {
  setupPin,
  verifyPin,
  changePin,
  removePin,
  getPinStatus,
  clearPinAttempts,
};
