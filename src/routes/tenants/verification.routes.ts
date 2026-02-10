/**
 * Tenant Verification Routes
 *
 * Email and phone verification for tenant settings fields.
 * Supports billing email, billing phone, company phone, and contact verification.
 *
 * POST /api/v1/tenants/:tenantId/verify/billing-email/send - Send code to billing email
 * POST /api/v1/tenants/:tenantId/verify/billing-email/confirm - Verify billing email
 * POST /api/v1/tenants/:tenantId/verify/billing-phone/send - Send SMS to billing phone
 * POST /api/v1/tenants/:tenantId/verify/billing-phone/confirm - Verify billing phone
 * POST /api/v1/tenants/:tenantId/verify/phone/send - Send SMS to company phone
 * POST /api/v1/tenants/:tenantId/verify/phone/confirm - Verify company phone
 * POST /api/v1/tenants/:tenantId/contacts/:contactId/verify/email/send - Send code to contact email
 * POST /api/v1/tenants/:tenantId/contacts/:contactId/verify/email/confirm - Verify contact email
 * POST /api/v1/tenants/:tenantId/contacts/:contactId/verify/phone/send - Send SMS to contact phone
 * POST /api/v1/tenants/:tenantId/contacts/:contactId/verify/phone/confirm - Verify contact phone
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware';
import { rateLimit, RATE_LIMITS } from '../../middleware/rate-limit.middleware';
import { isTenantMember, getTenantById } from '../../services/tenant.service';
import { hasPermission } from '../../services/permission.service';
import {
  sendTenantEmailVerification,
  verifyTenantEmailCode,
  sendTenantPhoneVerification,
  verifyTenantPhoneCode,
} from '../../services/tenant-verification.service';
import { getDb } from '../../db/client';
import { tenants, tenantContacts, auditLogs } from '../../db/schema';
import type { User } from '../../db/schema';

const app = new Hono();

// Apply auth middleware
app.use('*', authMiddleware);

// Schema for sending email verification
const sendEmailCodeSchema = z.object({
  email: z.string().email('Valid email required'),
});

// Schema for sending phone verification
const sendPhoneCodeSchema = z.object({
  phone: z.string().min(4, 'Phone number is required'),
  country_code: z.string().length(2, 'Country code must be 2 letters (e.g., US)'),
});

// Schema for verifying code
const verifyCodeSchema = z.object({
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

// ============================================================================
// Billing Email Verification
// ============================================================================

/**
 * POST /api/v1/tenants/:tenantId/verify/billing-email/send
 * Send verification code to billing email
 */
app.post(
  '/:tenantId/verify/billing-email/send',
  rateLimit(RATE_LIMITS.SENSITIVE),
  zValidator('json', sendEmailCodeSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const { email } = c.req.valid('json');

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canUpdate = await hasPermission(user.id, tenantId, 'canUpdateBillingInfo');
    if (!canUpdate) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to update billing information' }, 403);
    }

    // Get tenant name for email
    const tenant = await getTenantById(tenantId);

    const result = await sendTenantEmailVerification(tenantId, 'billing_email', email, tenant?.name);

    if (!result.sent) {
      return c.json({ error: 'send_failed', message: result.error }, result.error?.includes('recently sent') ? 429 : 500);
    }

    return c.json({ sent: true, expires_in: result.expiresIn });
  }
);

/**
 * POST /api/v1/tenants/:tenantId/verify/billing-email/confirm
 * Verify billing email with code
 */
app.post(
  '/:tenantId/verify/billing-email/confirm',
  rateLimit(RATE_LIMITS.SENSITIVE),
  zValidator('json', verifyCodeSchema.extend({ email: z.string().email() })),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const { code, email } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canUpdate = await hasPermission(user.id, tenantId, 'canUpdateBillingInfo');
    if (!canUpdate) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to update billing information' }, 403);
    }

    const result = await verifyTenantEmailCode(tenantId, 'billing_email', email, code);

    if (!result.verified) {
      return c.json({ error: 'invalid_code', message: result.error }, 400);
    }

    // Update tenant billing email verification status
    await db
      .update(tenants)
      .set({
        billingEmail: email,
        billingEmailVerified: true,
        billingEmailVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      tenantId,
      action: 'tenant_billing_email_verified',
      resourceType: 'tenant',
      resourceId: tenantId,
      details: { email },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({ verified: true });
  }
);

// ============================================================================
// Billing Phone Verification
// ============================================================================

/**
 * POST /api/v1/tenants/:tenantId/verify/billing-phone/send
 * Send verification SMS to billing phone
 */
