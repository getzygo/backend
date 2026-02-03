/**
 * Geolocation Service
 *
 * Provides IP-based geolocation using geoip-lite.
 * Falls back gracefully when location cannot be determined.
 */

import geoip from 'geoip-lite';

interface GeoLocation {
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

/**
 * Get geolocation data from an IP address.
 */
export function getLocationFromIP(ipAddress?: string | null): GeoLocation | null {
  if (!ipAddress) {
    return null;
  }

  // Handle localhost/private IPs
  if (
    ipAddress === '127.0.0.1' ||
    ipAddress === '::1' ||
    ipAddress.startsWith('192.168.') ||
    ipAddress.startsWith('10.') ||
    ipAddress.startsWith('172.')
  ) {
    return null;
  }

  // Handle IPv6 mapped IPv4
  let cleanIP = ipAddress;
  if (ipAddress.startsWith('::ffff:')) {
    cleanIP = ipAddress.substring(7);
  }

  // Handle X-Forwarded-For (may contain multiple IPs)
  if (cleanIP.includes(',')) {
    cleanIP = cleanIP.split(',')[0].trim();
  }

  try {
    const geo = geoip.lookup(cleanIP);

    if (!geo) {
      return null;
    }

    return {
      city: geo.city || undefined,
      region: geo.region || undefined,
      country: geo.country ? getCountryName(geo.country) : undefined,
      countryCode: geo.country || undefined,
      latitude: geo.ll?.[0],
      longitude: geo.ll?.[1],
      timezone: geo.timezone || undefined,
    };
  } catch (error) {
    console.error('[Geolocation] Failed to lookup IP:', error);
    return null;
  }
}

/**
 * Calculate distance between two coordinates in kilometers.
 * Uses Haversine formula.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Check if two locations are significantly different (>100km apart).
 */
export function isLocationSignificantlyDifferent(
  location1: GeoLocation | null,
  location2: GeoLocation | null
): boolean {
  // If either location is unknown, consider them different
  if (!location1 || !location2) {
    return true;
  }

  // If countries are different, definitely different
  if (location1.countryCode !== location2.countryCode) {
    return true;
  }

  // If we have coordinates, check distance
  if (
    location1.latitude !== undefined &&
    location1.longitude !== undefined &&
    location2.latitude !== undefined &&
    location2.longitude !== undefined
  ) {
    const distance = calculateDistance(
      location1.latitude,
      location1.longitude,
      location2.latitude,
      location2.longitude
    );
    return distance > 100; // More than 100km apart
  }

  // If cities are different but same country, consider different
  if (location1.city && location2.city && location1.city !== location2.city) {
    return true;
  }

  return false;
}

/**
 * Format a location for display.
 */
export function formatLocation(location: GeoLocation | null): string {
  if (!location) {
    return 'Unknown location';
  }

  const parts: string[] = [];

  if (location.city) {
    parts.push(location.city);
  }

  if (location.region && location.region !== location.city) {
    parts.push(location.region);
  }

  if (location.country) {
    parts.push(location.country);
  }

  return parts.length > 0 ? parts.join(', ') : 'Unknown location';
}

/**
 * Convert ISO country code to country name.
 */
function getCountryName(code: string): string {
  const countries: Record<string, string> = {
    US: 'United States',
    GB: 'United Kingdom',
    CA: 'Canada',
    AU: 'Australia',
    DE: 'Germany',
    FR: 'France',
    JP: 'Japan',
    CN: 'China',
    IN: 'India',
    BR: 'Brazil',
    MX: 'Mexico',
    ES: 'Spain',
    IT: 'Italy',
    NL: 'Netherlands',
    SE: 'Sweden',
    NO: 'Norway',
    DK: 'Denmark',
    FI: 'Finland',
    PL: 'Poland',
    RU: 'Russia',
    KR: 'South Korea',
    SG: 'Singapore',
    HK: 'Hong Kong',
    NZ: 'New Zealand',
    IE: 'Ireland',
    CH: 'Switzerland',
    AT: 'Austria',
    BE: 'Belgium',
    PT: 'Portugal',
    CZ: 'Czech Republic',
    // Add more as needed
  };

  return countries[code] || code;
}

export default {
  getLocationFromIP,
  calculateDistance,
  isLocationSignificantlyDifferent,
  formatLocation,
};
