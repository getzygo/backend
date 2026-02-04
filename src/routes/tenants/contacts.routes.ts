/**
 * Tenant Contacts Routes
 *
 * Manages contact information for different roles within a tenant.
 *
 * Contact types:
 * - primary: Main company contact
 * - technical-support: Technical support contact
 * - financial: Financial/accounting contact
 * - marketing: Marketing contact
 * - sales: Sales contact
 * - legal: Legal contact
 * - hr: Human resources contact
 * - operations: Operations contact
 * - customer-success: Customer success contact
 *
 * Permissions used:
 * - canViewTenantSettings: View contacts
 * - canManageTenantSettings: Create, update, delete contacts
 *
 * GET /api/v1/tenants/:tenantId/contacts - List all contacts
 * POST /api/v1/tenants/:tenantId/contacts - Create a contact
 * PATCH /api/v1/tenants/:tenantId/contacts/:contactId - Update a contact
 * DELETE /api/v1/tenants/:tenantId/contacts/:contactId - Delete a contact
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { isTenantMember } from '../../services/tenant.service';
import {
  getTenantContacts,
  getContactById,
  getContactByType,
  createContact,
  updateContact,
  deleteContact,
  isValidContactType,
  CONTACT_TYPES,
  type ContactType,
} from '../../services/tenant-contact.service';
import { hasPermission } from '../../services/permission.service';
import { getDb } from '../../db/client';
import { auditLogs } from '../../db/schema';
import type { User } from '../../db/schema';
import { notify, sendEmail } from '../../services/notification-hub.service';
import { NOTIFICATION_CONFIGS, EMAIL_TEMPLATES } from '../../services/notification-configs';

const app = new Hono();

// Apply auth middleware
app.use('*', authMiddleware);

/**
 * GET /api/v1/tenants/:tenantId/contacts
 * List all contacts for a tenant
 * Requires canViewTenantSettings permission
 */
app.get('/:tenantId/contacts', async (c) => {
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

  const contacts = await getTenantContacts(tenantId);

  return c.json({
    data: contacts.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      email: c.email,
      phone: c.phone,
      phone_country_code: c.phoneCountryCode,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    })),
    count: contacts.length,
  });
});

// Create contact schema
const createContactSchema = z.object({
  type: z.enum(CONTACT_TYPES as unknown as [string, ...string[]]),
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  phone: z.string().max(30).optional(),
  phone_country_code: z.string().max(5).optional(),
});

/**
 * POST /api/v1/tenants/:tenantId/contacts
 * Create a new contact
 * Requires canManageTenantSettings permission
 * Only one contact per type is allowed per tenant
 */
app.post(
  '/:tenantId/contacts',
  zValidator('json', createContactSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const body = c.req.valid('json');
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

    // Validate contact type
    if (!isValidContactType(body.type)) {
      return c.json(
        {
          error: 'invalid_contact_type',
          message: `Invalid contact type. Valid types: ${CONTACT_TYPES.join(', ')}`,
        },
        400
      );
    }

    // Check if contact type already exists
    const existing = await getContactByType(tenantId, body.type as ContactType);
    if (existing) {
      return c.json(
        {
          error: 'contact_exists',
          message: `A ${body.type} contact already exists. Update or delete the existing contact first.`,
        },
        409
      );
    }

    const contact = await createContact(tenantId, {
      type: body.type as ContactType,
      name: body.name,
      email: body.email,
      phone: body.phone,
      phoneCountryCode: body.phone_country_code,
    });

    if (!contact) {
      return c.json(
        {
          error: 'create_failed',
          message: 'Failed to create contact',
        },
        500
      );
    }

    // Send notification for primary contact creation (email + in-app) - ALWAYS_SEND
    if (body.type === 'primary') {
      const changedBy = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
      const config = NOTIFICATION_CONFIGS.primary_contact_added;

      // Send email to the new primary contact
      sendEmail({
        to: body.email,
        subject: config.emailSubject,
        template: EMAIL_TEMPLATES.primaryContactChanged({
          contactName: body.name,
          action: 'added',
          changedBy,
          isNewAddress: true,
        }),
      }).catch((err) => console.error('[Contacts] Notification failed:', err));

      // Create in-app notification for the user making the change
      notify({
        userId: user.id,
        tenantId,
        category: config.category,
        type: config.type,
        title: config.title,
        message: config.message as string,
        severity: config.severity,
        actionRoute: config.actionRoute,
        actionLabel: config.actionLabel,
        metadata: { contactEmail: body.email, contactName: body.name },
      }).catch((err) => console.error('[Contacts] In-app notification failed:', err));
    }

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'contact_created',
      resourceType: 'tenant_contact',
      resourceId: contact.id,
      details: {
        type: body.type,
        email: body.email,
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      data: {
        id: contact.id,
        type: contact.type,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        phone_country_code: contact.phoneCountryCode,
        created_at: contact.createdAt,
        updated_at: contact.updatedAt,
      },
    }, 201);
  }
);

// Update contact schema
const updateContactSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(30).optional().nullable(),
  phone_country_code: z.string().max(5).optional().nullable(),
});

/**
 * PATCH /api/v1/tenants/:tenantId/contacts/:contactId
 * Update an existing contact
 * Requires canManageTenantSettings permission
 */