app.post(
  '/:tenantId/verify/billing-phone/send',
  rateLimit(RATE_LIMITS.STRICT),
  zValidator('json', sendPhoneCodeSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const { phone, country_code } = c.req.valid('json');

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canUpdate = await hasPermission(user.id, tenantId, 'canUpdateBillingInfo');
    if (!canUpdate) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to update billing information' }, 403);
    }

    const result = await sendTenantPhoneVerification(tenantId, 'billing_phone', phone, country_code);

    if (!result.sent) {
      return c.json({ error: 'send_failed', message: result.error }, result.error?.includes('recently sent') ? 429 : 500);
    }

    return c.json({ sent: true, expires_in: result.expiresIn });
  }
);

/**
 * POST /api/v1/tenants/:tenantId/verify/billing-phone/confirm
 * Verify billing phone with code
 */
app.post(
  '/:tenantId/verify/billing-phone/confirm',
  rateLimit(RATE_LIMITS.STRICT),
  zValidator('json', verifyCodeSchema.extend({
    phone: z.string().min(4),
    country_code: z.string().length(2),
  })),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const { code, phone, country_code } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canUpdate = await hasPermission(user.id, tenantId, 'canUpdateBillingInfo');
    if (!canUpdate) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to update billing information' }, 403);
    }

    const result = await verifyTenantPhoneCode(tenantId, 'billing_phone', phone, country_code, code);

    if (!result.verified) {
      return c.json({ error: 'invalid_code', message: result.error }, 400);
    }

    // Clean phone number for storage
    const cleanPhone = phone.replace(/\D/g, '');

    // Update tenant billing phone verification status
    await db
      .update(tenants)
      .set({
        billingPhone: cleanPhone,
        billingPhoneCountryCode: country_code.toUpperCase(),
        billingPhoneVerified: true,
        billingPhoneVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      tenantId,
      action: 'tenant_billing_phone_verified',
      resourceType: 'tenant',
      resourceId: tenantId,
      details: { phone: cleanPhone, country_code },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({ verified: true });
  }
);

// ============================================================================
// Company Phone Verification
// ============================================================================

/**
 * POST /api/v1/tenants/:tenantId/verify/phone/send
 * Send verification SMS to company phone
 */
app.post(
  '/:tenantId/verify/phone/send',
  rateLimit(RATE_LIMITS.STRICT),
  zValidator('json', sendPhoneCodeSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const { phone, country_code } = c.req.valid('json');

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
    if (!canManage) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to manage company settings' }, 403);
    }

    const result = await sendTenantPhoneVerification(tenantId, 'company_phone', phone, country_code);

    if (!result.sent) {
      return c.json({ error: 'send_failed', message: result.error }, result.error?.includes('recently sent') ? 429 : 500);
    }

    return c.json({ sent: true, expires_in: result.expiresIn });
  }
);

/**
 * POST /api/v1/tenants/:tenantId/verify/phone/confirm
 * Verify company phone with code
 */
app.post(
  '/:tenantId/verify/phone/confirm',
  rateLimit(RATE_LIMITS.STRICT),
  zValidator('json', verifyCodeSchema.extend({
    phone: z.string().min(4),
    country_code: z.string().length(2),
  })),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const { code, phone, country_code } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
    if (!canManage) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to manage company settings' }, 403);
    }

    const result = await verifyTenantPhoneCode(tenantId, 'company_phone', phone, country_code, code);

    if (!result.verified) {
      return c.json({ error: 'invalid_code', message: result.error }, 400);
    }

    // Clean phone number for storage
    const cleanPhone = phone.replace(/\D/g, '');

    // Update tenant company phone verification status
    await db
      .update(tenants)
      .set({
        phone: cleanPhone,
        phoneCountryCode: country_code.toUpperCase(),
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      tenantId,
      action: 'tenant_phone_verified',
      resourceType: 'tenant',
      resourceId: tenantId,
      details: { phone: cleanPhone, country_code },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({ verified: true });
  }
);

// ============================================================================
// Contact Email Verification
// ============================================================================

/**
 * POST /api/v1/tenants/:tenantId/contacts/:contactId/verify/email/send
 * Send verification code to contact email
 */
app.post(
  '/:tenantId/contacts/:contactId/verify/email/send',
  rateLimit(RATE_LIMITS.SENSITIVE),
  zValidator('json', sendEmailCodeSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const contactId = c.req.param('contactId');
    const { email } = c.req.valid('json');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
    if (!canManage) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to manage company settings' }, 403);
    }

    // Verify contact belongs to tenant
    const [contact] = await db
      .select()
      .from(tenantContacts)
      .where(and(eq(tenantContacts.id, contactId), eq(tenantContacts.tenantId, tenantId)));

    if (!contact) {
      return c.json({ error: 'contact_not_found', message: 'Contact not found' }, 404);
    }

    // Get tenant name for email
    const tenant = await getTenantById(tenantId);

    const result = await sendTenantEmailVerification(
      tenantId,
      'contact_email',
      email,
      tenant?.name
    );

    if (!result.sent) {
      return c.json({ error: 'send_failed', message: result.error }, result.error?.includes('recently sent') ? 429 : 500);
    }

    return c.json({ sent: true, expires_in: result.expiresIn });
  }
);

