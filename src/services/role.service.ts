/**
 * Role Service
 *
 * Handles role CRUD and role assignment operations.
 * Per UNIFIED_AUTH_STRATEGY.md Section 8.
 */

import { eq, and, inArray, ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  roles,
  permissions,
  rolePermissions,
  tenantMembers,
  secondaryRoleAssignments,
  auditLogs,
  type Role,
  type NewRole,
} from '../db/schema';
import { invalidatePermissionCache, invalidateRoleCache, ALL_PERMISSIONS } from './permission.service';

/**
 * Generate a URL-safe slug from a role name
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Get all roles in a tenant
 */
export async function getTenantRoles(tenantId: string): Promise<Role[]> {
  const db = getDb();

  return db.query.roles.findMany({
    where: eq(roles.tenantId, tenantId),
    orderBy: (roles, { asc }) => [asc(roles.hierarchyLevel), asc(roles.name)],
  });
}

/**
 * Get a role by ID
 */
export async function getRoleById(roleId: string, tenantId: string): Promise<Role | null> {
  const db = getDb();

  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)),
  });

  return role || null;
}

/**
 * Get a role by slug
 */
export async function getRoleBySlug(slug: string, tenantId: string): Promise<Role | null> {
  const db = getDb();

  const role = await db.query.roles.findFirst({
    where: and(eq(roles.slug, slug), eq(roles.tenantId, tenantId)),
  });

  return role || null;
}

/**
 * Get role permissions
 */
export async function getRolePermissions(roleId: string): Promise<string[]> {
  const db = getDb();

  const perms = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId));

  return perms.map((p) => p.key);
}

/**
 * Get user's hierarchy level in a tenant (lowest = highest privilege)
 */
export async function getUserHierarchyLevel(userId: string, tenantId: string): Promise<number> {
  const db = getDb();

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.status, 'active')
    ),
    with: {
      primaryRole: { columns: { hierarchyLevel: true } },
    },
  });

  if (!membership) {
    return 100; // Lowest privilege
  }

  return membership.primaryRole.hierarchyLevel;
}

/**
 * Check if a role name is reserved
 */
export function isReservedRoleName(name: string): boolean {
  const reserved = ['owner', 'admin', 'system'];
  return reserved.includes(name.toLowerCase().trim());
}

/**
 * Create a custom role
 */
export async function createRole(params: {
  tenantId: string;
  name: string;
  description?: string;
  hierarchyLevel: number;
  permissionKeys: string[];
  createdBy: string;
}): Promise<Role> {
  const db = getDb();
  const { tenantId, name, description, hierarchyLevel, permissionKeys, createdBy } = params;

  const slug = slugify(name);

  // Check for duplicate slug
  const existing = await getRoleBySlug(slug, tenantId);
  if (existing) {
    throw new Error('A role with this name already exists');
  }

  // Create the role
  const [role] = await db
    .insert(roles)
    .values({
      tenantId,
      name,
      slug,
      description,
      hierarchyLevel,
      isSystem: false,
      isProtected: false,
      createdBy,
    })
    .returning();

  // Assign permissions
  if (permissionKeys.length > 0) {
    // Get permission IDs
    const perms = await db.query.permissions.findMany({
      where: inArray(permissions.key, permissionKeys),
    });

    if (perms.length > 0) {
      await db.insert(rolePermissions).values(
        perms.map((p) => ({
          roleId: role.id,
          permissionId: p.id,
          tenantId,
          grantedBy: createdBy,
        }))
      );
    }
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId: createdBy,
    action: 'role_created',
    resourceType: 'role',
    resourceId: role.id,
    details: {
      name: role.name,
      hierarchyLevel: role.hierarchyLevel,
      permissionCount: permissionKeys.length,
    },
    status: 'success',
  });

  return role;
}

/**
 * Update a role
 */