app.patch(
  '/:tenantId/contacts/:contactId',
  zValidator('json', updateContactSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const contactId = c.req.param('contactId');
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

    // Get existing contact
    const existing = await getContactById(contactId);
    if (!existing) {
      return c.json(
        {
          error: 'contact_not_found',
          message: 'Contact not found',
        },
        404
      );
    }

    // Verify contact belongs to this tenant
    if (existing.tenantId !== tenantId) {
      return c.json(
        {
          error: 'contact_not_found',
          message: 'Contact not found',
        },
        404
      );
    }

    // Convert snake_case to camelCase
    const serviceUpdates: Parameters<typeof updateContact>[1] = {};
    if (updates.name !== undefined) serviceUpdates.name = updates.name;
    if (updates.email !== undefined) serviceUpdates.email = updates.email;
    if (updates.phone !== undefined) serviceUpdates.phone = updates.phone;
    if (updates.phone_country_code !== undefined) serviceUpdates.phoneCountryCode = updates.phone_country_code;

    const contact = await updateContact(contactId, serviceUpdates);

    if (!contact) {
      return c.json(
        {
          error: 'update_failed',
          message: 'Failed to update contact',
        },
        500
      );
    }

    // Send notification for primary contact email change (email + in-app) - ALWAYS_SEND
    if (existing.type === 'primary' && updates.email && updates.email !== existing.email) {
      const changedBy = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
      const updateConfig = NOTIFICATION_CONFIGS.primary_contact_updated;

      // Notify old email
      sendEmail({
        to: existing.email,
        subject: updateConfig.emailSubject,
        template: EMAIL_TEMPLATES.primaryContactChanged({
          contactName: existing.name,
          action: 'updated',
          changedBy,
          newEmail: updates.email,
        }),
      }).catch((err) => console.error('[Contacts] Notification to old email failed:', err));

      // Notify new email
      sendEmail({
        to: updates.email,
        subject: 'You are now the primary contact - Zygo',
        template: EMAIL_TEMPLATES.primaryContactChanged({
          contactName: updates.name || existing.name,
          action: 'added',
          changedBy,
          isNewAddress: true,
        }),
      }).catch((err) => console.error('[Contacts] Notification to new email failed:', err));

      // Create in-app notification for the user making the change
      notify({
        userId: user.id,
        tenantId,
        category: updateConfig.category,
        type: updateConfig.type,
        title: updateConfig.title,
        message: updateConfig.message as string,
        severity: updateConfig.severity,
        actionRoute: updateConfig.actionRoute,
        actionLabel: updateConfig.actionLabel,
        metadata: { oldEmail: existing.email, newEmail: updates.email },
      }).catch((err) => console.error('[Contacts] In-app notification failed:', err));
    }

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'contact_updated',
      resourceType: 'tenant_contact',
      resourceId: contactId,
      details: {
        type: existing.type,
        fields_updated: Object.keys(updates),
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      data: {
        id: contact.id,
        type: contact.type,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        phone_country_code: contact.phoneCountryCode,
        created_at: contact.createdAt,
        updated_at: contact.updatedAt,
      },
    });
  }
);

/**
 * DELETE /api/v1/tenants/:tenantId/contacts/:contactId
 * Delete a contact
 * Requires canManageTenantSettings permission
 */
app.delete('/:tenantId/contacts/:contactId', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const contactId = c.req.param('contactId');
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

  // Get existing contact
  const existing = await getContactById(contactId);
  if (!existing) {
    return c.json(
      {
        error: 'contact_not_found',
        message: 'Contact not found',
      },
      404
    );
  }

  // Verify contact belongs to this tenant
  if (existing.tenantId !== tenantId) {
    return c.json(
      {
        error: 'contact_not_found',
        message: 'Contact not found',
      },
      404
    );
  }

  const deleted = await deleteContact(contactId);

  if (!deleted) {
    return c.json(
      {
        error: 'delete_failed',
        message: 'Failed to delete contact',
      },
      500
    );
  }

  // Send notification for primary contact deletion (email + in-app) - ALWAYS_SEND
  if (existing.type === 'primary') {
    const changedBy = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
    const removeConfig = NOTIFICATION_CONFIGS.primary_contact_removed;

    // Notify the removed contact
    sendEmail({
      to: existing.email,
      subject: removeConfig.emailSubject,
      template: EMAIL_TEMPLATES.primaryContactChanged({
        contactName: existing.name,
        action: 'removed',
        changedBy,
      }),
    }).catch((err) => console.error('[Contacts] Notification failed:', err));

    // Create in-app notification for the user making the change
    notify({
      userId: user.id,
      tenantId,
      category: removeConfig.category,
      type: removeConfig.type,
      title: removeConfig.title,
      message: removeConfig.message as string,
      severity: removeConfig.severity,
      actionRoute: removeConfig.actionRoute,
      actionLabel: removeConfig.actionLabel,
      metadata: { contactEmail: existing.email, contactName: existing.name },
    }).catch((err) => console.error('[Contacts] In-app notification failed:', err));
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId: user.id,
    action: 'contact_deleted',
    resourceType: 'tenant_contact',
    resourceId: contactId,
    details: {
      type: existing.type,
      email: existing.email,
    },
    ipAddress: ipAddress || undefined,
    userAgent: userAgent || undefined,
    status: 'success',
  });

  return c.json({
    message: 'Contact deleted successfully',
  });
});

export default app;
