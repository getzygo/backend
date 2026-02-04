/**
 * Tenant Settings Routes
 *
 * Manages company settings for a tenant (General, Legal, Billing tabs).
 *
 * Permissions used:
 * - canViewTenantSettings: View all company settings
 * - canManageTenantSettings: Update general and legal settings
 * - canUpdateBillingInfo: Update billing information
 * - canDeleteTenant: Delete tenant (requires MFA)
 *
 * GET /api/v1/tenants/:tenantId/settings - Get all settings (canViewTenantSettings)
 * PATCH /api/v1/tenants/:tenantId/settings/general - Update general info (canManageTenantSettings)
 * PATCH /api/v1/tenants/:tenantId/settings/legal - Update legal/tax info (canManageTenantSettings)
 * PATCH /api/v1/tenants/:tenantId/settings/billing - Update billing info (canUpdateBillingInfo)
 * POST /api/v1/tenants/:tenantId/settings/logo - Upload company logo (canManageTenantSettings)
 * GET /api/v1/tenants/:tenantId/settings/logo/file - Get company logo file (canViewTenantSettings)
 *
 * Deletion Routes (Danger Zone):
 * GET /api/v1/tenants/:tenantId/settings/deletion - Get deletion status
 * POST /api/v1/tenants/:tenantId/settings/deletion - Request deletion (canDeleteTenant + MFA)
 * DELETE /api/v1/tenants/:tenantId/settings/deletion - Cancel deletion (canDeleteTenant)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  isTenantMember,
  getTenantSettings,
  updateTenantGeneralSettings,
  updateTenantLegalSettings,
  updateTenantBillingSettings,
  getTenantById,
  updateTenant,
} from '../../services/tenant.service';
import { getTenantContacts } from '../../services/tenant-contact.service';
import { hasPermission } from '../../services/permission.service';
import { getDb } from '../../db/client';
import { auditLogs } from '../../db/schema';
import type { User } from '../../db/schema';
import {
  sendBillingEmailChangedEmail,
  sendPrimaryContactChangedEmail,
  sendTenantDeletionRequestedEmail,
  sendTenantDeletionCancelledEmail,
} from '../../services/email.service';
import {
  uploadCompanyLogo,
  getCompanyLogoFile,
  deleteCompanyLogoByPath,
  extractLogoStoragePath,
} from '../../services/company-logo.service';
import {
  requestTenantDeletion,
  cancelTenantDeletion,
  getDeletionStatus,
  getTenantMemberEmails,
  GRACE_PERIOD_DAYS,
  CANCELLATION_WINDOW_DAYS,
} from '../../services/tenant-deletion.service';

const app = new Hono();

// Apply auth middleware
app.use('*', authMiddleware);

/**
 * GET /api/v1/tenants/:tenantId/settings
 * Get all company settings for a tenant
 * Requires canViewTenantSettings permission
 */
