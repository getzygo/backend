/**
 * Company Logo Service
 *
 * Handles company logo storage operations with tenant isolation and obfuscated filenames.
 * Follows the same pattern as avatar.service.ts:
 * - All logos stored with random UUIDs: logos/{tenantId}/{random-uuid}.{ext}
 * - Filenames are unpredictable - can't guess paths even with Supabase access
 * - No signed URLs exposed - logos served only via authenticated API endpoint
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getEnv } from '../config/env';

const BUCKET_NAME = 'logos';

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
 * Extract storage path from a Supabase storage URL or return path as-is
 * e.g., "https://db.zygo.tech/storage/v1/object/public/logos/tenant-id/abc123.jpg"
 * -> "tenant-id/abc123.jpg"
 */
export function extractLogoStoragePath(url: string): string | null {
  if (!url) return null;

  // Match pattern: /logos/path/to/file
  const match = url.match(/\/logos\/(.+)$/);
  if (match) {
    return match[1];
  }

  // If URL doesn't match storage pattern, it might already be a path
  if (!url.startsWith('http')) {
    return url;
  }

  return null;
}

/**
 * Upload company logo directly from buffer/file
 * Uses service role to bypass RLS
 * Storage path: {tenantId}/{random-uuid}.{ext} (obfuscated - can't guess)
 */
export async function uploadCompanyLogo(
  tenantId: string,
  buffer: ArrayBuffer | Buffer,
  contentType: string = 'image/jpeg'
): Promise<{ path: string; error?: string }> {
  try {
    // Determine file extension
    let extension = 'jpg';
    if (contentType.includes('png')) extension = 'png';
    else if (contentType.includes('gif')) extension = 'gif';
    else if (contentType.includes('webp')) extension = 'webp';

    // Generate obfuscated storage path with random UUID
    // Format: {tenantId}/{random-uuid}.{ext}
    // This is unpredictable - can't guess the path
    const fileName = `${tenantId}/${randomUUID()}.${extension}`;

    // Upload to Supabase Storage using service role
    const supabase = getStorageClient();
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType,
        upsert: false, // Don't upsert - always create new with unique UUID
      });

    if (error) {
      console.error('[CompanyLogoService] Upload error:', error);
      return { path: '', error: error.message };
    }

    console.log(`[CompanyLogoService] Logo uploaded with obfuscated path for tenant ${tenantId}`);
    return { path: data.path };
  } catch (error) {
    console.error('[CompanyLogoService] Error uploading logo:', error);
    return {
      path: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete a company logo file by its path
 */
export async function deleteCompanyLogoByPath(path: string): Promise<void> {
  if (!path) return;

  try {
    const supabase = getStorageClient();
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([path]);

    if (error) {
      console.error('[CompanyLogoService] Error deleting logo:', error);
    }
  } catch (error) {
    console.error('[CompanyLogoService] Error in delete:', error);
  }
}

/**
 * Get company logo file as binary data for streaming
 * This is used by the private logo endpoint to serve files without exposing signed URLs
 */
export async function getCompanyLogoFile(
  storagePath: string
): Promise<{ data: Blob | null; contentType: string; error?: string }> {
  try {
    const supabase = getStorageClient();

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(storagePath);

    if (error) {
      console.error('[CompanyLogoService] Download error:', error);
      return { data: null, contentType: '', error: error.message };
    }

    // Determine content type from path
    let contentType = 'image/jpeg';
    if (storagePath.endsWith('.png')) contentType = 'image/png';
    else if (storagePath.endsWith('.gif')) contentType = 'image/gif';
    else if (storagePath.endsWith('.webp')) contentType = 'image/webp';

    return { data, contentType };
  } catch (error) {
    console.error('[CompanyLogoService] Error getting logo file:', error);
    return {
      data: null,
      contentType: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate that a storage path belongs to a specific tenant
 * Path format: {tenantId}/{random-uuid}.{ext}
 */
export function validateLogoPathTenant(storagePath: string, tenantId: string): boolean {
  if (!storagePath || !tenantId) return false;
  return storagePath.startsWith(`${tenantId}/`);
}

export const companyLogoService = {
  extractLogoStoragePath,
  uploadCompanyLogo,
  deleteCompanyLogoByPath,
  getCompanyLogoFile,
  validateLogoPathTenant,
};
