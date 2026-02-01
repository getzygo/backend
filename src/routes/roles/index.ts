/**
 * Role Management Routes
 *
 * GET /api/v1/roles - List roles in tenant
 * POST /api/v1/roles - Create custom role
 * GET /api/v1/roles/:id - Get role details
 * PATCH /api/v1/roles/:id - Update role
 * DELETE /api/v1/roles/:id - Delete role
 * GET /api/v1/roles/:id/members - Get role members
 * POST /api/v1/roles/:id/members - Assign role to user
 * DELETE /api/v1/roles/:id/members/:userId - Remove role from user
 *
 * Per UNIFIED_AUTH_STRATEGY.md Section 8.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  getTenantRoles,
  getRoleById,
  getRolePermissions,
  getUserHierarchyLevel,
  isReservedRoleName,
  createRole,
  updateRole,
  deleteRole,
  getRoleMembers,
  assignPrimaryRole,
  assignSecondaryRole,
  revokeSecondaryRole,
} from '../../services/role.service';
import { hasPermission, ALL_PERMISSION_KEYS, ALL_PERMISSIONS, getPermissionsByCategory } from '../../services/permission.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { tenantMiddleware, requireTenantMembership } from '../../middleware/tenant.middleware';

const app = new Hono();

// Apply middleware - all role routes require auth + tenant context + membership
app.use('*', authMiddleware);
app.use('*', tenantMiddleware);
app.use('*', requireTenantMembership);

// Create role schema
const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  hierarchy_level: z.number().int().min(2).max(100),
  permissions: z.array(z.string()).optional().default([]),
});

// Update role schema
const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  hierarchy_level: z.number().int().min(2).max(100).optional(),
  permissions: z.array(z.string()).optional(),
});

// Assign role schema
const assignRoleSchema = z.object({
  user_id: z.string().uuid(),
  role_type: z.enum(['primary', 'secondary']).default('primary'),
  expires_at: z.string().datetime().optional(),
  reason: z.string().max(500).optional(),
});

/**
 * GET /api/v1/roles
 * List all roles in the current tenant
 */
app.get('/', async (c) => {
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');

  // Check permission
  const canView = await hasPermission(userId, tenantId, 'canViewRoles');
  if (!canView) {
    return c.json({ error: 'forbidden', message: 'Permission denied' }, 403);
  }

  const roles = await getTenantRoles(tenantId);

  // Get permissions for each role
  const rolesWithPermissions = await Promise.all(
    roles.map(async (role) => {
      const permissions = await getRolePermissions(role.id);
      return {
        id: role.id,
        name: role.name,
        slug: role.slug,
        description: role.description,
        hierarchy_level: role.hierarchyLevel,
        is_system: role.isSystem,
        is_protected: role.isProtected,
        permission_count: permissions.length,
        created_at: role.createdAt,
        updated_at: role.updatedAt,
      };
    })
  );

  return c.json({ roles: rolesWithPermissions });
});

/**
 * POST /api/v1/roles
 * Create a new custom role
 */