app.get('/:tenantId/settings', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canView = await hasPermission(user.id, tenantId, 'canViewTenantSettings');
  if (!canView) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to view company settings',
      },
      403
    );
  }

  const settings = await getTenantSettings(tenantId);
  if (!settings) {
    return c.json(
      {
        error: 'tenant_not_found',
        message: 'Workspace not found',
      },
      404
    );
  }

  // Get contacts
  const contacts = await getTenantContacts(tenantId);

  return c.json({
    data: {
      general: {
        name: settings.general.name,
        slug: settings.general.slug,
        type: settings.general.type,
        industry: settings.general.industry,
        company_size: settings.general.companySize,
        website: settings.general.website,
        phone: settings.general.phone,
        phone_country_code: settings.general.phoneCountryCode,
        has_logo: !!settings.general.logoUrl,
        primary_color: settings.general.primaryColor,
        address: {
          line1: settings.general.address.line1,
          line2: settings.general.address.line2,
          city: settings.general.address.city,
          state_province: settings.general.address.stateProvince,
          state_code: settings.general.address.stateCode,
          postal_code: settings.general.address.postalCode,
          country: settings.general.address.country,
        },
      },
      legal: {
        company_legal_name: settings.legal.companyLegalName,
        business_type: settings.legal.businessType,
        incorporation_date: settings.legal.incorporationDate,
        country_of_incorporation: settings.legal.countryOfIncorporation,
        registration_number: settings.legal.registrationNumber,
        tax_id: settings.legal.taxId,
        tax_id_verified: settings.legal.taxIdVerified,
        vat_number: settings.legal.vatNumber,
        vat_verified: settings.legal.vatVerified,
      },
      billing: {
        email: settings.billing.email,
        use_different_address: settings.billing.useDifferentAddress,
        address: settings.billing.address,
        address_line2: settings.billing.addressLine2,
        city: settings.billing.city,
        state: settings.billing.state,
        postal_code: settings.billing.postalCode,
        country: settings.billing.country,
        phone: settings.billing.phone,
        phone_country_code: settings.billing.phoneCountryCode,
      },
      subscription: {
        plan: settings.subscription.plan,
        billing_cycle: settings.subscription.billingCycle,
        license_count: settings.subscription.licenseCount,
        subscription_status: settings.subscription.subscriptionStatus,
        trial_expires_at: settings.subscription.trialExpiresAt,
      },
      contacts: contacts.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        email: c.email,
        phone: c.phone,
        phone_country_code: c.phoneCountryCode,
      })),
    },
  });
});

// Update general settings schema
const updateGeneralSettingsSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  industry: z.string().max(50).optional().nullable(),
  company_size: z.string().max(20).optional().nullable(),
  website: z.string().url().max(255).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  phone_country_code: z.string().max(5).optional().nullable(),
  address_line1: z.string().max(255).optional().nullable(),
  address_line2: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state_province: z.string().max(100).optional().nullable(),
  state_code: z.string().max(10).optional().nullable(),
  postal_code: z.string().max(20).optional().nullable(),
  country: z.string().max(2).optional().nullable(),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
});

/**
 * PATCH /api/v1/tenants/:tenantId/settings/general
 * Update general company settings
 * Requires canManageTenantSettings permission
 */
app.patch(
  '/:tenantId/settings/general',
  zValidator('json', updateGeneralSettingsSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const updates = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
    if (!canManage) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to manage company settings',
        },
        403
      );
    }

    // Convert snake_case to camelCase for the service
    const serviceUpdates: Parameters<typeof updateTenantGeneralSettings>[1] = {};
    if (updates.name !== undefined) serviceUpdates.name = updates.name;
    if (updates.industry !== undefined) serviceUpdates.industry = updates.industry ?? undefined;
    if (updates.company_size !== undefined) serviceUpdates.companySize = updates.company_size ?? undefined;
    if (updates.website !== undefined) serviceUpdates.website = updates.website ?? undefined;
    if (updates.phone !== undefined) serviceUpdates.phone = updates.phone ?? undefined;
    if (updates.phone_country_code !== undefined) serviceUpdates.phoneCountryCode = updates.phone_country_code ?? undefined;
    if (updates.address_line1 !== undefined) serviceUpdates.addressLine1 = updates.address_line1 ?? undefined;
    if (updates.address_line2 !== undefined) serviceUpdates.addressLine2 = updates.address_line2 ?? undefined;
    if (updates.city !== undefined) serviceUpdates.city = updates.city ?? undefined;
    if (updates.state_province !== undefined) serviceUpdates.stateProvince = updates.state_province ?? undefined;
    if (updates.state_code !== undefined) serviceUpdates.stateCode = updates.state_code ?? undefined;
    if (updates.postal_code !== undefined) serviceUpdates.postalCode = updates.postal_code ?? undefined;
    if (updates.country !== undefined) serviceUpdates.country = updates.country ?? undefined;
    if (updates.primary_color !== undefined) serviceUpdates.primaryColor = updates.primary_color ?? undefined;

    const updated = await updateTenantGeneralSettings(tenantId, serviceUpdates);

    if (!updated) {
      return c.json(
        {
          error: 'update_failed',
          message: 'Failed to update company settings',
        },
        500
      );
    }

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'tenant_general_settings_updated',
      resourceType: 'tenant',
      resourceId: tenantId,
      details: {
        fields_updated: Object.keys(updates),
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      message: 'General settings updated successfully',
    });
  }
);

