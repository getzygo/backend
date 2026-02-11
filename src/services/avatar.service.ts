/**
 * Avatar Service
 *
 * Handles avatar storage operations with tenant isolation and obfuscated filenames:
 * - All avatars stored with random UUIDs: {tenantId}/{random-uuid}.{ext}
 * - Filenames are unpredictable - can't guess paths even with Supabase access
 * - No signed URLs exposed - avatars served only via authenticated API endpoint
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getEnv } from '../config/env';

const BUCKET_NAME = 'avatars';

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
 * Check if a URL is an external avatar (not our storage)
 */
export function isExternalAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const env = getEnv();
  // External if not from our Supabase storage
  return !url.includes(env.SUPABASE_URL!) && !url.includes('localhost:8000');
}

/**
 * Download an external avatar and store it in our private storage
 * Returns the storage path (not a public URL)
 * Storage path: {tenantId}/{random-uuid}.{ext} (obfuscated - can't guess)
 */
export async function downloadAndStoreAvatar(
  tenantId: string,
  userId: string,
  externalUrl: string
): Promise<{ path: string; error?: string }> {
  try {
    // Fetch the external image
    const response = await fetch(externalUrl, {
      headers: {
        'User-Agent': 'Zygo-Avatar-Service/1.0',
      },
    });

    if (!response.ok) {
      return { path: '', error: `Failed to fetch avatar: ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    // Determine file extension
    let extension = 'jpg';
    if (contentType.includes('png')) extension = 'png';
    else if (contentType.includes('gif')) extension = 'gif';
    else if (contentType.includes('webp')) extension = 'webp';

    // Generate obfuscated storage path with random UUID
    // Format: {tenantId}/{random-uuid}.{ext}
    // This is unpredictable - can't guess the path from userId
    const fileName = `${tenantId}/${randomUUID()}.${extension}`;

    // Upload to Supabase Storage
    const supabase = getStorageClient();
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType,
        upsert: false, // Don't upsert - always create new
      });

    if (error) {
      console.error('[AvatarService] Upload error:', error);
      return { path: '', error: error.message };
    }

    console.log(`[AvatarService] Avatar stored with obfuscated path for user ${userId}`);
    return { path: data.path };
  } catch (error) {
    console.error('[AvatarService] Error downloading avatar:', error);
    return {
      path: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Extract storage path from a Supabase storage URL or return path as-is
 * e.g., "https://db.zygo.tech/storage/v1/object/public/avatars/tenant-id/abc123.jpg"
 * -> "tenant-id/abc123.jpg"
 */
export function extractStoragePath(url: string): string | null {
  if (!url) return null;

  // Match pattern: /avatars/path/to/file
  const match = url.match(/\/avatars\/(.+)$/);
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
 * Upload avatar directly from buffer/file
 * Uses service role to bypass RLS
 * Storage path: {tenantId}/{random-uuid}.{ext} (obfuscated - can't guess)
 */
export async function uploadAvatar(
  tenantId: string,
  userId: string,
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
    // This is unpredictable - can't guess the path from userId
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
      console.error('[AvatarService] Upload error:', error);
      return { path: '', error: error.message };
    }

    console.log(`[AvatarService] Avatar uploaded with obfuscated path for user ${userId}`);
    return { path: data.path };
  } catch (error) {
    console.error('[AvatarService] Error uploading avatar:', error);
    return {
      path: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete an avatar file by its path
 */
export async function deleteAvatarByPath(path: string): Promise<void> {
  if (!path) return;

  try {
    const supabase = getStorageClient();
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([path]);

    if (error) {
      console.error('[AvatarService] Error deleting avatar:', error);
    }
  } catch (error) {
    console.error('[AvatarService] Error in delete:', error);
  }
}

/**
 * Get avatar file as binary data for streaming
 * This is used by the private avatar endpoint to serve files without exposing signed URLs
 */
export async function getAvatarFile(
  storagePath: string
): Promise<{ data: Blob | null; contentType: string; error?: string }> {
  try {
    const supabase = getStorageClient();

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(storagePath);

    if (error) {
      console.error('[AvatarService] Download error:', error);
      return { data: null, contentType: '', error: error.message };
    }

    // Determine content type from path
    let contentType = 'image/jpeg';
    if (storagePath.endsWith('.png')) contentType = 'image/png';
    else if (storagePath.endsWith('.gif')) contentType = 'image/gif';
    else if (storagePath.endsWith('.webp')) contentType = 'image/webp';

    return { data, contentType };
  } catch (error) {
    console.error('[AvatarService] Error getting avatar file:', error);
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
export function validateAvatarPathTenant(storagePath: string, tenantId: string): boolean {
  if (!storagePath || !tenantId) return false;
  return storagePath.startsWith(`${tenantId}/`);
}

export const avatarService = {
  isExternalAvatarUrl,
  downloadAndStoreAvatar,
  uploadAvatar,
  extractStoragePath,
  deleteAvatarByPath,
  getAvatarFile,
  validateAvatarPathTenant,
};
