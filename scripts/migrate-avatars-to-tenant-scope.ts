/**
 * Avatar Migration Script
 *
 * Migrates existing avatars from old path format to tenant-scoped paths:
 * - Old: {userId}/avatar-{timestamp}.{ext}
 * - New: {tenantId}/{userId}/avatar-{timestamp}.{ext}
 *
 * Also deletes the old files to prevent access via old signed URLs.
 *
 * Usage:
 *   npx tsx scripts/migrate-avatars-to-tenant-scope.ts
 *
 * Dry run (preview only):
 *   DRY_RUN=true npx tsx scripts/migrate-avatars-to-tenant-scope.ts
 */

import { createClient } from '@supabase/supabase-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, isNotNull, sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';

// Load environment
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DATABASE_URL = process.env.DATABASE_URL!;

const BUCKET_NAME = 'avatars';
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATABASE_URL) {
  console.error('Missing required environment variables');
  process.exit(1);
}

// Initialize clients
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const queryClient = postgres(DATABASE_URL);
const db = drizzle(queryClient);

interface UserWithAvatar {
  id: string;
  avatarUrl: string | null;
  email: string;
}

interface TenantMembership {
  tenantId: string;
  tenantSlug: string;
}

async function getUsersWithAvatars(): Promise<UserWithAvatar[]> {
  const result = await db.execute(sql`
    SELECT id, avatar_url, email
    FROM users
    WHERE avatar_url IS NOT NULL
      AND avatar_url != ''
      AND status != 'deleted'
  `);
  return result as unknown as UserWithAvatar[];
}

async function getUserPrimaryTenant(userId: string): Promise<TenantMembership | null> {
  const result = await db.execute(sql`
    SELECT tm.tenant_id as "tenantId", t.slug as "tenantSlug"
    FROM tenant_members tm
    JOIN tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = ${userId}
      AND tm.status = 'active'
      AND t.status = 'active'
    ORDER BY tm.is_owner DESC, tm.joined_at ASC
    LIMIT 1
  `);
  const rows = result as unknown as TenantMembership[];
  return rows[0] || null;
}

function isAlreadyTenantScoped(path: string): boolean {
  // New format: {tenantId}/{userId}/avatar-{timestamp}.{ext}
  // Has two UUIDs before the filename
  const parts = path.split('/');
  if (parts.length < 3) return false;

  // Check if first two parts look like UUIDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(parts[0]) && uuidRegex.test(parts[1]);
}

function extractStoragePath(avatarUrl: string): string | null {
  if (!avatarUrl) return null;

  // Match pattern: /avatars/path/to/file
  const match = avatarUrl.match(/\/avatars\/(.+?)(?:\?|$)/);
  if (match) {
    return match[1];
  }

  // If URL doesn't match storage pattern, it might already be a path
  if (!avatarUrl.startsWith('http')) {
    return avatarUrl;
  }

  return null;
}

async function migrateAvatar(
  user: UserWithAvatar,
  tenant: TenantMembership
): Promise<{ success: boolean; oldPath: string; newPath?: string; error?: string }> {
  const oldPath = extractStoragePath(user.avatarUrl!);
  if (!oldPath) {
    return { success: false, oldPath: user.avatarUrl!, error: 'Could not extract storage path' };
  }

  // Check if already migrated
  if (isAlreadyTenantScoped(oldPath)) {
    return { success: true, oldPath, newPath: oldPath, error: 'Already tenant-scoped' };
  }

  // Build new path
  const filename = oldPath.split('/').pop()!;
  const newPath = `${tenant.tenantId}/${user.id}/${filename}`;

  if (DRY_RUN) {
    return { success: true, oldPath, newPath, error: 'DRY RUN - no changes made' };
  }

  try {
    // Download the file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET_NAME)
      .download(oldPath);

    if (downloadError || !fileData) {
      return { success: false, oldPath, error: `Download failed: ${downloadError?.message}` };
    }

    // Determine content type
    let contentType = 'image/jpeg';
    if (oldPath.endsWith('.png')) contentType = 'image/png';
    else if (oldPath.endsWith('.gif')) contentType = 'image/gif';
    else if (oldPath.endsWith('.webp')) contentType = 'image/webp';

    // Upload to new location
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(newPath, fileData, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      return { success: false, oldPath, newPath, error: `Upload failed: ${uploadError.message}` };
    }

    // Update user record
    await db.execute(sql`
      UPDATE users
      SET avatar_url = ${newPath}, updated_at = NOW()
      WHERE id = ${user.id}
    `);

    // Delete old file
    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([oldPath]);

    if (deleteError) {
      console.warn(`  Warning: Could not delete old file ${oldPath}: ${deleteError.message}`);
    }

    return { success: true, oldPath, newPath };
  } catch (error) {
    return {
      success: false,
      oldPath,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Avatar Migration to Tenant-Scoped Paths');
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('\n*** DRY RUN MODE - No changes will be made ***\n');
  }

  // Get all users with avatars
  console.log('\nFetching users with avatars...');
  const users = await getUsersWithAvatars();
  console.log(`Found ${users.length} users with avatars\n`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let alreadyMigrated = 0;

  for (const user of users) {
    console.log(`Processing: ${user.email}`);

    // Get user's primary tenant
    const tenant = await getUserPrimaryTenant(user.id);

    if (!tenant) {
      console.log(`  SKIPPED: No active tenant membership`);
      skipped++;
      continue;
    }

    const result = await migrateAvatar(user, tenant);

    if (result.error === 'Already tenant-scoped') {
      console.log(`  ALREADY MIGRATED: ${result.oldPath}`);
      alreadyMigrated++;
    } else if (result.success) {
      console.log(`  MIGRATED: ${result.oldPath} -> ${result.newPath}`);
      migrated++;
    } else {
      console.log(`  FAILED: ${result.error}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));
  console.log(`Total users:      ${users.length}`);
  console.log(`Migrated:         ${migrated}`);
  console.log(`Already migrated: ${alreadyMigrated}`);
  console.log(`Skipped:          ${skipped}`);
  console.log(`Failed:           ${failed}`);

  if (DRY_RUN) {
    console.log('\n*** This was a DRY RUN - run without DRY_RUN=true to apply changes ***');
  }

  await queryClient.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