// Update legal settings schema
const updateLegalSettingsSchema = z.object({
  company_legal_name: z.string().max(200).optional().nullable(),
  business_type: z.string().max(30).optional().nullable(),
  incorporation_date: z.string().datetime().optional().nullable(),
  country_of_incorporation: z.string().length(2).optional().nullable(),
  registration_number: z.string().max(50).optional().nullable(),
  tax_id: z.string().max(50).optional().nullable(),
  vat_number: z.string().max(30).optional().nullable(),
});

/**
 * PATCH /api/v1/tenants/:tenantId/settings/legal
 * Update legal/tax settings
 * Requires canManageTenantSettings permission
 */
app.patch(
  '/:tenantId/settings/legal',
  zValidator('json', updateLegalSettingsSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const updates = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission
    const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
    if (!canManage) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to manage company settings',
        },
        403
      );
    }

    // Convert snake_case to camelCase for the service
    const serviceUpdates: Parameters<typeof updateTenantLegalSettings>[1] = {};
    if (updates.company_legal_name !== undefined) serviceUpdates.companyLegalName = updates.company_legal_name ?? undefined;
    if (updates.business_type !== undefined) serviceUpdates.businessType = updates.business_type ?? undefined;
    if (updates.incorporation_date !== undefined) {
      serviceUpdates.incorporationDate = updates.incorporation_date ? new Date(updates.incorporation_date) : undefined;
    }
    if (updates.country_of_incorporation !== undefined) serviceUpdates.countryOfIncorporation = updates.country_of_incorporation ?? undefined;
    if (updates.registration_number !== undefined) serviceUpdates.registrationNumber = updates.registration_number ?? undefined;
    if (updates.tax_id !== undefined) serviceUpdates.taxId = updates.tax_id ?? undefined;
    if (updates.vat_number !== undefined) serviceUpdates.vatNumber = updates.vat_number ?? undefined;

    const updated = await updateTenantLegalSettings(tenantId, serviceUpdates);

    if (!updated) {
      return c.json(
        {
          error: 'update_failed',
          message: 'Failed to update legal settings',
        },
        500
      );
    }

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'tenant_legal_settings_updated',
      resourceType: 'tenant',
      resourceId: tenantId,
      details: {
        fields_updated: Object.keys(updates),
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      message: 'Legal settings updated successfully',
    });
  }
);

// Update billing settings schema
const updateBillingSettingsSchema = z.object({
  billing_email: z.string().email().max(255).optional().nullable(),
  use_different_address: z.boolean().optional(),
  billing_address: z.string().max(255).optional().nullable(),
  billing_address_line2: z.string().max(255).optional().nullable(),
  billing_city: z.string().max(100).optional().nullable(),
  billing_state: z.string().max(100).optional().nullable(),
  billing_postal_code: z.string().max(20).optional().nullable(),
  billing_country: z.string().max(2).optional().nullable(),
  billing_phone: z.string().max(30).optional().nullable(),
  billing_phone_country_code: z.string().max(5).optional().nullable(),
});

/**
 * PATCH /api/v1/tenants/:tenantId/settings/billing
 * Update billing settings
 * Requires canUpdateBillingInfo permission
 * Sends email notification when billing email changes
 */