export async function updateRole(params: {
  roleId: string;
  tenantId: string;
  name?: string;
  description?: string;
  hierarchyLevel?: number;
  permissionKeys?: string[];
  updatedBy: string;
}): Promise<Role> {
  const db = getDb();
  const { roleId, tenantId, name, description, hierarchyLevel, permissionKeys, updatedBy } = params;

  // Get existing role
  const existingRole = await getRoleById(roleId, tenantId);
  if (!existingRole) {
    throw new Error('Role not found');
  }

  // Check if role is protected
  if (existingRole.isProtected) {
    throw new Error('Cannot modify protected role');
  }

  // Build update object
  const updates: Partial<NewRole> = {
    updatedAt: new Date(),
  };

  if (name !== undefined) {
    const slug = slugify(name);

    // Check for duplicate slug (excluding current role)
    const duplicate = await db.query.roles.findFirst({
      where: and(
        eq(roles.slug, slug),
        eq(roles.tenantId, tenantId),
        ne(roles.id, roleId)
      ),
    });

    if (duplicate) {
      throw new Error('A role with this name already exists');
    }

    updates.name = name;
    updates.slug = slug;
  }

  if (description !== undefined) {
    updates.description = description;
  }

  if (hierarchyLevel !== undefined) {
    // Cannot set hierarchy to 1 (reserved for Owner)
    if (hierarchyLevel < 2) {
      throw new Error('Hierarchy level must be 2 or higher');
    }
    updates.hierarchyLevel = hierarchyLevel;
  }

  // Update role
  const [updatedRole] = await db
    .update(roles)
    .set(updates)
    .where(eq(roles.id, roleId))
    .returning();

  // Update permissions if provided
  if (permissionKeys !== undefined) {
    // Delete existing permissions
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

    // Add new permissions
    if (permissionKeys.length > 0) {
      const perms = await db.query.permissions.findMany({
        where: inArray(permissions.key, permissionKeys),
      });

      if (perms.length > 0) {
        await db.insert(rolePermissions).values(
          perms.map((p) => ({
            roleId,
            permissionId: p.id,
            tenantId,
            grantedBy: updatedBy,
          }))
        );
      }
    }

    // Invalidate cache for all users with this role
    await invalidateRoleCache(roleId, tenantId);
  }

  // Audit log
  await db.insert(auditLogs).values({
    userId: updatedBy,
    action: 'role_updated',
    resourceType: 'role',
    resourceId: roleId,
    details: {
      name: updatedRole.name,
      changes: Object.keys(updates),
    },
    status: 'success',
  });

  return updatedRole;
}

/**
 * Delete a role
 */
export async function deleteRole(params: {
  roleId: string;
  tenantId: string;
  deletedBy: string;
}): Promise<void> {
  const db = getDb();
  const { roleId, tenantId, deletedBy } = params;

  // Get existing role
  const role = await getRoleById(roleId, tenantId);
  if (!role) {
    throw new Error('Role not found');
  }

  // Check if role is protected
  if (role.isProtected) {
    throw new Error('Cannot delete protected role');
  }

  // Check if any users have this role as primary
  const primaryMembers = await db.query.tenantMembers.findMany({
    where: and(
      eq(tenantMembers.primaryRoleId, roleId),
      eq(tenantMembers.status, 'active')
    ),
    columns: { id: true },
    limit: 1,
  });

  if (primaryMembers.length > 0) {
    throw new Error('Cannot delete role with assigned members');
  }

  // Delete role (cascade will handle rolePermissions and secondaryRoleAssignments)
  await db.delete(roles).where(eq(roles.id, roleId));

  // Audit log
  await db.insert(auditLogs).values({
    userId: deletedBy,
    action: 'role_deleted',
    resourceType: 'role',
    resourceId: roleId,
    details: {
      name: role.name,
    },
    status: 'success',
  });
}

/**
 * Assign primary role to a user
 */
export async function assignPrimaryRole(params: {
  userId: string;
  tenantId: string;
  roleId: string;
  assignedBy: string;
}): Promise<void> {
  const db = getDb();
  const { userId, tenantId, roleId, assignedBy } = params;

  // Verify role exists
  const role = await getRoleById(roleId, tenantId);
  if (!role) {
    throw new Error('Role not found');
  }

  // Get current membership
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId)
    ),
    with: {
      primaryRole: true,
    },
  });

  if (!membership) {
    throw new Error('User is not a member of this tenant');
  }

  // If changing from Owner role, ensure at least one Owner remains
  if (membership.isOwner && membership.primaryRole.slug === 'owner') {
    const otherOwners = await db.query.tenantMembers.findMany({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.isOwner, true),
        eq(tenantMembers.status, 'active'),
        ne(tenantMembers.userId, userId)
      ),
      columns: { id: true },
      limit: 1,
    });

    if (otherOwners.length === 0 && role.slug !== 'owner') {
      throw new Error('Cannot remove the last Owner. Assign another Owner first.');
    }
  }

  const oldRoleId = membership.primaryRoleId;

  // Update primary role
  await db
    .update(tenantMembers)
    .set({
      primaryRoleId: roleId,
      isOwner: role.slug === 'owner',
      updatedAt: new Date(),
    })
    .where(eq(tenantMembers.id, membership.id));

  // Invalidate permission cache
  await invalidatePermissionCache(userId, tenantId);

  // Audit log
  await db.insert(auditLogs).values({
    userId: assignedBy,
    action: 'role_assigned',
    resourceType: 'tenant_member',
    resourceId: membership.id,
    details: {
      targetUserId: userId,
      oldRoleId,
      newRoleId: roleId,
      newRoleName: role.name,
    },
    status: 'success',
  });
}

/**
 * Assign secondary role to a user
 */