/**
 * POST /api/v1/tenants/:tenantId/contacts/:contactId/verify/email/confirm
 * Verify contact email with code
 */
app.post(
  '/:tenantId/contacts/:contactId/verify/email/confirm',
  rateLimit(RATE_LIMITS.SENSITIVE),
  zValidator('json', verifyCodeSchema.extend({ email: z.string().email() })),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const contactId = c.req.param('contactId');
    const { code, email } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
    if (!canManage) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to manage company settings' }, 403);
    }

    // Verify contact belongs to tenant
    const [contact] = await db
      .select()
      .from(tenantContacts)
      .where(and(eq(tenantContacts.id, contactId), eq(tenantContacts.tenantId, tenantId)));

    if (!contact) {
      return c.json({ error: 'contact_not_found', message: 'Contact not found' }, 404);
    }

    const result = await verifyTenantEmailCode(tenantId, 'contact_email', email, code);

    if (!result.verified) {
      return c.json({ error: 'invalid_code', message: result.error }, 400);
    }

    // Update contact email verification status
    await db
      .update(tenantContacts)
      .set({
        email,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenantContacts.id, contactId));

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      tenantId,
      action: 'tenant_contact_email_verified',
      resourceType: 'tenant_contact',
      resourceId: contactId,
      details: { email, contact_type: contact.type },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({ verified: true });
  }
);

// ============================================================================
// Contact Phone Verification
// ============================================================================

/**
 * POST /api/v1/tenants/:tenantId/contacts/:contactId/verify/phone/send
 * Send verification SMS to contact phone
 */
app.post(
  '/:tenantId/contacts/:contactId/verify/phone/send',
  rateLimit(RATE_LIMITS.STRICT),
  zValidator('json', sendPhoneCodeSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const contactId = c.req.param('contactId');
    const { phone, country_code } = c.req.valid('json');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
    if (!canManage) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to manage company settings' }, 403);
    }

    // Verify contact belongs to tenant
    const [contact] = await db
      .select()
      .from(tenantContacts)
      .where(and(eq(tenantContacts.id, contactId), eq(tenantContacts.tenantId, tenantId)));

    if (!contact) {
      return c.json({ error: 'contact_not_found', message: 'Contact not found' }, 404);
    }

    const result = await sendTenantPhoneVerification(tenantId, 'contact_phone', phone, country_code);

    if (!result.sent) {
      return c.json({ error: 'send_failed', message: result.error }, result.error?.includes('recently sent') ? 429 : 500);
    }

    return c.json({ sent: true, expires_in: result.expiresIn });
  }
);

/**
 * POST /api/v1/tenants/:tenantId/contacts/:contactId/verify/phone/confirm
 * Verify contact phone with code
 */
app.post(
  '/:tenantId/contacts/:contactId/verify/phone/confirm',
  rateLimit(RATE_LIMITS.STRICT),
  zValidator('json', verifyCodeSchema.extend({
    phone: z.string().min(4),
    country_code: z.string().length(2),
  })),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const contactId = c.req.param('contactId');
    const { code, phone, country_code } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json({ error: 'not_a_member', message: 'You are not a member of this workspace' }, 403);
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
    if (!canManage) {
      return c.json({ error: 'permission_denied', message: 'You do not have permission to manage company settings' }, 403);
    }

    // Verify contact belongs to tenant
    const [contact] = await db
      .select()
      .from(tenantContacts)
      .where(and(eq(tenantContacts.id, contactId), eq(tenantContacts.tenantId, tenantId)));

    if (!contact) {
      return c.json({ error: 'contact_not_found', message: 'Contact not found' }, 404);
    }

    const result = await verifyTenantPhoneCode(tenantId, 'contact_phone', phone, country_code, code);

    if (!result.verified) {
      return c.json({ error: 'invalid_code', message: result.error }, 400);
    }

    // Clean phone number for storage
    const cleanPhone = phone.replace(/\D/g, '');

    // Update contact phone verification status
    await db
      .update(tenantContacts)
      .set({
        phone: cleanPhone,
        phoneCountryCode: country_code.toUpperCase(),
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenantContacts.id, contactId));

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      tenantId,
      action: 'tenant_contact_phone_verified',
      resourceType: 'tenant_contact',
      resourceId: contactId,
      details: { phone: cleanPhone, country_code, contact_type: contact.type },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({ verified: true });
  }
);

export default app;