app.patch(
  '/:tenantId/settings/billing',
  zValidator('json', updateBillingSettingsSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const updates = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission
    const canUpdate = await hasPermission(user.id, tenantId, 'canUpdateBillingInfo');
    if (!canUpdate) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to update billing information',
        },
        403
      );
    }

    // Get current tenant for comparison (for email notification)
    const currentTenant = await getTenantById(tenantId);
    const oldBillingEmail = currentTenant?.billingEmail;

    // Convert snake_case to camelCase for the service
    const serviceUpdates: Parameters<typeof updateTenantBillingSettings>[1] = {};
    if (updates.billing_email !== undefined) serviceUpdates.billingEmail = updates.billing_email ?? undefined;
    if (updates.use_different_address !== undefined) serviceUpdates.useDifferentBillingAddress = updates.use_different_address;
    if (updates.billing_address !== undefined) serviceUpdates.billingAddress = updates.billing_address ?? undefined;
    if (updates.billing_address_line2 !== undefined) serviceUpdates.billingAddressLine2 = updates.billing_address_line2 ?? undefined;
    if (updates.billing_city !== undefined) serviceUpdates.billingCity = updates.billing_city ?? undefined;
    if (updates.billing_state !== undefined) serviceUpdates.billingState = updates.billing_state ?? undefined;
    if (updates.billing_postal_code !== undefined) serviceUpdates.billingPostalCode = updates.billing_postal_code ?? undefined;
    if (updates.billing_country !== undefined) serviceUpdates.billingCountry = updates.billing_country ?? undefined;
    if (updates.billing_phone !== undefined) serviceUpdates.billingPhone = updates.billing_phone ?? undefined;
    if (updates.billing_phone_country_code !== undefined) serviceUpdates.billingPhoneCountryCode = updates.billing_phone_country_code ?? undefined;

    const updated = await updateTenantBillingSettings(tenantId, serviceUpdates);

    if (!updated) {
      return c.json(
        {
          error: 'update_failed',
          message: 'Failed to update billing settings',
        },
        500
      );
    }

    // Send email notification if billing email changed
    if (updates.billing_email && oldBillingEmail && updates.billing_email !== oldBillingEmail) {
      // Send to old email
      await sendBillingEmailChangedEmail(oldBillingEmail, {
        tenantName: currentTenant?.name,
        newEmail: updates.billing_email,
        changedBy: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      });

      // Send to new email
      await sendBillingEmailChangedEmail(updates.billing_email, {
        tenantName: currentTenant?.name,
        newEmail: updates.billing_email,
        changedBy: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        isNewAddress: true,
      });
    }

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'tenant_billing_settings_updated',
      resourceType: 'tenant',
      resourceId: tenantId,
      details: {
        fields_updated: Object.keys(updates),
        billing_email_changed: updates.billing_email !== undefined && updates.billing_email !== oldBillingEmail,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      message: 'Billing settings updated successfully',
    });
  }
);

/**
 * POST /api/v1/tenants/:tenantId/settings/logo
 * Upload company logo
 * Requires canManageTenantSettings permission
 * Follows same pattern as avatar upload
 */
app.post('/:tenantId/settings/logo', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canManage = await hasPermission(user.id, tenantId, 'canManageTenantSettings');
  if (!canManage) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to manage company settings',
      },
      403
    );
  }

  // Parse multipart form data
  const formData = await c.req.formData();
  const file = formData.get('logo') as File | null;

  if (!file) {
    return c.json(
      {
        error: 'no_file',
        message: 'No logo file provided',
      },
      400
    );
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return c.json(
      {
        error: 'invalid_file_type',
        message: 'Logo must be a JPEG, PNG, GIF, or WebP image',
      },
      400
    );
  }

  // Validate file size (max 5MB)
  const maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    return c.json(
      {
        error: 'file_too_large',
        message: 'Logo must be less than 5MB',
      },
      400
    );
  }

  // Get current tenant to check for old logo
  const currentTenant = await getTenantById(tenantId);
  const oldLogoPath = currentTenant?.logoUrl ? extractLogoStoragePath(currentTenant.logoUrl) : null;

  // Upload logo
  const buffer = await file.arrayBuffer();
  const { path, error } = await uploadCompanyLogo(tenantId, buffer, file.type);

  if (error || !path) {
    return c.json(
      {
        error: 'upload_failed',
        message: error || 'Failed to upload logo',
      },
      500
    );
  }

  // Update tenant with new logo path
  const updated = await updateTenant(tenantId, { logoUrl: path });

  if (!updated) {
    return c.json(
      {
        error: 'update_failed',
        message: 'Failed to update company logo',
      },
      500
    );
  }

  // Delete old logo asynchronously
  if (oldLogoPath) {
    deleteCompanyLogoByPath(oldLogoPath).catch((err) => {
      console.error('[Settings] Failed to delete old logo:', err);
    });
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'company_logo_uploaded',
    resourceType: 'tenant',
    resourceId: tenantId,
    details: {
      file_type: file.type,
      file_size: file.size,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    success: true,
    has_logo: true,
  });
});