app.post('/', zValidator('json', createRoleSchema), async (c) => {
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');
  const body = c.req.valid('json');

  // Check permission
  const canManage = await hasPermission(userId, tenantId, 'canManageRoles');
  if (!canManage) {
    return c.json({ error: 'forbidden', message: 'Permission denied' }, 403);
  }

  // Check hierarchy - can only create roles with lower privilege than own
  const userHierarchy = await getUserHierarchyLevel(userId, tenantId);
  if (body.hierarchy_level <= userHierarchy) {
    return c.json(
      {
        error: 'hierarchy_violation',
        message: `Cannot create role with hierarchy ${body.hierarchy_level}. Your level is ${userHierarchy}.`,
      },
      403
    );
  }

  // Check for reserved names
  if (isReservedRoleName(body.name)) {
    return c.json(
      {
        error: 'reserved_name',
        message: 'This role name is reserved',
      },
      400
    );
  }

  // Validate permission keys
  const invalidPermissions = body.permissions.filter((p) => !ALL_PERMISSION_KEYS.has(p));
  if (invalidPermissions.length > 0) {
    return c.json(
      {
        error: 'invalid_permissions',
        message: `Invalid permissions: ${invalidPermissions.join(', ')}`,
      },
      400
    );
  }

  try {
    const role = await createRole({
      tenantId,
      name: body.name,
      description: body.description,
      hierarchyLevel: body.hierarchy_level,
      permissionKeys: body.permissions,
      createdBy: userId,
    });

    return c.json(
      {
        role: {
          id: role.id,
          name: role.name,
          slug: role.slug,
          description: role.description,
          hierarchy_level: role.hierarchyLevel,
          is_system: role.isSystem,
          is_protected: role.isProtected,
          permission_count: body.permissions.length,
          created_at: role.createdAt,
        },
      },
      201
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create role';
    return c.json({ error: 'create_failed', message }, 400);
  }
});

/**
 * GET /api/v1/roles/:id
 * Get role details including permissions
 */
app.get('/:id', async (c) => {
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');
  const roleId = c.req.param('id');

  // Check permission
  const canView = await hasPermission(userId, tenantId, 'canViewRoles');
  if (!canView) {
    return c.json({ error: 'forbidden', message: 'Permission denied' }, 403);
  }

  const role = await getRoleById(roleId, tenantId);
  if (!role) {
    return c.json({ error: 'not_found', message: 'Role not found' }, 404);
  }

  const permissions = await getRolePermissions(roleId);
  const members = await getRoleMembers(roleId, tenantId);

  return c.json({
    role: {
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      hierarchy_level: role.hierarchyLevel,
      is_system: role.isSystem,
      is_protected: role.isProtected,
      permissions,
      member_count: members.primaryMembers.length + members.secondaryMembers.length,
      created_at: role.createdAt,
      updated_at: role.updatedAt,
    },
  });
});

/**
 * PATCH /api/v1/roles/:id
 * Update a role
 */
app.patch('/:id', zValidator('json', updateRoleSchema), async (c) => {
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');
  const roleId = c.req.param('id');
  const body = c.req.valid('json');

  // Check permission
  const canManage = await hasPermission(userId, tenantId, 'canManageRoles');
  if (!canManage) {
    return c.json({ error: 'forbidden', message: 'Permission denied' }, 403);
  }

  // Get existing role
  const existingRole = await getRoleById(roleId, tenantId);
  if (!existingRole) {
    return c.json({ error: 'not_found', message: 'Role not found' }, 404);
  }

  // Check if role is protected
  if (existingRole.isProtected) {
    return c.json(
      {
        error: 'protected_role',
        message: 'Cannot modify protected role',
      },
      403
    );
  }

  // Check hierarchy - can only modify roles with lower privilege than own
  const userHierarchy = await getUserHierarchyLevel(userId, tenantId);
  if (existingRole.hierarchyLevel <= userHierarchy) {
    return c.json(
      {
        error: 'hierarchy_violation',
        message: 'Cannot modify role above your hierarchy level',
      },
      403
    );
  }

  // If changing hierarchy, validate new level
  if (body.hierarchy_level !== undefined && body.hierarchy_level <= userHierarchy) {
    return c.json(
      {
        error: 'hierarchy_violation',
        message: `Cannot set role hierarchy to ${body.hierarchy_level}. Your level is ${userHierarchy}.`,
      },
      403
    );
  }

  // Check for reserved names if renaming
  if (body.name && isReservedRoleName(body.name)) {
    return c.json(
      {
        error: 'reserved_name',
        message: 'This role name is reserved',
      },
      400
    );
  }

  // Validate permission keys if provided
  if (body.permissions) {
    const invalidPermissions = body.permissions.filter((p) => !ALL_PERMISSION_KEYS.has(p));
    if (invalidPermissions.length > 0) {
      return c.json(
        {
          error: 'invalid_permissions',
          message: `Invalid permissions: ${invalidPermissions.join(', ')}`,
        },
        400
      );
    }
  }

  try {
    const role = await updateRole({
      roleId,
      tenantId,
      name: body.name,
      description: body.description,
      hierarchyLevel: body.hierarchy_level,
      permissionKeys: body.permissions,
      updatedBy: userId,
    });

    const permissions = await getRolePermissions(roleId);

    return c.json({
      role: {
        id: role.id,
        name: role.name,
        slug: role.slug,
        description: role.description,
        hierarchy_level: role.hierarchyLevel,
        is_system: role.isSystem,
        is_protected: role.isProtected,
        permissions,
        updated_at: role.updatedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update role';
    return c.json({ error: 'update_failed', message }, 400);
  }
});

/**
 * DELETE /api/v1/roles/:id
 * Delete a role
 */
app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');
  const roleId = c.req.param('id');

  // Check permission
  const canManage = await hasPermission(userId, tenantId, 'canManageRoles');
  if (!canManage) {
    return c.json({ error: 'forbidden', message: 'Permission denied' }, 403);
  }

  // Get existing role
  const existingRole = await getRoleById(roleId, tenantId);
  if (!existingRole) {
    return c.json({ error: 'not_found', message: 'Role not found' }, 404);
  }

  // Check if role is protected
  if (existingRole.isProtected) {
    return c.json(
      {
        error: 'protected_role',
        message: 'Cannot delete protected role',
      },
      403
    );
  }

  // Check hierarchy
  const userHierarchy = await getUserHierarchyLevel(userId, tenantId);
  if (existingRole.hierarchyLevel <= userHierarchy) {
    return c.json(
      {
        error: 'hierarchy_violation',
        message: 'Cannot delete role above your hierarchy level',
      },
      403
    );
  }

  try {
    await deleteRole({
      roleId,
      tenantId,
      deletedBy: userId,
    });

    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete role';
    return c.json({ error: 'delete_failed', message }, 400);
  }
});

/**
 * GET /api/v1/roles/:id/members
 * Get members assigned to a role
 */
app.get('/:id/members', async (c) => {
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');
  const roleId = c.req.param('id');

  // Check permission
  const canView = await hasPermission(userId, tenantId, 'canViewRoles');
  if (!canView) {
    return c.json({ error: 'forbidden', message: 'Permission denied' }, 403);
  }

  const role = await getRoleById(roleId, tenantId);
  if (!role) {
    return c.json({ error: 'not_found', message: 'Role not found' }, 404);
  }

  const members = await getRoleMembers(roleId, tenantId);

  return c.json({
    role_id: roleId,
    role_name: role.name,
    primary_members: members.primaryMembers,
    secondary_members: members.secondaryMembers,
  });
});

/**
 * POST /api/v1/roles/:id/members
 * Assign role to a user
 */
app.post('/:id/members', zValidator('json', assignRoleSchema), async (c) => {
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');
  const roleId = c.req.param('id');
  const body = c.req.valid('json');

  // Check permission
  const canAssign = await hasPermission(userId, tenantId, 'canAssignRoles');
  if (!canAssign) {
    return c.json({ error: 'forbidden', message: 'Permission denied' }, 403);
  }

  // Get role
  const role = await getRoleById(roleId, tenantId);
  if (!role) {
    return c.json({ error: 'not_found', message: 'Role not found' }, 404);
  }

  // Check hierarchy
  const userHierarchy = await getUserHierarchyLevel(userId, tenantId);
  if (role.hierarchyLevel <= userHierarchy) {
    return c.json(
      {
        error: 'hierarchy_violation',
        message: 'Cannot assign role above your hierarchy level',
      },
      403
    );
  }

  try {
    if (body.role_type === 'primary') {
      await assignPrimaryRole({
        userId: body.user_id,
        tenantId,
        roleId,
        assignedBy: userId,
      });
    } else {
      await assignSecondaryRole({
        userId: body.user_id,
        tenantId,
        roleId,
        expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
        reason: body.reason,
        assignedBy: userId,
      });
    }

    return c.json({
      success: true,
      message: `Role ${role.name} assigned to user`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to assign role';
    return c.json({ error: 'assign_failed', message }, 400);
  }
});

/**
 * DELETE /api/v1/roles/:id/members/:userId
 * Remove role from a user (secondary roles only)
 */
app.delete('/:id/members/:targetUserId', async (c) => {
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');
  const roleId = c.req.param('id');
  const targetUserId = c.req.param('targetUserId');

  // Check permission
  const canAssign = await hasPermission(userId, tenantId, 'canAssignRoles');
  if (!canAssign) {
    return c.json({ error: 'forbidden', message: 'Permission denied' }, 403);
  }

  // Get role
  const role = await getRoleById(roleId, tenantId);
  if (!role) {
    return c.json({ error: 'not_found', message: 'Role not found' }, 404);
  }

  // Check hierarchy
  const userHierarchy = await getUserHierarchyLevel(userId, tenantId);
  if (role.hierarchyLevel <= userHierarchy) {
    return c.json(
      {
        error: 'hierarchy_violation',
        message: 'Cannot modify role assignments above your hierarchy level',
      },
      403
    );
  }

  try {
    await revokeSecondaryRole({
      userId: targetUserId,
      tenantId,
      roleId,
      revokedBy: userId,
    });

    return c.json({
      success: true,
      message: 'Secondary role revoked',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to revoke role';
    return c.json({ error: 'revoke_failed', message }, 400);
  }
});

/**
 * GET /api/v1/roles/permissions/list
 * Get all available permissions (for role editing UI)
 */
app.get('/permissions/list', async (c) => {
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');

  // Check permission - need canViewRoles or canManageRoles
  const canView = await hasPermission(userId, tenantId, 'canViewRoles');
  if (!canView) {
    return c.json({ error: 'forbidden', message: 'Permission denied' }, 403);
  }

  const byCategory = getPermissionsByCategory();

  return c.json({
    permissions: ALL_PERMISSIONS.map((p) => ({
      key: p.key,
      name: p.name,
      category: p.category,
      description: p.description,
      requires_mfa: p.requiresMfa,
      is_critical: p.isCritical,
    })),
    categories: Object.keys(byCategory),
    by_category: Object.fromEntries(
      Object.entries(byCategory).map(([category, perms]) => [
        category,
        perms.map((p) => ({
          key: p.key,
          name: p.name,
          description: p.description,
          requires_mfa: p.requiresMfa,
          is_critical: p.isCritical,
        })),
      ])
    ),
    total_count: ALL_PERMISSIONS.length,
  });
});

export default app;
