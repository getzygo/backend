/**
 * Tenant Archive Service
 *
 * Handles archiving of deleted tenant data for legal compliance.
 * Per DATA_PROTECTION.md: 7-year retention for GDPR, CCPA, SOC2.
 *
 * Archive process:
 * 1. Collect all tenant data (users, workflows, servers, etc.)
 * 2. Create JSON archive with metadata
 * 3. Encrypt with AES-256
 * 4. Store in cold storage
 * 5. Create archive record with checksums
 */

import { createClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import { getEnv } from '../config/env';
import {
  tenants,
  tenantArchives,
  tenantMembers,
  tenantContacts,
  tenantSecurityConfig,
  users,
  roles,
  auditLogs,
  type TenantArchive,
  type NewTenantArchive,
} from '../db/schema';
import { logger } from '../utils/logger';

const BUCKET_NAME = 'archives';
const RETENTION_YEARS = 7;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Get Supabase client with service role for storage operations
 */
function getStorageClient() {
  const env = getEnv();
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Generate a unique encryption key for an archive
 * In production, this should use AWS KMS or similar
 */
function generateEncryptionKey(): { key: Buffer; keyId: string } {
  const key = randomBytes(32); // 256 bits for AES-256
  const keyId = `local-${randomBytes(8).toString('hex')}`; // Local key ID
  return { key, keyId };
}

/**
 * Encrypt data using AES-256-GCM
 */
function encryptData(data: Buffer, key: Buffer): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { encrypted, iv, authTag };
}

/**
 * Decrypt data using AES-256-GCM
 */
function decryptData(encrypted: Buffer, key: Buffer, iv: Buffer, authTag: Buffer): Buffer {
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Calculate SHA-256 checksum
 */
function calculateChecksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Tenant data to be archived
 */
interface TenantArchiveData {
  tenant: {
    id: string;
    name: string;
    slug: string;
    type: string;
    plan: string;
    createdAt: Date;
    metadata: Record<string, unknown>;
  };
  members: Array<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    isOwner: boolean;
    joinedAt: Date | null;
  }>;
  contacts: Array<{
    type: string;
    name: string;
    email: string;
    phone: string | null;
  }>;
  billing: {
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    companyLegalName: string | null;
    taxId: string | null;
  };
  securityConfig: Record<string, unknown> | null;
  auditLogCount: number;
  // Counts for summary
  counts: {
    members: number;
    contacts: number;
    roles: number;
    auditLogs: number;
  };
  archiveMetadata: {
    version: string;
    createdAt: string;
    reason: string;
    deletedBy: string;
  };
}

/**
 * Collect all tenant data for archiving
 */
export async function collectTenantData(
  tenantId: string,
  deletedBy: string,
  reason?: string
): Promise<TenantArchiveData | null> {
  const db = getDb();

  // Get tenant
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant) {
    return null;
  }

  // Get members with user details
  const members = await db
    .select({
      userId: tenantMembers.userId,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      roleName: roles.name,
      isOwner: tenantMembers.isOwner,
      joinedAt: tenantMembers.joinedAt,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .innerJoin(roles, eq(tenantMembers.primaryRoleId, roles.id))
    .where(eq(tenantMembers.tenantId, tenantId));

  // Get contacts
  const contacts = await db.query.tenantContacts.findMany({
    where: eq(tenantContacts.tenantId, tenantId),
  });

  // Get security config
  const securityConfig = await db.query.tenantSecurityConfig.findFirst({
    where: eq(tenantSecurityConfig.tenantId, tenantId),
  });

  // Get audit log count (we don't archive full logs, just count)
  const [auditLogResult] = await db
    .select({ count: auditLogs.id })
    .from(auditLogs)
    .where(eq(auditLogs.resourceId, tenantId));

  // Get role count
  const roleResults = await db.query.roles.findMany({
    where: eq(roles.tenantId, tenantId),
    columns: { id: true },
  });

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      type: tenant.type,
      plan: tenant.plan,
      createdAt: tenant.createdAt,
      metadata: tenant.metadata as Record<string, unknown>,
    },
    members: members.map((m) => ({
      userId: m.userId,
      email: m.email,
      firstName: m.firstName,
      lastName: m.lastName,
      role: m.roleName,
      isOwner: m.isOwner,
      joinedAt: m.joinedAt,
    })),
    contacts: contacts.map((c) => ({
      type: c.type,
      name: c.name,
      email: c.email,
      phone: c.phone,
    })),
    billing: {
      email: tenant.billingEmail,
      address: tenant.billingAddress,
      city: tenant.billingCity,
      state: tenant.billingState,
      postalCode: tenant.billingPostalCode,
      country: tenant.billingCountry,
      companyLegalName: tenant.companyLegalName,
      taxId: tenant.taxId,
    },
    securityConfig: securityConfig
      ? {
          requirePhoneVerification: securityConfig.requirePhoneVerification,
          requireMfa: securityConfig.requireMfa,
          sessionTimeoutMinutes: securityConfig.sessionTimeoutMinutes,
          maxConcurrentSessions: securityConfig.maxConcurrentSessions,
          ssoEnabled: securityConfig.ssoEnabled,
          ssoProvider: securityConfig.ssoProvider,
        }
      : null,
    auditLogCount: auditLogResult?.count ? 1 : 0, // Just indicating if there are logs
    counts: {
      members: members.length,
      contacts: contacts.length,
      roles: roleResults.length,
      auditLogs: auditLogResult?.count ? 1 : 0,
    },
    archiveMetadata: {
      version: '1.0',
      createdAt: new Date().toISOString(),
      reason: reason || 'User requested deletion',
      deletedBy,
    },
  };
}

