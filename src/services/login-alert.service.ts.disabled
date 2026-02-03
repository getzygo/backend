/**
 * Login Alert Service
 *
 * Detects and alerts users about suspicious login activity:
 * - New device
 * - New location (>100km from previous logins)
 * - New browser
 */

import { eq, desc, and, isNull, gt } from 'drizzle-orm';
import { getDb } from '../db/client';
import { loginAlerts, userSessions, users, auditLogs } from '../db/schema';
import { parseUserAgent, createDeviceHash } from './device-fingerprint.service';
import { getLocationFromIP, isLocationSignificantlyDifferent, formatLocation } from './geolocation.service';
import { sendEmail } from './email.service';
import type { LoginAlert, NewLoginAlert } from '../db/schema/security';

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
    const alertTypes: string[] = [];
    if (result.isNewDevice) alertTypes.push('new_device');
    if (result.isNewLocation) alertTypes.push('new_location');
    if (result.isNewBrowser) alertTypes.push('new_browser');

    for (const alertType of alertTypes) {
      await db.insert(loginAlerts).values({
        userId,
        alertType,
        ipAddress: ipAddress || null,
        deviceInfo: {
          browser: currentDevice.browser,
          os: currentDevice.os,
          deviceType: currentDevice.deviceType,
          deviceName: currentDevice.deviceName,
        },
        location: currentLocation || {},
        isSuspicious: result.isSuspicious,
      });
    }

    // Send notification email
    await sendLoginAlertEmail(user.email, user.firstName || 'User', {
      alerts: result.alerts,
      isSuspicious: result.isSuspicious,
      device: currentDevice,
      location: currentLocation,
      ipAddress,
      timestamp: new Date(),
    });
  }

  return result;
}

/**
 * Send a login alert email.
 */
async function sendLoginAlertEmail(
  email: string,
  userName: string,
  details: {
    alerts: string[];
    isSuspicious: boolean;
    device: ReturnType<typeof parseUserAgent>;
    location: ReturnType<typeof getLocationFromIP>;
    ipAddress?: string;
    timestamp: Date;
  }
): Promise<void> {
  const locationStr = formatLocation(details.location);
  const timeStr = details.timestamp.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const subject = details.isSuspicious
    ? '⚠️ Suspicious login to your Zygo account'
    : 'New login to your Zygo account';

  const alertBgColor = details.isSuspicious ? '#fef2f2' : '#fffbeb';
  const alertBorderColor = details.isSuspicious ? '#ef4444' : '#f59e0b';

  try {
    await sendEmail({
      to: email,
      subject,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a2e; font-size: 24px; margin-bottom: 24px;">
            ${details.isSuspicious ? '⚠️ ' : ''}New Sign-in Detected
          </h1>

          <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5; margin-bottom: 16px;">
            Hi ${userName},
          </p>

          <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">
            We detected a new sign-in to your Zygo account:
          </p>

          <div style="background: ${alertBgColor}; border-left: 4px solid ${alertBorderColor}; padding: 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
            <ul style="margin: 0; padding-left: 20px; color: #4a4a4a;">
              ${details.alerts.map((alert) => `<li style="margin-bottom: 8px;">${alert}</li>`).join('')}
            </ul>
          </div>

          <div style="background: #f8f9fb; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #888; font-size: 14px;">Device:</td>
                <td style="padding: 8px 0; color: #1a1a2e; font-size: 14px; text-align: right;">${details.device.deviceName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #888; font-size: 14px;">Location:</td>
                <td style="padding: 8px 0; color: #1a1a2e; font-size: 14px; text-align: right;">${locationStr}</td>
              </tr>
              ${details.ipAddress ? `
              <tr>
                <td style="padding: 8px 0; color: #888; font-size: 14px;">IP Address:</td>
                <td style="padding: 8px 0; color: #1a1a2e; font-size: 14px; text-align: right;">${details.ipAddress}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; color: #888; font-size: 14px;">Time:</td>
                <td style="padding: 8px 0; color: #1a1a2e; font-size: 14px; text-align: right;">${timeStr}</td>
              </tr>
            </table>
          </div>

          <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">
            If this was you, you can ignore this email. If you don't recognize this activity,
            we recommend you secure your account immediately:
          </p>

          <a href="https://app.zygo.tech/profile?tab=security"
             style="display: inline-block; background: ${details.isSuspicious ? '#ef4444' : '#6366f1'}; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 16px;">
            Review Security Settings
          </a>

          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

          <p style="color: #888; font-size: 12px; line-height: 1.5;">
            You're receiving this email because login notifications are enabled for your account.
            You can manage notification preferences in your security settings.
          </p>
        </div>
      `,
      text: `New Sign-in Detected

Hi ${userName},

We detected a new sign-in to your Zygo account:

${details.alerts.map((alert) => `• ${alert}`).join('\n')}

Device: ${details.device.deviceName}
Location: ${locationStr}
${details.ipAddress ? `IP Address: ${details.ipAddress}\n` : ''}Time: ${timeStr}

If this was you, you can ignore this email. If you don't recognize this activity, we recommend you secure your account immediately.

Review Security Settings: https://app.zygo.tech/profile?tab=security
`,
    });
  } catch (error) {
    console.error('[LoginAlert] Failed to send email:', error);
  }
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
