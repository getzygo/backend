/**
 * Avatar Service
 *
 * Handles avatar storage operations:
 * - Downloading external avatars (OAuth) to private storage
 * - Generating signed URLs for private avatars
 */

import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env';

const BUCKET_NAME = 'avatars';
const SIGNED_URL_EXPIRY = 604800; // 7 days in seconds

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
  return !url.includes(env.SUPABASE_URL!) && !url.includes('db.zygo.tech');
}

/**
 * Download an external avatar and store it in our private storage
 * Returns the storage path (not a public URL)
 */
export async function downloadAndStoreAvatar(
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

    // Generate storage path
    const fileName = `${userId}/avatar-${Date.now()}.${extension}`;

    // Upload to Supabase Storage
    const supabase = getStorageClient();
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error('[AvatarService] Upload error:', error);
      return { path: '', error: error.message };
    }

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
 * Generate a signed URL for a private avatar
 * @param storagePath - The path in storage (e.g., "user-id/avatar-123.jpg")
 * @param expiresIn - Expiry time in seconds (default 1 hour)
 */
export async function getSignedAvatarUrl(
  storagePath: string,
  expiresIn: number = SIGNED_URL_EXPIRY
): Promise<{ url: string; error?: string }> {
  try {
    const supabase = getStorageClient();

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storagePath, expiresIn);

    if (error) {
      console.error('[AvatarService] Signed URL error:', error);
      return { url: '', error: error.message };
    }

    return { url: data.signedUrl };
  } catch (error) {
    console.error('[AvatarService] Error creating signed URL:', error);
    return {
      url: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Extract storage path from a Supabase storage URL
 * e.g., "https://db.zygo.tech/storage/v1/object/public/avatars/user-id/avatar.jpg"
 * -> "user-id/avatar.jpg"
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
 * Delete old avatars for a user (cleanup)
 */
export async function deleteOldAvatars(
  userId: string,
  keepPath?: string
): Promise<void> {
  try {
    const supabase = getStorageClient();

    // List all files in user's folder
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(userId);

    if (listError || !files) {
      console.error('[AvatarService] Error listing files:', listError);
      return;
    }

    // Filter out the file to keep
    const filesToDelete = files
      .filter((f) => !keepPath || `${userId}/${f.name}` !== keepPath)
      .map((f) => `${userId}/${f.name}`);

    if (filesToDelete.length > 0) {
      const { error: deleteError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove(filesToDelete);

      if (deleteError) {
        console.error('[AvatarService] Error deleting old files:', deleteError);
      }
    }
  } catch (error) {
    console.error('[AvatarService] Error in cleanup:', error);
  }
}

export const avatarService = {
  isExternalAvatarUrl,
  downloadAndStoreAvatar,
  getSignedAvatarUrl,
  extractStoragePath,
  deleteOldAvatars,
};
