/**
 * Tenant Contact Service
 *
 * Handles CRUD operations for tenant contacts (primary, billing, technical, etc.)
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  tenantContacts,
  type TenantContact,
  type NewTenantContact,
} from '../db/schema';

// Valid contact types
export const CONTACT_TYPES = [
  'primary',
  'technical-support',
  'financial',
  'marketing',
  'sales',
  'legal',
  'hr',
  'operations',
  'customer-success',
] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];

/**
 * Get all contacts for a tenant
 */
export async function getTenantContacts(tenantId: string): Promise<TenantContact[]> {
  const db = getDb();

  const contacts = await db.query.tenantContacts.findMany({
    where: eq(tenantContacts.tenantId, tenantId),
    orderBy: (contacts, { asc }) => [asc(contacts.type)],
  });

  return contacts;
}

/**
 * Get a specific contact by type for a tenant
 */
export async function getContactByType(
  tenantId: string,
  type: ContactType
): Promise<TenantContact | null> {
  const db = getDb();

  const contact = await db.query.tenantContacts.findFirst({
    where: and(
      eq(tenantContacts.tenantId, tenantId),
      eq(tenantContacts.type, type)
    ),
  });

  return contact || null;
}

/**
 * Get a contact by ID
 */
export async function getContactById(contactId: string): Promise<TenantContact | null> {
  const db = getDb();

  const contact = await db.query.tenantContacts.findFirst({
    where: eq(tenantContacts.id, contactId),
  });

  return contact || null;
}

/**
 * Create a new contact for a tenant
 * Only one contact per type is allowed per tenant
 */
export async function createContact(
  tenantId: string,
  data: {
    type: ContactType;
    name: string;
    email: string;
    phone?: string;
    phoneCountryCode?: string;
  }
): Promise<TenantContact | null> {
  const db = getDb();

  // Check if contact type already exists for this tenant
  const existing = await getContactByType(tenantId, data.type);
  if (existing) {
    throw new Error(`Contact of type '${data.type}' already exists for this tenant`);
  }

  const newContact: NewTenantContact = {
    tenantId,
    type: data.type,
    name: data.name,
    email: data.email,
    phone: data.phone,
    phoneCountryCode: data.phoneCountryCode,
  };

  const [contact] = await db.insert(tenantContacts).values(newContact).returning();

  return contact || null;
}

/**
 * Update an existing contact
 */
export async function updateContact(
  contactId: string,
  updates: {
    name?: string;
    email?: string;
    phone?: string | null;
    phoneCountryCode?: string | null;
  }
): Promise<TenantContact | null> {
  const db = getDb();

  const [updated] = await db
    .update(tenantContacts)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(tenantContacts.id, contactId))
    .returning();

  return updated || null;
}

/**
 * Delete a contact
 */
export async function deleteContact(contactId: string): Promise<boolean> {
  const db = getDb();

  const result = await db
    .delete(tenantContacts)
    .where(eq(tenantContacts.id, contactId))
    .returning({ id: tenantContacts.id });

  return result.length > 0;
}

/**
 * Upsert a contact (create if not exists, update if exists)
 * Useful for bulk updates from settings forms
 */
export async function upsertContact(
  tenantId: string,
  data: {
    type: ContactType;
    name: string;
    email: string;
    phone?: string | null;
    phoneCountryCode?: string | null;
  }
): Promise<TenantContact | null> {
  const db = getDb();

  // Check if exists
  const existing = await getContactByType(tenantId, data.type);

  if (existing) {
    // Update
    return updateContact(existing.id, {
      name: data.name,
      email: data.email,
      phone: data.phone ?? undefined,
      phoneCountryCode: data.phoneCountryCode ?? undefined,
    });
  } else {
    // Create
    return createContact(tenantId, {
      type: data.type,
      name: data.name,
      email: data.email,
      phone: data.phone ?? undefined,
      phoneCountryCode: data.phoneCountryCode ?? undefined,
    });
  }
}

/**
 * Validate contact type
 */
export function isValidContactType(type: string): type is ContactType {
  return CONTACT_TYPES.includes(type as ContactType);
}

export const tenantContactService = {
  getTenantContacts,
  getContactByType,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
  upsertContact,
  isValidContactType,
  CONTACT_TYPES,
};