/**
 * Create and store encrypted archive
 */
export async function createTenantArchive(
  tenantId: string,
  deletedBy: string,
  reason?: string
): Promise<{ archive: TenantArchive; error?: string } | { archive: null; error: string }> {
  try {
    const db = getDb();

    // Collect data
    const archiveData = await collectTenantData(tenantId, deletedBy, reason);
    if (!archiveData) {
      return { archive: null, error: 'Tenant not found' };
    }

    // Serialize to JSON
    const jsonData = JSON.stringify(archiveData, null, 2);
    const dataBuffer = Buffer.from(jsonData, 'utf-8');

    // Generate encryption key
    const { key, keyId } = generateEncryptionKey();

    // Encrypt data
    const { encrypted, iv, authTag } = encryptData(dataBuffer, key);

    // Create archive package (iv + authTag + encrypted data)
    // Format: [16 bytes IV][16 bytes authTag][encrypted data]
    const archivePackage = Buffer.concat([iv, authTag, encrypted]);

    // Calculate checksum
    const checksum = calculateChecksum(archivePackage);

    // Generate storage path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = `${tenantId}/${timestamp}.enc`;

    // Upload to storage
    const supabase = getStorageClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(archivePath, archivePackage, {
        contentType: 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      logger.error('[TenantArchive] Upload error:', uploadError);
      return { archive: null, error: uploadError.message };
    }

    // Calculate retention expiry (7 years)
    const retentionExpiresAt = new Date();
    retentionExpiresAt.setFullYear(retentionExpiresAt.getFullYear() + RETENTION_YEARS);

    // Store encryption key securely
    // In production, use AWS KMS or Vault
    // For now, store key ID and key in metadata (NOT recommended for production)
    // TODO: Implement proper key management with KMS
    const keyMetadata = {
      keyId,
      key: key.toString('base64'), // TEMPORARY - use KMS in production
    };

    // Create archive record
    const newArchive: NewTenantArchive = {
      tenantId,
      tenantName: archiveData.tenant.name,
      tenantSlug: archiveData.tenant.slug,
      archivePath,
      archiveSizeBytes: archivePackage.length,
      encryptionKeyId: keyId,
      checksumSha256: checksum,
      archivedData: {
        ...archiveData.counts,
        encryptionKeyMeta: keyMetadata, // TEMPORARY - use KMS in production
      },
      deletedBy,
      deletionReason: reason,
      retentionExpiresAt,
    };

    const [archive] = await db.insert(tenantArchives).values(newArchive).returning();

    logger.info(`[TenantArchive] Created archive for tenant ${tenantId}: ${archivePath}`);

    return { archive };
  } catch (error) {
    logger.error('[TenantArchive] Error creating archive:', error);
    return {
      archive: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get archive by tenant ID
 */
export async function getArchiveByTenantId(tenantId: string): Promise<TenantArchive | null> {
  const db = getDb();

  const archive = await db.query.tenantArchives.findFirst({
    where: and(
      eq(tenantArchives.tenantId, tenantId),
      eq(tenantArchives.purgedAt, null as unknown as Date) // Not purged
    ),
  });

  return archive || null;
}

/**
 * Get archive by ID
 */
export async function getArchiveById(archiveId: string): Promise<TenantArchive | null> {
  const db = getDb();

  const archive = await db.query.tenantArchives.findFirst({
    where: eq(tenantArchives.id, archiveId),
  });

  return archive || null;
}

/**
 * Set legal hold on an archive
 */
export async function setLegalHold(
  archiveId: string,
  holdBy: string,
  reason: string,
  holdUntil?: Date
): Promise<TenantArchive | null> {
  const db = getDb();

  const [updated] = await db
    .update(tenantArchives)
    .set({
      legalHold: true,
      legalHoldReason: reason,
      legalHoldBy: holdBy,
      legalHoldAt: new Date(),
      legalHoldUntil: holdUntil,
      updatedAt: new Date(),
    })
    .where(eq(tenantArchives.id, archiveId))
    .returning();

  return updated || null;
}

/**
 * Remove legal hold from an archive
 */
export async function removeLegalHold(archiveId: string): Promise<TenantArchive | null> {
  const db = getDb();

  const [updated] = await db
    .update(tenantArchives)
    .set({
      legalHold: false,
      legalHoldReason: null,
      legalHoldBy: null,
      legalHoldAt: null,
      legalHoldUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(tenantArchives.id, archiveId))
    .returning();

  return updated || null;
}

/**
 * Purge an archive (permanently delete from storage)
 * Only works if:
 * - No legal hold is active
 * - Retention period has expired
 */
export async function purgeArchive(
  archiveId: string,
  force: boolean = false
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  const archive = await getArchiveById(archiveId);
  if (!archive) {
    return { success: false, error: 'Archive not found' };
  }

  if (archive.purgedAt) {
    return { success: false, error: 'Archive already purged' };
  }

  if (archive.legalHold && !force) {
    return { success: false, error: 'Archive is under legal hold' };
  }

  const now = new Date();
  if (archive.retentionExpiresAt > now && !force) {
    return { success: false, error: 'Retention period has not expired' };
  }

  try {
    // Delete from storage
    const supabase = getStorageClient();
    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([archive.archivePath]);

    if (deleteError) {
      logger.error('[TenantArchive] Storage delete error:', deleteError);
      return { success: false, error: deleteError.message };
    }

    // Mark as purged
    await db
      .update(tenantArchives)
      .set({
        purgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenantArchives.id, archiveId));

    logger.info(`[TenantArchive] Purged archive ${archiveId}`);

    return { success: true };
  } catch (error) {
    logger.error('[TenantArchive] Error purging archive:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get archives ready for purge (expired retention, no legal hold)
 */
export async function getArchivesReadyForPurge(): Promise<TenantArchive[]> {
  const db = getDb();
  const now = new Date();

  // Note: This requires a raw SQL query or proper Drizzle filtering
  // For simplicity, we'll fetch and filter in memory
  const archives = await db.query.tenantArchives.findMany({
    where: eq(tenantArchives.legalHold, false),
  });

  return archives.filter(
    (a) => !a.purgedAt && a.retentionExpiresAt <= now
  );
}

export const tenantArchiveService = {
  collectTenantData,
  createTenantArchive,
  getArchiveByTenantId,
  getArchiveById,
  setLegalHold,
  removeLegalHold,
  purgeArchive,
  getArchivesReadyForPurge,
  RETENTION_YEARS,
};
