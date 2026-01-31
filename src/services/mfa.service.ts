/**
 * MFA (Multi-Factor Authentication) Service
 *
 * Handles TOTP (Time-based One-Time Password) setup and verification.
 * Per UNIFIED_AUTH_STRATEGY.md Section 3.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { getRedis, REDIS_KEYS, REDIS_TTL } from '../db/redis';
import { users } from '../db/schema';
import { getEnv } from '../config/env';
import * as crypto from 'crypto';

// TOTP configuration
const TOTP_CONFIG = {
  issuer: 'Zygo',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
};

/**
 * Generate a random base32 secret for TOTP
 */
function generateSecret(): string {
  const buffer = crypto.randomBytes(20);
  return base32Encode(buffer);
}

/**
 * Base32 encode a buffer
 */
function base32Encode(buffer: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0;
  let value = 0;

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >> bits) & 31];
    }
  }

  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }

  return result;
}

/**
 * Base32 decode a string to buffer
 */
function base32Decode(encoded: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of encoded.toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate TOTP code
 */
function generateTotp(secret: string, timestamp?: number): string {
  const time = timestamp ?? Date.now();
  const counter = Math.floor(time / 1000 / TOTP_CONFIG.period);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));

  const secretBuffer = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', secretBuffer);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0xf;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, TOTP_CONFIG.digits);
  return otp.toString().padStart(TOTP_CONFIG.digits, '0');
}

/**
 * Verify TOTP code with time window
 */
function verifyTotpCode(secret: string, code: string, window: number = 1): boolean {
  const now = Date.now();

  for (let i = -window; i <= window; i++) {
    const timestamp = now + i * TOTP_CONFIG.period * 1000;
    const expectedCode = generateTotp(secret, timestamp);
    if (expectedCode === code) {
      return true;
    }
  }

  return false;
}

/**
 * Generate otpauth URL for QR code
 */
function generateOtpauthUrl(secret: string, email: string): string {
  const params = new URLSearchParams({
    secret,
    issuer: TOTP_CONFIG.issuer,
    algorithm: TOTP_CONFIG.algorithm,
    digits: TOTP_CONFIG.digits.toString(),
    period: TOTP_CONFIG.period.toString(),
  });

  return `otpauth://totp/${encodeURIComponent(TOTP_CONFIG.issuer)}:${encodeURIComponent(email)}?${params.toString()}`;
}

/**
 * Generate backup codes
 */
function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }

  return codes;
}

/**
 * Hash backup codes for storage
 */
async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return codes.map((code) => {
    const hash = crypto.createHash('sha256').update(code.replace('-', '')).digest('hex');
    return hash;
  });
}

/**
 * Encrypt secret for database storage
 */
function encryptSecret(secret: string): string {
  const env = getEnv();
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt secret from database
 */
function decryptSecret(encryptedData: string): string {
  const env = getEnv();
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');

  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Start MFA setup - generate secret and store temporarily
 */
export async function setupMfa(
  userId: string,
  email: string
): Promise<{
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
  error?: string;
}> {
  try {
    const secret = generateSecret();
    const otpauthUrl = generateOtpauthUrl(secret, email);
    const backupCodes = generateBackupCodes();

    // Store setup data temporarily in Redis
    const redis = getRedis();
    const key = `${REDIS_KEYS.MFA_SETUP}${userId}`;
    const setupData = JSON.stringify({
      secret,
      backupCodes,
      hashedBackupCodes: await hashBackupCodes(backupCodes),
    });

    await redis.setex(key, REDIS_TTL.MFA_SETUP, setupData);

    // Generate QR code as data URL
    let qrCodeDataUrl = '';
    try {
      const QRCode = await import('qrcode');
      qrCodeDataUrl = await QRCode.default.toDataURL(otpauthUrl);
    } catch {
      // QRCode not installed, return URL instead
      qrCodeDataUrl = otpauthUrl;
    }

    return {
      secret,
      qrCodeUrl: qrCodeDataUrl,
      backupCodes,
    };
  } catch (error) {
    console.error('Failed to setup MFA:', error);
    return {
      secret: '',
      qrCodeUrl: '',
      backupCodes: [],
      error: error instanceof Error ? error.message : 'Failed to setup MFA',
    };
  }
}

/**
 * Enable MFA - verify first code and save secret
 */
export async function enableMfa(
  userId: string,
  code: string
): Promise<{ enabled: boolean; error?: string }> {
  const redis = getRedis();
  const key = `${REDIS_KEYS.MFA_SETUP}${userId}`;

  const setupDataStr = await redis.get(key);
  if (!setupDataStr) {
    return { enabled: false, error: 'MFA setup expired. Please start again.' };
  }

  const setupData = JSON.parse(setupDataStr);

  // Verify the TOTP code
  if (!verifyTotpCode(setupData.secret, code)) {
    return { enabled: false, error: 'Invalid verification code' };
  }

  // Save encrypted secret and hashed backup codes to database
  const db = getDb();
  const encryptedSecret = encryptSecret(setupData.secret);

  await db
    .update(users)
    .set({
      mfaEnabled: true,
      mfaSecret: encryptedSecret,
      mfaBackupCodes: setupData.hashedBackupCodes,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  // Delete setup data from Redis
  await redis.del(key);

  return { enabled: true };
}

/**
 * Verify TOTP code for an existing MFA-enabled user
 */
export async function verifyMfaCode(
  userId: string,
  code: string
): Promise<{ verified: boolean; error?: string }> {
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      mfaEnabled: true,
      mfaSecret: true,
      mfaBackupCodes: true,
    },
  });

  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    return { verified: false, error: 'MFA not enabled for this user' };
  }

  const secret = decryptSecret(user.mfaSecret);

  // Try TOTP verification first
  if (verifyTotpCode(secret, code)) {
    return { verified: true };
  }

  // Try backup code verification
  const backupCodes = user.mfaBackupCodes as string[] | null;
  if (backupCodes && Array.isArray(backupCodes)) {
    const codeHash = crypto
      .createHash('sha256')
      .update(code.replace('-', ''))
      .digest('hex');

    const codeIndex = backupCodes.indexOf(codeHash);
    if (codeIndex !== -1) {
      // Remove used backup code
      const updatedCodes = [...backupCodes];
      updatedCodes.splice(codeIndex, 1);

      await db
        .update(users)
        .set({
          mfaBackupCodes: updatedCodes,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { verified: true };
    }
  }

  return { verified: false, error: 'Invalid verification code' };
}

/**
 * Disable MFA for a user
 */
export async function disableMfa(
  userId: string,
  code: string
): Promise<{ disabled: boolean; error?: string }> {
  // Verify the code first
  const verification = await verifyMfaCode(userId, code);
  if (!verification.verified) {
    return { disabled: false, error: verification.error || 'Invalid code' };
  }

  const db = getDb();

  await db
    .update(users)
    .set({
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { disabled: true };
}

/**
 * Regenerate backup codes
 */
export async function regenerateBackupCodes(
  userId: string,
  code: string
): Promise<{ codes: string[]; error?: string }> {
  // Verify the code first
  const verification = await verifyMfaCode(userId, code);
  if (!verification.verified) {
    return { codes: [], error: verification.error || 'Invalid code' };
  }

  const newCodes = generateBackupCodes();
  const hashedCodes = await hashBackupCodes(newCodes);

  const db = getDb();

  await db
    .update(users)
    .set({
      mfaBackupCodes: hashedCodes,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { codes: newCodes };
}

export const mfaService = {
  setupMfa,
  enableMfa,
  verifyMfaCode,
  disableMfa,
  regenerateBackupCodes,
};
