/**
 * Tenant Verification Service
 *
 * Handles email and phone verification for tenant settings fields:
 * - Billing email
 * - Billing phone
 * - Company phone
 * - Contact emails and phones
 */

import { randomInt } from 'crypto';
import { getRedis, REDIS_TTL } from '../db/redis';
import { logger } from '../utils/logger';
import { sendTenantVerificationEmail } from './email.service';
import { sendVerificationSms, isValidE164 } from './sms.service';

// Redis key prefixes for tenant verification
const TENANT_EMAIL_CODE_PREFIX = 'tenant_email_code:';
const TENANT_PHONE_CODE_PREFIX = 'tenant_phone_code:';

// TTL values
const EMAIL_CODE_TTL = 15 * 60; // 15 minutes
const PHONE_CODE_TTL = 10 * 60; // 10 minutes

// Field type for display names
type TenantEmailField = 'billing_email' | 'contact_email';
type TenantPhoneField = 'billing_phone' | 'company_phone' | 'contact_phone';

const fieldDisplayNames: Record<TenantEmailField | TenantPhoneField, string> = {
  billing_email: 'billing email',
  contact_email: 'contact email',
  billing_phone: 'billing phone',
  company_phone: 'company phone',
  contact_phone: 'contact phone',
};

/**
 * Generate a cryptographically secure 6-digit verification code
 */
