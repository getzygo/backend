# Avatar System

## Overview

The Zygo avatar system provides secure, tenant-scoped avatar storage with complete privacy. Avatars are never exposed via public URLs - they are served only through authenticated API endpoints.

## Security Model

### Key Principles

1. **No Public URLs**: Avatars are never accessible via direct URLs. No signed URLs are exposed in API responses.
2. **Tenant Isolation**: All avatars are stored in tenant-scoped paths and validated on access.
3. **Obfuscated Paths**: Storage paths use random UUIDs, making them impossible to guess.
4. **Authentication Required**: All avatar endpoints require valid JWT authentication.

### Storage Path Format

```
{tenantId}/{random-uuid}.{extension}
```

Example: `3ebb2dbd-ff5e-4036-90df-54642c86b30e/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg`

- `tenantId`: The tenant's UUID
- `random-uuid`: A cryptographically random UUID (not derived from userId)
- `extension`: jpg, png, gif, or webp

## API Endpoints

### Upload Avatar

```
POST /api/v1/users/me/avatar
Content-Type: multipart/form-data

Headers:
  Authorization: Bearer <token>
  X-Zygo-Tenant-Slug: <tenant-slug>

Body:
  avatar: <file>
```

**Response:**
```json
{
  "success": true,
  "has_avatar": true
}
```

Note: No URL is returned. The frontend fetches the avatar via the file endpoint.

**Constraints:**
- Max file size: 5MB
- Allowed types: JPEG, PNG, GIF, WebP

### Get Avatar File (Current User)

```
GET /api/v1/users/me/avatar/file

Headers:
  Authorization: Bearer <token>
  X-Zygo-Tenant-Slug: <tenant-slug>
```

**Response:** Binary image data with appropriate Content-Type header.

**Cache Control:** `private, no-cache, must-revalidate`

### Get Avatar File (Any User in Tenant)

```
GET /api/v1/users/{userId}/avatar/file

Headers:
  Authorization: Bearer <token>
  X-Zygo-Tenant-Slug: <tenant-slug>
```

**Security:** Only users within the same tenant can access each other's avatars.

## Frontend Implementation

### Fetching Avatars

Since avatars require authentication, they cannot be loaded via `<img src="url">`. Instead:

1. Fetch the avatar via `authFetch()` with proper headers
2. Convert the response to a Blob
3. Create a Blob URL for use in `<img>` tags

```typescript
// tokenManager.ts
export async function fetchAvatarBlobUrl(userId?: string, forceRefresh = false): Promise<string | null> {
  const endpoint = forceRefresh
    ? `/users/me/avatar/file?_=${Date.now()}`  // Cache buster
    : '/users/me/avatar/file';

  const response = await authFetch(endpoint);
  if (!response.ok) return null;

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
```

### Cross-Component Refresh

When a user uploads a new avatar, all components displaying it need to refresh. This is handled via AuthContext:

```typescript
// AuthContext.tsx
interface AuthContextType {
  // ... other fields
  avatarVersion: number;        // Increments on avatar change
  invalidateAvatar: () => void; // Call after upload
}

// Profile.tsx - After successful upload
invalidateAvatar();

// Header.tsx - Watch for changes
const { user, avatarVersion } = useAuth();

useEffect(() => {
  if (user?.hasAvatar) {
    const forceRefresh = avatarVersion > 0;
    fetchAvatarBlobUrl(undefined, forceRefresh).then(url => {
      if (url) setAvatarUrl(url);
    });
  }
}, [user?.hasAvatar, avatarVersion]);
```

### Memory Management

Blob URLs consume memory. Always revoke them when no longer needed:

```typescript
export function clearAvatarCache(): void {
  avatarBlobCache.forEach(({ url }) => URL.revokeObjectURL(url));
  avatarBlobCache.clear();
}
```

## Backend Implementation

### Avatar Service (`src/services/avatar.service.ts`)

```typescript
// Upload with obfuscated path
export async function uploadAvatar(
  tenantId: string,
  userId: string,
  buffer: ArrayBuffer | Buffer,
  contentType: string
): Promise<{ path: string; error?: string }>

// Download for streaming
export async function getAvatarFile(
  storagePath: string
): Promise<{ data: Blob | null; contentType: string; error?: string }>

// Validate tenant ownership
export function validateAvatarPathTenant(
  storagePath: string,
  tenantId: string
): boolean

// Delete avatar
export async function deleteAvatarByPath(path: string): Promise<void>
```

### User Routes (`src/routes/users.routes.ts`)

The avatar endpoints use these middleware:
- `authMiddleware`: Validates JWT token
- `tenantMiddleware`: Extracts tenant from header/subdomain
- `requireTenantMembership`: Ensures user is a member of the tenant

## Database Schema

```sql
-- users table
avatar_url TEXT,           -- Storage path (not a URL!)
avatar_source VARCHAR(10)  -- 'upload' or 'oauth'
```

The `avatar_url` field stores the storage path, not a URL. Example:
```
3ebb2dbd-ff5e-4036-90df-54642c86b30e/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg
```

## Migration from Legacy Paths

If migrating from public URLs or non-tenant-scoped paths, use:

```bash
npx tsx scripts/migrate-avatars-to-tenant-scope.ts

# Dry run first
DRY_RUN=true npx tsx scripts/migrate-avatars-to-tenant-scope.ts
```

## Security Considerations

1. **No Enumeration**: Random UUIDs prevent guessing avatar paths even with Supabase access.
2. **Tenant Validation**: Backend validates that the avatar path starts with the correct tenant ID.
3. **No Signed URLs**: Unlike typical Supabase storage, we never expose signed URLs to clients.
4. **Service Role**: Backend uses Supabase service role key to bypass RLS for storage operations.

## Troubleshooting

### Avatar not updating after upload
- Check that `invalidateAvatar()` is called after upload
- Verify `avatarVersion` is incrementing in React DevTools
- Check browser network tab for cache-busting query parameter

### 404 on avatar fetch
- Verify user has `has_avatar: true` in profile response
- Check `X-Zygo-Tenant-Slug` header is being sent
- Verify tenant membership

### Old avatar still showing
- Clear avatar cache: `clearAvatarCache()`
- Force refresh: `fetchAvatarBlobUrl(undefined, true)`
- Check Cloudflare cache (purge if needed)