/**
 * GET /api/v1/tenants/:tenantId/settings/logo/file
 * Get company logo file
 * Streams the logo directly (no signed URLs exposed)
 */
app.get('/:tenantId/settings/logo/file', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Get tenant to get logo path
  const tenant = await getTenantById(tenantId);

  if (!tenant?.logoUrl) {
    return c.json(
      {
        error: 'no_logo',
        message: 'No company logo set',
      },
      404
    );
  }

  // Get the logo file
  const storagePath = extractLogoStoragePath(tenant.logoUrl) || tenant.logoUrl;
  const { data, contentType, error } = await getCompanyLogoFile(storagePath);

  if (error || !data) {
    return c.json(
      {
        error: 'logo_not_found',
        message: 'Logo file not found',
      },
      404
    );
  }

  // Return image with appropriate headers
  return new Response(data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// ============================================================================
// DANGER ZONE - Tenant Deletion
// ============================================================================

/**
 * GET /api/v1/tenants/:tenantId/settings/deletion
 * Get deletion status for a tenant
 * Requires canViewTenantSettings permission
 */
app.get('/:tenantId/settings/deletion', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canView = await hasPermission(user.id, tenantId, 'canViewTenantSettings');
  if (!canView) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to view company settings',
      },
      403
    );
  }

  const status = await getDeletionStatus(tenantId);

  if (!status) {
    return c.json(
      {
        error: 'tenant_not_found',
        message: 'Workspace not found',
      },
      404
    );
  }

  return c.json({
    data: {
      status: status.status,
      deletion_requested_at: status.deletionRequestedAt,
      deletion_scheduled_at: status.deletionScheduledAt,
      deletion_cancelable_until: status.deletionCancelableUntil,
      can_cancel: status.canCancel,
      days_until_deletion: status.daysUntilDeletion,
      days_until_cancel_expires: status.daysUntilCancelExpires,
      grace_period_days: GRACE_PERIOD_DAYS,
      cancellation_window_days: CANCELLATION_WINDOW_DAYS,
    },
  });
});

