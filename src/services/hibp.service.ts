/**
 * HIBP (Have I Been Pwned) Service
 *
 * Checks passwords against the HaveIBeenPwned database using k-anonymity.
 * Only the first 5 characters of the SHA1 hash are sent to the API.
 * The full hash is never transmitted, ensuring password privacy.
 */

import crypto from 'crypto';

const HIBP_API_URL = 'https://api.pwnedpasswords.com/range';
const HIBP_USER_AGENT = 'Zygo-Security-Service';

interface BreachCheckResult {
  breached: boolean;
  count: number; // Number of times the password has been seen in breaches
  error?: string;
}

/**
 * Check if a password has been exposed in known data breaches.
 * Uses HIBP k-anonymity API - only first 5 chars of SHA1 sent to API.
 *
 * @param password - The plaintext password to check
 * @returns Breach check result with count of exposures
 */
export async function checkPasswordBreach(password: string): Promise<BreachCheckResult> {
  try {
    // Generate SHA1 hash of the password
    const sha1Hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();

    // Split into prefix (first 5 chars) and suffix (rest)
    const prefix = sha1Hash.substring(0, 5);
    const suffix = sha1Hash.substring(5);

    // Query HIBP API with prefix only (k-anonymity)
    const response = await fetch(`${HIBP_API_URL}/${prefix}`, {
      headers: {
        'User-Agent': HIBP_USER_AGENT,
        'Add-Padding': 'true', // Request padding to prevent length-based attacks
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - return safe result (don't block user)
        console.warn('[HIBP] Rate limited by HIBP API');
        return { breached: false, count: 0, error: 'rate_limited' };
      }
      throw new Error(`HIBP API returned ${response.status}`);
    }

    const text = await response.text();

    // Parse response: each line is "SUFFIX:COUNT"
    // Find our suffix in the list
    const lines = text.split('\n');
    for (const line of lines) {
      const [hashSuffix, countStr] = line.split(':');
      if (hashSuffix && hashSuffix.trim().toUpperCase() === suffix) {
        const count = parseInt(countStr?.trim() || '0', 10);
        return { breached: count > 0, count };
      }
    }

    // Password not found in breach database
    return { breached: false, count: 0 };
  } catch (error) {
    console.error('[HIBP] Password breach check failed:', error);
    // On error, don't block the user - just log and return safe result
    return { breached: false, count: 0, error: 'check_failed' };
  }
}

/**
 * Get a human-readable message for breach check results.
 *
 * @param result - The breach check result
 * @returns A user-friendly message
 */
export function getBreachMessage(result: BreachCheckResult): string {
  if (result.error) {
    return 'Unable to check password security at this time.';
  }

  if (!result.breached) {
    return 'Password not found in known data breaches.';
  }

  if (result.count === 1) {
    return 'This password has appeared in a data breach. Please choose a different password.';
  }

  if (result.count < 10) {
    return `This password has appeared in ${result.count} data breaches. Please choose a different password.`;
  }

  if (result.count < 100) {
    return `This password has been exposed ${result.count} times in data breaches. Choose a more unique password.`;
  }

  if (result.count < 1000) {
    return `This password has been exposed ${result.count} times. It's a commonly compromised password.`;
  }

  return `This password has been exposed ${result.count.toLocaleString()} times in data breaches. Please choose a completely different password.`;
}

/**
 * Determines the severity level of a breach.
 *
 * @param count - Number of times the password was seen
 * @returns Severity level: 'none', 'low', 'medium', 'high', 'critical'
 */
export function getBreachSeverity(count: number): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  if (count === 0) return 'none';
  if (count < 10) return 'low';
  if (count < 100) return 'medium';
  if (count < 1000) return 'high';
  return 'critical';
}

export default {
  checkPasswordBreach,
  getBreachMessage,
  getBreachSeverity,
};
