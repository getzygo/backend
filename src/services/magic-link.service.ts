/**
 * Magic Link Service
 *
 * Handles passwordless email authentication via magic links.
 * Tokens are single-use and expire after a configurable period (default 15 minutes).
 */

import crypto from 'crypto';
import { eq, and, isNull, gt, lt } from 'drizzle-orm';
import { getDb } from '../db/client';
import { magicLinks, users, auditLogs } from '../db/schema';
import { sendMagicLinkEmail } from './email.service';
import type { MagicLink } from '../db/schema/security';

// Magic link expiration in minutes
const MAGIC_LINK_EXPIRY_MINUTES = 15;

// Magic link expiration for invite flows (24 hours)
const INVITE_MAGIC_LINK_EXPIRY_HOURS = 24;

// Base URL for magic link verification
const MAGIC_LINK_BASE_URL = process.env.MAGIC_LINK_BASE_URL || 'https://getzygo.com/magic-link/verify';

interface CreateMagicLinkOptions {
  email: string;
  redirectUrl?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface VerifyMagicLinkResult {
  success: boolean;
  email?: string;
  redirectUrl?: string;
  error?: string;
}

/**
 * Generate a secure random token.
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a token for secure storage.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create and send a magic link.
 */
export async function createMagicLink(options: CreateMagicLinkOptions): Promise<{
  success: boolean;
  expiresAt?: Date;
  error?: string;
}> {
  const db = getDb();
  const normalizedEmail = options.email.toLowerCase().trim();

  // Check if user exists
  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (!user) {
    // Don't reveal if user exists - return success but don't send email
    // This prevents email enumeration attacks
    return { success: true, expiresAt: new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000) };
  }

  // Check for rate limiting - no more than 3 magic links per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentLinks = await db.query.magicLinks.findMany({
    where: and(
      eq(magicLinks.email, normalizedEmail),
      gt(magicLinks.createdAt, oneHourAgo)
    ),
  });

  if (recentLinks.length >= 3) {
    return {
      success: false,
      error: 'too_many_requests',
    };
  }

  // Generate token
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);

  // Store magic link
  await db.insert(magicLinks).values({
    email: normalizedEmail,
    tokenHash,
    redirectUrl: options.redirectUrl,
    expiresAt,
  });

  // Build magic link URL
  const magicLinkUrl = `${MAGIC_LINK_BASE_URL}?token=${token}${
    options.redirectUrl ? `&redirect=${encodeURIComponent(options.redirectUrl)}` : ''
  }`;

  // Send email using the template
  try {
    const result = await sendMagicLinkEmail(
      normalizedEmail,
      user.firstName,
      magicLinkUrl,
      MAGIC_LINK_EXPIRY_MINUTES
    );

    if (!result.sent) {
      console.error('[MagicLink] Failed to send email:', result.error);
      return {
        success: false,
        error: 'email_failed',
      };
    }
  } catch (error) {
    console.error('[MagicLink] Failed to send email:', error);
    return {
      success: false,
      error: 'email_failed',
    };
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'magic_link_requested',
    resourceType: 'magic_link',
    details: { expires_at: expiresAt.toISOString() },
    ipAddress: options.ipAddress || undefined,
    userAgent: options.userAgent || undefined,
    status: 'success',
  });

  return { success: true, expiresAt };
}

/**
 * Verify a magic link token.
 */
export async function verifyMagicLink(
  token: string,
  ipAddress?: string,
  userAgent?: string
): Promise<VerifyMagicLinkResult> {
  const db = getDb();
  const tokenHash = hashToken(token);

  // Find the magic link
  const magicLink = await db.query.magicLinks.findFirst({
    where: and(
      eq(magicLinks.tokenHash, tokenHash),
      isNull(magicLinks.usedAt),
      gt(magicLinks.expiresAt, new Date())
    ),
  });

  if (!magicLink) {
    return {
      success: false,
      error: 'invalid_or_expired_token',
    };
  }

  // Mark as used
  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, magicLink.id));

  // Get user
  const user = await db.query.users.findFirst({
    where: eq(users.email, magicLink.email),
  });

  if (!user) {
    return {
      success: false,
      error: 'user_not_found',
    };
  }

  // Check user status
  if (user.status === 'suspended' || user.status === 'deleted') {
    return {
      success: false,
      error: 'account_disabled',
    };
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'magic_link_verified',
    resourceType: 'magic_link',
    resourceId: magicLink.id,
    details: {},
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return {
    success: true,
    email: magicLink.email,
    redirectUrl: magicLink.redirectUrl || undefined,
  };
}

/**
 * Create a magic link token for invite acceptance (existing users only).
 * - 24-hour TTL (enterprise-friendly)
 * - No email sending (invite service handles that)
 * - No rate limiting (invite creation/resend has its own limits)
 * - Returns the raw unhashed token for URL construction
 */
export async function createMagicLinkForInvite(email: string): Promise<{
  success: boolean;
  token?: string;
  expiresAt?: Date;
  error?: string;
}> {
  const db = getDb();
  const normalizedEmail = email.toLowerCase().trim();

  // Verify user exists (required for invite magic links)
  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (!user) {
    return { success: false, error: 'user_not_found' };
  }

  // Generate token
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

  // Store magic link
  await db.insert(magicLinks).values({
    email: normalizedEmail,
    tokenHash,
    expiresAt,
  });

  return { success: true, token, expiresAt };
}

/**
 * Clean up expired magic links (for scheduled cleanup).
 */
export async function cleanupExpiredMagicLinks(): Promise<number> {
  const db = getDb();
  const now = new Date();

  // Delete links that are expired or used more than 24 hours ago
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await db
    .delete(magicLinks)
    .where(
      lt(magicLinks.expiresAt, now)
    );

  return 0; // Drizzle doesn't easily return affected row count
}

export default {
  createMagicLink,
  createMagicLinkForInvite,
  verifyMagicLink,
  cleanupExpiredMagicLinks,
};