function generateCode(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * Store email verification code in Redis
 */
async function storeEmailCode(tenantId: string, field: string, email: string, code: string): Promise<void> {
  const redis = getRedis();
  const key = `${TENANT_EMAIL_CODE_PREFIX}${tenantId}:${field}:${email.toLowerCase()}`;
  await redis.setex(key, EMAIL_CODE_TTL, code);
}

/**
 * Get stored email verification code from Redis
 */
async function getStoredEmailCode(tenantId: string, field: string, email: string): Promise<string | null> {
  const redis = getRedis();
  const key = `${TENANT_EMAIL_CODE_PREFIX}${tenantId}:${field}:${email.toLowerCase()}`;
  return redis.get(key);
}

/**
 * Delete email verification code from Redis
 */
async function deleteEmailCode(tenantId: string, field: string, email: string): Promise<void> {
  const redis = getRedis();
  const key = `${TENANT_EMAIL_CODE_PREFIX}${tenantId}:${field}:${email.toLowerCase()}`;
  await redis.del(key);
}

/**
 * Store phone verification code in Redis
 */
async function storePhoneCode(tenantId: string, field: string, phone: string, code: string): Promise<void> {
  const redis = getRedis();
  const normalizedPhone = phone.replace(/[\s-]/g, '');
  const key = `${TENANT_PHONE_CODE_PREFIX}${tenantId}:${field}:${normalizedPhone}`;
  await redis.setex(key, PHONE_CODE_TTL, code);
}

/**
 * Get stored phone verification code from Redis
 */
async function getStoredPhoneCode(tenantId: string, field: string, phone: string): Promise<string | null> {
  const redis = getRedis();
  const normalizedPhone = phone.replace(/[\s-]/g, '');
  const key = `${TENANT_PHONE_CODE_PREFIX}${tenantId}:${field}:${normalizedPhone}`;
  return redis.get(key);
}

/**
 * Delete phone verification code from Redis
 */
async function deletePhoneCode(tenantId: string, field: string, phone: string): Promise<void> {
  const redis = getRedis();
  const normalizedPhone = phone.replace(/[\s-]/g, '');
  const key = `${TENANT_PHONE_CODE_PREFIX}${tenantId}:${field}:${normalizedPhone}`;
  await redis.del(key);
}

/**
 * Send email verification for a tenant field
 */
export async function sendTenantEmailVerification(
  tenantId: string,
  field: TenantEmailField,
  email: string,
  tenantName?: string
): Promise<{ sent: boolean; expiresIn: number; error?: string }> {
  if (!email) {
    return { sent: false, expiresIn: 0, error: 'Email is required' };
  }

  // Check for existing active code
  const existingCode = await getStoredEmailCode(tenantId, field, email);
  if (existingCode) {
    const redis = getRedis();
    const key = `${TENANT_EMAIL_CODE_PREFIX}${tenantId}:${field}:${email.toLowerCase()}`;
    const ttl = await redis.ttl(key);
    if (ttl > EMAIL_CODE_TTL - 60) {
      // Code was created less than 1 minute ago
      return {
        sent: false,
        expiresIn: ttl,
        error: 'A verification code was recently sent. Please wait before requesting a new one.',
      };
    }
  }

  const code = generateCode();
  await storeEmailCode(tenantId, field, email, code);

  const fieldName = fieldDisplayNames[field];
  const result = await sendTenantVerificationEmail(email, {
    code,
    tenantName,
    fieldName,
    expiresInMinutes: Math.floor(EMAIL_CODE_TTL / 60),
  });

  if (!result.sent) {
    await deleteEmailCode(tenantId, field, email);
    return { sent: false, expiresIn: 0, error: result.error };
  }

  return { sent: true, expiresIn: EMAIL_CODE_TTL };
}

/**
 * Verify email code for a tenant field
 */
export async function verifyTenantEmailCode(
  tenantId: string,
  field: TenantEmailField,
  email: string,
  code: string
): Promise<{ verified: boolean; error?: string }> {
  const storedCode = await getStoredEmailCode(tenantId, field, email);

  if (!storedCode) {
    return { verified: false, error: 'Code expired or not found' };
  }

  if (storedCode !== code) {
    return { verified: false, error: 'Invalid code' };
  }

  await deleteEmailCode(tenantId, field, email);
  return { verified: true };
}

// Country dial codes map (same as verify-phone.routes.ts)
const countryDialCodes: Record<string, string> = {
  US: "+1", CA: "+1", MX: "+52", GB: "+44", DE: "+49", FR: "+33", ES: "+34",
  IT: "+39", NL: "+31", BE: "+32", CH: "+41", AT: "+43", SE: "+46", NO: "+47",
  DK: "+45", FI: "+358", IE: "+353", PT: "+351", GR: "+30", PL: "+48", CZ: "+420",
  HU: "+36", RO: "+40", AU: "+61", NZ: "+64", JP: "+81", CN: "+86", IN: "+91",
  KR: "+82", SG: "+65", MY: "+60", TH: "+66", ID: "+62", PH: "+63", VN: "+84",
  HK: "+852", TW: "+886", PK: "+92", BD: "+880", LK: "+94", AE: "+971", SA: "+966",
  IL: "+972", TR: "+90", EG: "+20", QA: "+974", KW: "+965", BH: "+973", OM: "+968",
  JO: "+962", LB: "+961", BR: "+55", AR: "+54", CL: "+56", CO: "+57", PE: "+51",
  VE: "+58", EC: "+593", UY: "+598", ZA: "+27", NG: "+234", KE: "+254", GH: "+233",
  MA: "+212", TN: "+216", ET: "+251", UG: "+256", RU: "+7", UA: "+380", BY: "+375",
  KZ: "+7", CR: "+506", PA: "+507", GT: "+502", JM: "+1876", TT: "+1868",
  HR: "+385", SI: "+386", SK: "+421", BG: "+359", LT: "+370", LV: "+371",
  EE: "+372", IS: "+354", LU: "+352", MT: "+356", CY: "+357", NP: "+977",
  MM: "+95", KH: "+855", LA: "+856", MN: "+976", BN: "+673", MV: "+960",
  AF: "+93", IQ: "+964", IR: "+98", SY: "+963", YE: "+967", FJ: "+679",
  PG: "+675", DZ: "+213", AO: "+244", BW: "+267", CM: "+237", CD: "+243",
  CI: "+225", GA: "+241", GM: "+220", GN: "+224", LY: "+218", MW: "+265",
  MZ: "+258", NA: "+264", NE: "+227", RW: "+250", SN: "+221", SD: "+249",
  TZ: "+255", ZM: "+260", ZW: "+263", BO: "+591", PY: "+595", GY: "+592",
  SR: "+597", AM: "+374", AZ: "+994", GE: "+995", BS: "+1242", BB: "+1246",
  BZ: "+501", CU: "+53", DO: "+1809", HT: "+509", NI: "+505", PR: "+1787",
  SV: "+503", HN: "+504",
};

/**
 * Send phone verification for a tenant field
 */
export async function sendTenantPhoneVerification(
  tenantId: string,
  field: TenantPhoneField,
  phone: string,
  countryCode: string
): Promise<{ sent: boolean; expiresIn: number; error?: string }> {
  if (!phone) {
    return { sent: false, expiresIn: 0, error: 'Phone number is required' };
  }

  if (!countryCode) {
    return { sent: false, expiresIn: 0, error: 'Country code is required' };
  }

  // Get dial code for country
  const dialCode = countryDialCodes[countryCode.toUpperCase()];
  if (!dialCode) {
    return { sent: false, expiresIn: 0, error: 'Unknown country code' };
  }

  // Clean phone number and format to E.164
  const cleanPhone = phone.replace(/\D/g, '');
  const e164Phone = `${dialCode}${cleanPhone}`;

  // Validate E.164 format
  if (!isValidE164(e164Phone)) {
    return { sent: false, expiresIn: 0, error: 'Invalid phone number for the selected country' };
  }

  // Check for existing active code
  const existingCode = await getStoredPhoneCode(tenantId, field, e164Phone);
  if (existingCode) {
    const redis = getRedis();
    const key = `${TENANT_PHONE_CODE_PREFIX}${tenantId}:${field}:${e164Phone.replace(/[\s-]/g, '')}`;
    const ttl = await redis.ttl(key);
    if (ttl > PHONE_CODE_TTL - 60) {
      // Code was created less than 1 minute ago
      return {
        sent: false,
        expiresIn: ttl,
        error: 'A verification code was recently sent. Please wait before requesting a new one.',
      };
    }
  }

  // Send SMS via Twilio
  const result = await sendVerificationSms(e164Phone);

  if (!result.sent) {
    return { sent: false, expiresIn: 0, error: result.error };
  }

  return { sent: true, expiresIn: result.expiresIn };
}

/**
 * Verify phone code for a tenant field
 */
export async function verifyTenantPhoneCode(
  tenantId: string,
  field: TenantPhoneField,
  phone: string,
  countryCode: string,
  code: string
): Promise<{ verified: boolean; error?: string }> {
  // Get dial code for country
  const dialCode = countryDialCodes[countryCode.toUpperCase()];
  if (!dialCode) {
    return { verified: false, error: 'Unknown country code' };
  }

  // Clean phone number and format to E.164
  const cleanPhone = phone.replace(/\D/g, '');
  const e164Phone = `${dialCode}${cleanPhone}`;

  // Import verifySmsCode from sms.service (handles Twilio Verify API)
  const { verifySmsCode } = await import('./sms.service');
  const result = await verifySmsCode(e164Phone, code);

  return result;
}

export const tenantVerificationService = {
  sendTenantEmailVerification,
  verifyTenantEmailCode,
  sendTenantPhoneVerification,
  verifyTenantPhoneCode,
};