export async function assignSecondaryRole(params: {
  userId: string;
  tenantId: string;
  roleId: string;
  expiresAt?: Date;
  reason?: string;
  assignedBy: string;
}): Promise<void> {
  const db = getDb();
  const { userId, tenantId, roleId, expiresAt, reason, assignedBy } = params;

  // Verify role exists
  const role = await getRoleById(roleId, tenantId);
  if (!role) {
    throw new Error('Role not found');
  }

  // Verify user is a tenant member
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.status, 'active')
    ),
  });

  if (!membership) {
    throw new Error('User is not a member of this tenant');
  }

  // Check if secondary role already exists
  const existing = await db.query.secondaryRoleAssignments.findFirst({
    where: and(
      eq(secondaryRoleAssignments.userId, userId),
      eq(secondaryRoleAssignments.tenantId, tenantId),
      eq(secondaryRoleAssignments.roleId, roleId),
      eq(secondaryRoleAssignments.status, 'active')
    ),
  });

  if (existing) {
    throw new Error('User already has this secondary role');
  }

  // Create secondary role assignment
  const [assignment] = await db
    .insert(secondaryRoleAssignments)
    .values({
      userId,
      tenantId,
      roleId,
      expiresAt,
      reason,
      assignedBy,
      status: 'active',
    })
    .returning();

  // Invalidate permission cache
  await invalidatePermissionCache(userId, tenantId);

  // Audit log
  await db.insert(auditLogs).values({
    userId: assignedBy,
    action: 'secondary_role_assigned',
    resourceType: 'secondary_role_assignment',
    resourceId: assignment.id,
    details: {
      targetUserId: userId,
      roleId,
      roleName: role.name,
      expiresAt: expiresAt?.toISOString(),
      reason,
    },
    status: 'success',
  });
}

/**
 * Revoke secondary role from a user
 */
export async function revokeSecondaryRole(params: {
  userId: string;
  tenantId: string;
  roleId: string;
  revokedBy: string;
}): Promise<void> {
  const db = getDb();
  const { userId, tenantId, roleId, revokedBy } = params;

  // Get existing assignment
  const assignment = await db.query.secondaryRoleAssignments.findFirst({
    where: and(
      eq(secondaryRoleAssignments.userId, userId),
      eq(secondaryRoleAssignments.tenantId, tenantId),
      eq(secondaryRoleAssignments.roleId, roleId),
      eq(secondaryRoleAssignments.status, 'active')
    ),
  });

  if (!assignment) {
    throw new Error('Secondary role assignment not found');
  }

  // Update assignment status
  await db
    .update(secondaryRoleAssignments)
    .set({
      status: 'revoked',
      revokedBy,
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(secondaryRoleAssignments.id, assignment.id));

  // Invalidate permission cache
  await invalidatePermissionCache(userId, tenantId);

  // Audit log
  await db.insert(auditLogs).values({
    userId: revokedBy,
    action: 'secondary_role_revoked',
    resourceType: 'secondary_role_assignment',
    resourceId: assignment.id,
    details: {
      targetUserId: userId,
      roleId,
    },
    status: 'success',
  });
}

/**
 * Get members with a specific role
 */
export async function getRoleMembers(roleId: string, tenantId: string): Promise<{
  primaryMembers: Array<{ userId: string; isOwner: boolean }>;
  secondaryMembers: Array<{ userId: string; expiresAt: Date | null }>;
}> {
  const db = getDb();

  const primaryMembers = await db.query.tenantMembers.findMany({
    where: and(
      eq(tenantMembers.primaryRoleId, roleId),
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.status, 'active')
    ),
    columns: { userId: true, isOwner: true },
  });

  const secondaryMembers = await db.query.secondaryRoleAssignments.findMany({
    where: and(
      eq(secondaryRoleAssignments.roleId, roleId),
      eq(secondaryRoleAssignments.tenantId, tenantId),
      eq(secondaryRoleAssignments.status, 'active')
    ),
    columns: { userId: true, expiresAt: true },
  });

  return {
    primaryMembers: primaryMembers.map((m) => ({ userId: m.userId, isOwner: m.isOwner })),
    secondaryMembers: secondaryMembers.map((m) => ({ userId: m.userId, expiresAt: m.expiresAt })),
  };
}

/**
 * Create the protected Owner role with all permissions
 */
export async function createOwnerRole(tenantId: string): Promise<Role> {
  const db = getDb();

  // Get all permissions
  const allPerms = await db.query.permissions.findMany();

  // Create Owner role
  const [ownerRole] = await db
    .insert(roles)
    .values({
      tenantId,
      name: 'Owner',
      slug: 'owner',
      description: 'Full access to all features',
      hierarchyLevel: 1,
      isSystem: true,
      isProtected: true,
      createdBy: null,
    })
    .returning();

  // Assign all permissions
  if (allPerms.length > 0) {
    await db.insert(rolePermissions).values(
      allPerms.map((p) => ({
        roleId: ownerRole.id,
        permissionId: p.id,
        tenantId,
        grantedBy: null,
      }))
    );
  }

  return ownerRole;
}

export const roleService = {
  getTenantRoles,
  getRoleById,
  getRoleBySlug,
  getRolePermissions,
  getUserHierarchyLevel,
  isReservedRoleName,
  createRole,
  updateRole,
  deleteRole,
  assignPrimaryRole,
  assignSecondaryRole,
  revokeSecondaryRole,
  getRoleMembers,
  createOwnerRole,
};
