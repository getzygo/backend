/**
 * Login Alert Service
 *
 * Detects and alerts users about suspicious login activity:
 * - New device
 * - New location (>100km from previous logins)
 * - New browser
 *
 * Includes deduplication to prevent alert spam.
 */

import { eq, desc, and, isNull, gt } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '../db/client';
import { loginAlerts, userSessions, users, securityAlertLog } from '../db/schema';
import { parseUserAgent, createDeviceHash } from './device-fingerprint.service';
import { getLocationFromIP, isLocationSignificantlyDifferent, formatLocation } from './geolocation.service';
import { sendLoginAlertEmail } from './email.service';
import type { LoginAlert, NewLoginAlert } from '../db/schema/security';

// Alert cooldowns to prevent spam (in milliseconds)
const ALERT_COOLDOWNS = {
  login_alert: 5 * 60 * 1000, // 5 minutes
  suspicious_login: 15 * 60 * 1000, // 15 minutes
  default: 60 * 1000, // 1 minute
};

interface CheckLoginOptions {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface LoginCheckResult {
  isNewDevice: boolean;
  isNewLocation: boolean;
  isNewBrowser: boolean;
  isSuspicious: boolean;
  alerts: string[];
}

/**
 * Create a fingerprint for deduplication.
 * Uses device + IP prefix + browser to identify same login context.
 */
function createAlertFingerprint(
  userAgent?: string,
  ipAddress?: string
): string {
  const parsed = parseUserAgent(userAgent);

  // Extract IP prefix (first 3 octets for IPv4, or first segment for IPv6)
  let ipPrefix = 'unknown';
  if (ipAddress) {
    const parts = ipAddress.split('.');
    if (parts.length === 4) {
      ipPrefix = parts.slice(0, 3).join('.');
    } else {
      // IPv6 or other
      ipPrefix = ipAddress.split(':').slice(0, 4).join(':');
    }
  }

  const data = `${parsed.browser}|${parsed.os}|${ipPrefix}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Check if we should skip sending an alert (deduplication).
 */
async function shouldSkipAlert(
  userId: string,
  alertType: string,
  fingerprint: string
): Promise<boolean> {
  const db = getDb();
  const cooldownMs = ALERT_COOLDOWNS[alertType as keyof typeof ALERT_COOLDOWNS] || ALERT_COOLDOWNS.default;
  const cooldownMinutes = Math.ceil(cooldownMs / 60000);

  // Check for recent alert with same fingerprint
  const recentAlert = await db.query.securityAlertLog.findFirst({
    where: and(
      eq(securityAlertLog.userId, userId),
      eq(securityAlertLog.alertType, alertType),
      eq(securityAlertLog.fingerprint, fingerprint),
      gt(securityAlertLog.createdAt, new Date(Date.now() - cooldownMs))
    ),
  });

  return !!recentAlert;
}

/**
 * Log an alert for deduplication.
 */
async function logAlert(
  userId: string,
  alertType: string,
  fingerprint: string
): Promise<void> {
  const db = getDb();

  await db.insert(securityAlertLog).values({
    userId,
    alertType,
    fingerprint,
  });
}

/**
 * Check if a login is suspicious and create alerts if needed.
 */
export async function checkLoginForAlerts(options: CheckLoginOptions): Promise<LoginCheckResult> {
  const db = getDb();
  const { userId, ipAddress, userAgent } = options;

  const result: LoginCheckResult = {
    isNewDevice: false,
    isNewLocation: false,
    isNewBrowser: false,
    isSuspicious: false,
    alerts: [],
  };

  // Get user info
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user || !user.loginNotificationEnabled) {
    return result;
  }

  // Parse current login info
  const currentDevice = parseUserAgent(userAgent);
  const currentLocation = getLocationFromIP(ipAddress);
  const currentDeviceHash = createDeviceHash({
    userAgent,
    ipAddress,
  });

  // Get recent sessions to compare
  const recentSessions = await db.query.userSessions.findMany({
    where: and(
      eq(userSessions.userId, userId),
      isNull(userSessions.revokedAt)
    ),
    orderBy: desc(userSessions.createdAt),
    limit: 10,
  });

  // Check for new device
  const knownDeviceHashes = new Set<string>();
  recentSessions.forEach((session) => {
    const hash = createDeviceHash({
      userAgent: `${session.browser || ''} ${session.os || ''}`,
      ipAddress: session.ipAddress || undefined,
    });
    knownDeviceHashes.add(hash);
  });

  if (!knownDeviceHashes.has(currentDeviceHash) && recentSessions.length > 0) {
    result.isNewDevice = true;
    result.alerts.push('New device detected');
  }

  // Check for new location
  if (currentLocation && recentSessions.length > 0) {
    let foundSimilarLocation = false;

    for (const session of recentSessions) {
      if (session.locationCity || session.locationCountry) {
        const sessionLocation = {
          city: session.locationCity || undefined,
          country: session.locationCountry || undefined,
          countryCode: session.locationCountry || undefined,
        };

        if (!isLocationSignificantlyDifferent(currentLocation, sessionLocation)) {
          foundSimilarLocation = true;
          break;
        }
      }
    }

    if (!foundSimilarLocation) {
      result.isNewLocation = true;
      result.alerts.push(`New location: ${formatLocation(currentLocation)}`);
    }
  }

  // Check for new browser
  const knownBrowsers = new Set<string>();
  recentSessions.forEach((session) => {
    if (session.browser) {
      knownBrowsers.add(session.browser.toLowerCase());
    }
  });

  if (
    currentDevice.browser &&
    currentDevice.browser !== 'Unknown' &&
    !knownBrowsers.has(currentDevice.browser.toLowerCase()) &&
    knownBrowsers.size > 0
  ) {
    result.isNewBrowser = true;
    result.alerts.push(`New browser: ${currentDevice.browser}`);
  }

  // Determine if suspicious (multiple new factors)
  const suspiciousFactors = [result.isNewDevice, result.isNewLocation, result.isNewBrowser].filter(Boolean).length;
  result.isSuspicious = suspiciousFactors >= 2;

  // Create alerts if any
  if (result.alerts.length > 0) {
    const alertType = result.isSuspicious ? 'suspicious_login' : 'login_alert';
    const fingerprint = createAlertFingerprint(userAgent, ipAddress);

    // Check deduplication
    const shouldSkip = await shouldSkipAlert(userId, alertType, fingerprint);

    if (!shouldSkip) {
      // Log this alert for deduplication
      await logAlert(userId, alertType, fingerprint);

      // Create login alert records
      const alertTypes: string[] = [];
      if (result.isNewDevice) alertTypes.push('new_device');
      if (result.isNewLocation) alertTypes.push('new_location');
      if (result.isNewBrowser) alertTypes.push('new_browser');

      for (const type of alertTypes) {
        await db.insert(loginAlerts).values({
          userId,
          alertType: type,
          ipAddress: ipAddress || null,
          deviceInfo: {
            browser: currentDevice.browser,
            os: currentDevice.os,
            deviceType: currentDevice.deviceType,
            deviceName: currentDevice.deviceName,
          },
          location: currentLocation
            ? {
                city: currentLocation.city,
                country: currentLocation.country,
                countryCode: currentLocation.countryCode,
              }
            : {},
          isSuspicious: result.isSuspicious,
          emailSentAt: new Date(),
        });
      }

      // Send notification email
      await sendLoginAlertEmail(user.email, user.firstName || undefined, {
        alerts: result.alerts,
        device: currentDevice.deviceName,
        browser: currentDevice.browser,
        os: currentDevice.os,
        location: formatLocation(currentLocation),
        ipAddress,
        isSuspicious: result.isSuspicious,
      });
    }
  }

  return result;
}

/**
 * Get recent login alerts for a user.
 */
export async function getUserLoginAlerts(
  userId: string,
  limit: number = 20
): Promise<LoginAlert[]> {
  const db = getDb();

  const alerts = await db.query.loginAlerts.findMany({
    where: eq(loginAlerts.userId, userId),
    orderBy: desc(loginAlerts.createdAt),
    limit,
  });

  return alerts;
}

/**
 * Acknowledge a login alert.
 */
export async function acknowledgeAlert(alertId: string, userId: string): Promise<boolean> {
  const db = getDb();

  const alert = await db.query.loginAlerts.findFirst({
    where: and(
      eq(loginAlerts.id, alertId),
      eq(loginAlerts.userId, userId)
    ),
  });

  if (!alert) {
    return false;
  }

  await db
    .update(loginAlerts)
    .set({ acknowledgedAt: new Date() })
    .where(eq(loginAlerts.id, alertId));

  return true;
}

export default {
  checkLoginForAlerts,
  getUserLoginAlerts,
  acknowledgeAlert,
};
