/**
 * Trusted Device Service
 *
 * Manages device trust for MFA bypass.
 * Trusted devices can skip MFA verification for a configurable period (default 30 days).
 */

import { eq, and, gt, lt } from 'drizzle-orm';
import { getDb } from '../db/client';
import { trustedDevices, auditLogs } from '../db/schema';
import { createDeviceHash, parseUserAgent } from './device-fingerprint.service';
import type { TrustedDevice, NewTrustedDevice } from '../db/schema/security';

// Trust duration in days
const TRUST_DURATION_DAYS = 30;

interface TrustDeviceOptions {
  userId: string;
  userAgent?: string;
  acceptLanguage?: string;
  ipAddress?: string;
}

interface TrustedDeviceInfo {
  id: string;
  deviceName?: string | null;
  browser?: string | null;
  os?: string | null;
  trustedUntil: Date;
  createdAt: Date;
}

/**
 * Trust a device for MFA bypass.
 */
export async function trustDevice(options: TrustDeviceOptions): Promise<TrustedDevice> {
  const db = getDb();

  const deviceHash = createDeviceHash({
    userAgent: options.userAgent,
    acceptLanguage: options.acceptLanguage,
    ipAddress: options.ipAddress,
  });

  const parsed = parseUserAgent(options.userAgent);
  const trustedUntil = new Date();
  trustedUntil.setDate(trustedUntil.getDate() + TRUST_DURATION_DAYS);

  // Check if device is already trusted
  const existing = await db.query.trustedDevices.findFirst({
    where: and(
      eq(trustedDevices.userId, options.userId),
      eq(trustedDevices.deviceHash, deviceHash),
      gt(trustedDevices.trustedUntil, new Date())
    ),
  });

  if (existing) {
    // Update existing trust expiration
    const [updated] = await db
      .update(trustedDevices)
      .set({
        trustedUntil,
        ipAddress: options.ipAddress,
      })
      .where(eq(trustedDevices.id, existing.id))
      .returning();

    return updated;
  }

  // Create new trusted device
  const [device] = await db
    .insert(trustedDevices)
    .values({
      userId: options.userId,
      deviceHash,
      deviceName: parsed.deviceName,
      browser: parsed.browser,
      os: parsed.os,
      ipAddress: options.ipAddress,
      trustedUntil,
    })
    .returning();

  // Audit log
  await db.insert(auditLogs).values({
    userId: options.userId,
    action: 'device_trust',
    resourceType: 'trusted_device',
    resourceId: device.id,
    details: {
      device_name: parsed.deviceName,
      browser: parsed.browser,
      os: parsed.os,
      trusted_until: trustedUntil.toISOString(),
    },
    ipAddress: options.ipAddress || undefined,
    status: 'success',
  });

  return device;
}

/**
 * Check if a device is trusted for a user.
 */
export async function isDeviceTrusted(options: TrustDeviceOptions): Promise<boolean> {
  const db = getDb();

  const deviceHash = createDeviceHash({
    userAgent: options.userAgent,
    acceptLanguage: options.acceptLanguage,
    ipAddress: options.ipAddress,
  });

  const trusted = await db.query.trustedDevices.findFirst({
    where: and(
      eq(trustedDevices.userId, options.userId),
      eq(trustedDevices.deviceHash, deviceHash),
      gt(trustedDevices.trustedUntil, new Date())
    ),
  });

  return !!trusted;
}

/**
 * Get all trusted devices for a user.
 */
export async function getUserTrustedDevices(userId: string): Promise<TrustedDeviceInfo[]> {
  const db = getDb();

  const devices = await db.query.trustedDevices.findMany({
    where: and(
      eq(trustedDevices.userId, userId),
      gt(trustedDevices.trustedUntil, new Date())
    ),
    orderBy: (devices, { desc }) => [desc(devices.createdAt)],
  });

  return devices.map((device) => ({
    id: device.id,
    deviceName: device.deviceName,
    browser: device.browser,
    os: device.os,
    trustedUntil: device.trustedUntil,
    createdAt: device.createdAt,
  }));
}

/**
 * Remove device trust (untrust a device).
 */
export async function untrustDevice(
  deviceId: string,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<boolean> {
  const db = getDb();

  // Verify device belongs to user
  const device = await db.query.trustedDevices.findFirst({
    where: and(
      eq(trustedDevices.id, deviceId),
      eq(trustedDevices.userId, userId)
    ),
  });

  if (!device) {
    return false;
  }

  // Delete the trusted device
  await db
    .delete(trustedDevices)
    .where(eq(trustedDevices.id, deviceId));

  // Audit log
  await db.insert(auditLogs).values({
    userId,
    action: 'device_untrust',
    resourceType: 'trusted_device',
    resourceId: deviceId,
    details: {
      device_name: device.deviceName,
      browser: device.browser,
      os: device.os,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return true;
}

/**
 * Remove all trusted devices for a user.
 */
export async function untrustAllDevices(
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<number> {
  const db = getDb();

  // Get count of devices to remove
  const devices = await db.query.trustedDevices.findMany({
    where: eq(trustedDevices.userId, userId),
  });

  if (devices.length === 0) {
    return 0;
  }

  // Delete all trusted devices
  await db
    .delete(trustedDevices)
    .where(eq(trustedDevices.userId, userId));

  // Audit log
  await db.insert(auditLogs).values({
    userId,
    action: 'devices_untrust_all',
    resourceType: 'trusted_device',
    details: { count: devices.length },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return devices.length;
}

/**
 * Clean up expired trusted devices (for scheduled cleanup).
 */
export async function cleanupExpiredTrustedDevices(): Promise<number> {
  const db = getDb();
  const now = new Date();

  await db
    .delete(trustedDevices)
    .where(
      // Device has expired: trustedUntil < now
      lt(trustedDevices.trustedUntil, now)
    );

  return 0; // Drizzle doesn't easily return affected row count
}

export default {
  trustDevice,
  isDeviceTrusted,
  getUserTrustedDevices,
  untrustDevice,
  untrustAllDevices,
  cleanupExpiredTrustedDevices,
};