// Request deletion schema
const requestDeletionSchema = z.object({
  confirmation: z.string().min(1, 'Confirmation is required'),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/v1/tenants/:tenantId/settings/deletion
 * Request tenant deletion
 * Requires canDeleteTenant permission (MFA required by permission definition)
 * User must type the workspace name to confirm
 */
app.post(
  '/:tenantId/settings/deletion',
  zValidator('json', requestDeletionSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const { confirmation, reason } = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const db = getDb();

    // Verify membership
    const isMember = await isTenantMember(user.id, tenantId);
    if (!isMember) {
      return c.json(
        {
          error: 'not_a_member',
          message: 'You are not a member of this workspace',
        },
        403
      );
    }

    // Check permission (canDeleteTenant requires MFA per permission definition)
    const canDelete = await hasPermission(user.id, tenantId, 'canDeleteTenant');
    if (!canDelete) {
      return c.json(
        {
          error: 'permission_denied',
          message: 'You do not have permission to delete this workspace',
        },
        403
      );
    }

    // Get tenant to verify confirmation
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return c.json(
        {
          error: 'tenant_not_found',
          message: 'Workspace not found',
        },
        404
      );
    }

    // Verify confirmation matches tenant name
    if (confirmation.toLowerCase() !== tenant.name.toLowerCase()) {
      return c.json(
        {
          error: 'confirmation_mismatch',
          message: 'Confirmation does not match workspace name',
        },
        400
      );
    }

    // Request deletion
    const result = await requestTenantDeletion(tenantId, user.id, reason);

    if (!result.success) {
      // Audit failed attempt
      await db.insert(auditLogs).values({
        userId: user.id,
        action: 'tenant_deletion_request_failed',
        resourceType: 'tenant',
        resourceId: tenantId,
        details: {
          error: result.error,
        },
        ipAddress: ipAddress || undefined,
        userAgent: userAgent || undefined,
        status: 'failed',
      });

      return c.json(
        {
          error: 'deletion_request_failed',
          message: result.error,
        },
        400
      );
    }

    // Audit successful request
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'tenant_deletion_requested',
      resourceType: 'tenant',
      resourceId: tenantId,
      details: {
        reason,
        scheduled_at: result.deletionScheduledAt?.toISOString(),
        cancelable_until: result.deletionCancelableUntil?.toISOString(),
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    // Send email notifications to all members
    const members = await getTenantMemberEmails(tenantId);
    for (const member of members) {
      sendTenantDeletionRequestedEmail(member.email, {
        firstName: member.firstName || undefined,
        tenantName: tenant.name,
        deletionScheduledAt: result.deletionScheduledAt!,
        cancelableUntil: result.deletionCancelableUntil!,
        requestedBy: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        reason,
      }).catch((err) => {
        console.error(`[Settings] Failed to send deletion email to ${member.email}:`, err);
      });
    }

    return c.json({
      message: 'Deletion requested successfully',
      data: {
        deletion_scheduled_at: result.deletionScheduledAt,
        deletion_cancelable_until: result.deletionCancelableUntil,
        grace_period_days: GRACE_PERIOD_DAYS,
        cancellation_window_days: CANCELLATION_WINDOW_DAYS,
      },
    });
  }
);

/**
 * DELETE /api/v1/tenants/:tenantId/settings/deletion
 * Cancel pending deletion request
 * Requires canDeleteTenant permission
 * Only works within the cancellation window
 */
app.delete('/:tenantId/settings/deletion', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const db = getDb();

  // Verify membership
  const isMember = await isTenantMember(user.id, tenantId);
  if (!isMember) {
    return c.json(
      {
        error: 'not_a_member',
        message: 'You are not a member of this workspace',
      },
      403
    );
  }

  // Check permission
  const canDelete = await hasPermission(user.id, tenantId, 'canDeleteTenant');
  if (!canDelete) {
    return c.json(
      {
        error: 'permission_denied',
        message: 'You do not have permission to manage workspace deletion',
      },
      403
    );
  }

  // Get tenant for notifications
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return c.json(
      {
        error: 'tenant_not_found',
        message: 'Workspace not found',
      },
      404
    );
  }

  // Cancel deletion
  const result = await cancelTenantDeletion(tenantId);

  if (!result.success) {
    // Audit failed attempt
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'tenant_deletion_cancel_failed',
      resourceType: 'tenant',
      resourceId: tenantId,
      details: {
        error: result.error,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'failed',
    });

    return c.json(
      {
        error: 'cancellation_failed',
        message: result.error,
      },
      400
    );
  }

  // Audit successful cancellation
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'tenant_deletion_cancelled',
    resourceType: 'tenant',
    resourceId: tenantId,
    details: {
      cancelled_by: user.id,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  // Send email notifications to all members
  const members = await getTenantMemberEmails(tenantId);
  for (const member of members) {
    sendTenantDeletionCancelledEmail(member.email, {
      firstName: member.firstName || undefined,
      tenantName: tenant.name,
      cancelledBy: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
    }).catch((err) => {
      console.error(`[Settings] Failed to send cancellation email to ${member.email}:`, err);
    });
  }

  return c.json({
    message: 'Deletion cancelled successfully',
  });
});

export default app;
