/**
 * Device Fingerprint Service
 *
 * Creates privacy-conscious device fingerprints for trusted device tracking.
 * Only uses non-sensitive, browser-provided information.
 */

import crypto from 'crypto';

interface DeviceInfo {
  userAgent?: string;
  acceptLanguage?: string;
  ipAddress?: string;
}

interface ParsedDevice {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  deviceName: string;
}

/**
 * Parse user agent string to extract browser and OS info.
 */
export function parseUserAgent(userAgent?: string): ParsedDevice {
  if (!userAgent) {
    return {
      browser: 'Unknown',
      browserVersion: '',
      os: 'Unknown',
      osVersion: '',
      deviceType: 'unknown',
      deviceName: 'Unknown Device',
    };
  }

  let browser = 'Unknown';
  let browserVersion = '';
  let os = 'Unknown';
  let osVersion = '';
  let deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown' = 'desktop';

  // Detect browser
  if (userAgent.includes('Firefox/')) {
    browser = 'Firefox';
    browserVersion = userAgent.match(/Firefox\/([\d.]+)/)?.[1] || '';
  } else if (userAgent.includes('Edg/')) {
    browser = 'Edge';
    browserVersion = userAgent.match(/Edg\/([\d.]+)/)?.[1] || '';
  } else if (userAgent.includes('Chrome/') && !userAgent.includes('Chromium')) {
    browser = 'Chrome';
    browserVersion = userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '';
  } else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) {
    browser = 'Safari';
    browserVersion = userAgent.match(/Version\/([\d.]+)/)?.[1] || '';
  } else if (userAgent.includes('Opera') || userAgent.includes('OPR/')) {
    browser = 'Opera';
    browserVersion = userAgent.match(/(?:Opera|OPR)\/([\d.]+)/)?.[1] || '';
  }

  // Detect OS
  if (userAgent.includes('Windows NT 10')) {
    os = 'Windows';
    osVersion = '10/11';
  } else if (userAgent.includes('Windows NT 6.3')) {
    os = 'Windows';
    osVersion = '8.1';
  } else if (userAgent.includes('Windows NT 6.1')) {
    os = 'Windows';
    osVersion = '7';
  } else if (userAgent.includes('Mac OS X')) {
    os = 'macOS';
    osVersion = userAgent.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') || '';
  } else if (userAgent.includes('Linux')) {
    os = 'Linux';
  } else if (userAgent.includes('Android')) {
    os = 'Android';
    osVersion = userAgent.match(/Android ([\d.]+)/)?.[1] || '';
    deviceType = userAgent.includes('Mobile') ? 'mobile' : 'tablet';
  } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    os = 'iOS';
    osVersion = userAgent.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') || '';
    deviceType = userAgent.includes('iPad') ? 'tablet' : 'mobile';
  } else if (userAgent.includes('CrOS')) {
    os = 'Chrome OS';
  }

  // Generate device name
  const deviceName = `${browser} on ${os}${osVersion ? ' ' + osVersion : ''}`;

  return {
    browser,
    browserVersion,
    os,
    osVersion,
    deviceType,
    deviceName,
  };
}

/**
 * Extract IP network identifier for device fingerprinting.
 * Uses /16 for IPv4 (first 2 octets) and /48 for IPv6.
 * This provides location-aware security without being too strict.
 */
function extractIpNetwork(ipAddress?: string): string {
  if (!ipAddress) return 'unknown';

  // IPv4: use first 2 octets (e.g., "192.168" from "192.168.1.100")
  const ipv4Parts = ipAddress.split('.');
  if (ipv4Parts.length === 4) {
    return ipv4Parts.slice(0, 2).join('.');
  }

  // IPv6: use first 3 groups (/48 prefix)
  if (ipAddress.includes(':')) {
    const ipv6Parts = ipAddress.split(':');
    return ipv6Parts.slice(0, 3).join(':');
  }

  return 'unknown';
}

/**
 * Create a device hash for trusted device tracking.
 * SECURITY: Includes IP network to prevent MFA bypass from different locations.
 * Uses a combination of browser, OS, and IP network info.
 * This is privacy-conscious - doesn't use canvas/WebGL/etc.
 */
export function createDeviceHash(info: DeviceInfo): string {
  const parsed = parseUserAgent(info.userAgent);

  // Create a stable fingerprint from browser family + OS family + IP network
  // IP network (/16 for IPv4) provides location-aware security
  // Prevents MFA bypass from different networks even with spoofed User-Agent
  const components = [
    parsed.browser,
    parsed.os,
    parsed.deviceType,
    // Include language for additional uniqueness
    info.acceptLanguage?.split(',')[0] || 'unknown',
    // SECURITY: Include IP network to require re-MFA when location changes
    extractIpNetwork(info.ipAddress),
  ];

  const data = components.join('|');
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Create a more specific device hash that includes IP subnet.
 * Used for login alerts where we want to detect location changes.
 */
export function createDeviceLocationHash(info: DeviceInfo): string {
  const parsed = parseUserAgent(info.userAgent);

  // Extract IP subnet (first 3 octets for IPv4)
  let ipSubnet = 'unknown';
  if (info.ipAddress) {
    const parts = info.ipAddress.split('.');
    if (parts.length === 4) {
      ipSubnet = parts.slice(0, 3).join('.');
    } else {
      // IPv6 or other - use first half
      ipSubnet = info.ipAddress.substring(0, Math.floor(info.ipAddress.length / 2));
    }
  }

  const components = [
    parsed.browser,
    parsed.os,
    parsed.deviceType,
    ipSubnet,
  ];

  const data = components.join('|');
  return crypto.createHash('sha256').update(data).digest('hex');
}

export default {
  parseUserAgent,
  createDeviceHash,
  createDeviceLocationHash,
};
