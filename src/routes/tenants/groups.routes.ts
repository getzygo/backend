/**
 * Group Routes
 *
 * Manages groups/teams within a tenant for scoped collaboration.
 *
 * Permissions:
 * - canViewGroups: List and view groups
 * - canCreateGroups: Create new groups
 * - canManageGroups: Edit group settings
 * - canDeleteGroups: Archive/delete groups
 * - canManageGroupMembers: Add/remove members
 * - canAssignGroupResources: Assign/unassign resources
 * - canViewGroupResources: View group resources
 * - canManageGroupSettings: Manage group configuration
 *
 * Dual authorization: tenant-level permission OR group admin/owner
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { isTenantMember } from '../../services/tenant.service';
import { hasPermission } from '../../services/permission.service';
import { getUserHierarchyLevel } from '../../services/role.service';
import {
  getGroupsByTenant,
  getGroupById,
  createGroup,
  updateGroup,
  archiveGroup,
  deleteGroup,
  getGroupMembers,
  addGroupMember,
  updateGroupMemberRole,
  removeGroupMember,
  getUserGroups,
  isGroupMember,
  getGroupMemberRole,
  getGroupResources,
  assignResourceToGroup,
  removeResourceFromGroup,
} from '../../services/group.service';
import type { User } from '../../db/schema';

const app = new Hono();

app.use('*', authMiddleware);

// ============================================================================
// Helper: check if user is admin/owner (hierarchy <= 10)
// ============================================================================
async function isAdminOrOwner(userId: string, tenantId: string): Promise<boolean> {
  const level = await getUserHierarchyLevel(userId, tenantId);
  return level <= 10;
}

// Helper: check if user has group-level admin/owner role
async function hasGroupAdminAccess(groupId: string, userId: string): Promise<boolean> {
  const role = await getGroupMemberRole(groupId, userId);
  return role === 'owner' || role === 'admin';
}

// ============================================================================
// Groups CRUD
// ============================================================================

/**
 * GET /:tenantId/groups
 * List groups (filtered by visibility + membership)
 */
app.get('/:tenantId/groups', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const canView = await hasPermission(user.id, tenantId, 'canViewGroups');
  if (!canView) {
    return c.json({ error: 'forbidden', message: 'Missing canViewGroups permission' }, 403);
  }

  const filter = (c.req.query('filter') as 'all' | 'my' | 'archived') || 'all';
  const search = c.req.query('search') || undefined;
  const page = parseInt(c.req.query('page') || '1', 10);
  const perPage = parseInt(c.req.query('per_page') || '20', 10);

  const adminOwner = await isAdminOrOwner(user.id, tenantId);

  const result = await getGroupsByTenant({
    tenantId,
    userId: user.id,
    isAdminOrOwner: adminOwner,
    filter,
    search,
    page,
    perPage,
  });

  return c.json({
    groups: result.groups,
    total: result.total,
    page,
    per_page: perPage,
    has_more: page * perPage < result.total,
  });
});

/**
 * GET /:tenantId/groups/my
 * List user's groups only
 */
app.get('/:tenantId/groups/my', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const groups = await getUserGroups(user.id, tenantId);
  return c.json({ groups });
});

/**
 * POST /:tenantId/groups
 * Create a new group
 */
const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['team', 'department']).optional(),
  visibility: z.enum(['open', 'internal', 'private']).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  initial_members: z.array(z.object({
    user_id: z.string().uuid(),
    role: z.enum(['owner', 'admin', 'member', 'viewer']).optional(),
  })).optional(),
});

app.post('/:tenantId/groups', zValidator('json', createGroupSchema), async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const canCreate = await hasPermission(user.id, tenantId, 'canCreateGroups');
  if (!canCreate) {
    return c.json({ error: 'forbidden', message: 'Missing canCreateGroups permission' }, 403);
  }

  const body = c.req.valid('json');

  const result = await createGroup({
    tenantId,
    name: body.name,
    description: body.description,
    type: body.type,
    visibility: body.visibility,
    color: body.color,
    createdBy: user.id,
  });

  if (!result.success) {
    return c.json({ error: 'create_failed', message: result.error }, 400);
  }

  // Add initial members if provided
  if (body.initial_members && body.initial_members.length > 0) {
    await Promise.all(
      body.initial_members.map((m) =>
        addGroupMember({
          groupId: result.group!.id,
          userId: m.user_id,
          tenantId,
          role: m.role || 'member',
          addedBy: user.id,
        })
      )
    );
  }

  return c.json({ group: result.group }, 201);
});

/**
 * GET /:tenantId/groups/:groupId
 * Get group details
 */
app.get('/:tenantId/groups/:groupId', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const canView = await hasPermission(user.id, tenantId, 'canViewGroups');
  if (!canView) {
    return c.json({ error: 'forbidden', message: 'Missing canViewGroups permission' }, 403);
  }

  const group = await getGroupById(groupId, tenantId);
  if (!group) {
    return c.json({ error: 'not_found', message: 'Group not found' }, 404);
  }

  // Check visibility for private groups
  if (group.visibility === 'private') {
    const adminOwner = await isAdminOrOwner(user.id, tenantId);
    if (!adminOwner) {
      const isMember = await isGroupMember(groupId, user.id);
      if (!isMember) {
        return c.json({ error: 'not_found', message: 'Group not found' }, 404);
      }
    }
  }

  // Get additional info
  const userRole = await getGroupMemberRole(groupId, user.id);

  return c.json({ group, user_role: userRole });
});

/**
 * PATCH /:tenantId/groups/:groupId
 * Update group details
 */
const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  type: z.enum(['team', 'department']).optional(),
  visibility: z.enum(['open', 'internal', 'private']).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

app.patch('/:tenantId/groups/:groupId', zValidator('json', updateGroupSchema), async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  // Dual auth: tenant permission OR group admin/owner
  const canManage = await hasPermission(user.id, tenantId, 'canManageGroups');
  const groupAdmin = await hasGroupAdminAccess(groupId, user.id);
  if (!canManage && !groupAdmin) {
    return c.json({ error: 'forbidden', message: 'Missing permission to manage this group' }, 403);
  }

  const body = c.req.valid('json');
  const result = await updateGroup({
    groupId,
    tenantId,
    updates: body,
    updatedBy: user.id,
  });

  if (!result.success) {
    return c.json({ error: 'update_failed', message: result.error }, 400);
  }

  return c.json({ group: result.group });
});

/**
 * POST /:tenantId/groups/:groupId/archive
 * Archive a group
 */
app.post('/:tenantId/groups/:groupId/archive', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const canDelete = await hasPermission(user.id, tenantId, 'canDeleteGroups');
  const groupOwner = (await getGroupMemberRole(groupId, user.id)) === 'owner';
  if (!canDelete && !groupOwner) {
    return c.json({ error: 'forbidden', message: 'Missing permission to archive this group' }, 403);
  }

  const result = await archiveGroup({ groupId, tenantId, archivedBy: user.id });
  if (!result.success) {
    return c.json({ error: 'archive_failed', message: result.error }, 400);
  }

  return c.json({ message: 'Group archived successfully' });
});

/**
 * DELETE /:tenantId/groups/:groupId
 * Permanently delete a group
 */
app.delete('/:tenantId/groups/:groupId', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const canDelete = await hasPermission(user.id, tenantId, 'canDeleteGroups');
  if (!canDelete) {
    return c.json({ error: 'forbidden', message: 'Missing canDeleteGroups permission' }, 403);
  }

  const result = await deleteGroup({ groupId, tenantId, deletedBy: user.id });
  if (!result.success) {
    return c.json({ error: 'delete_failed', message: result.error }, 400);
  }

  return c.json({ message: 'Group deleted successfully' });
});

// ============================================================================
// Group Members
// ============================================================================

/**
 * GET /:tenantId/groups/:groupId/members
 * List group members
 */
app.get('/:tenantId/groups/:groupId/members', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  // Group member OR canManageGroupMembers
  const isMember = await isGroupMember(groupId, user.id);
  const canManageMembers = await hasPermission(user.id, tenantId, 'canManageGroupMembers');
  if (!isMember && !canManageMembers) {
    return c.json({ error: 'forbidden', message: 'Must be a group member or have permission' }, 403);
  }

  const page = parseInt(c.req.query('page') || '1', 10);
  const perPage = parseInt(c.req.query('per_page') || '50', 10);

  const result = await getGroupMembers({ groupId, tenantId, page, perPage });

  return c.json({
    members: result.members,
    total: result.total,
    page,
    per_page: perPage,
    has_more: page * perPage < result.total,
  });
});

/**
 * POST /:tenantId/groups/:groupId/members
 * Add member to group
 */
const addMemberSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member', 'viewer']).optional(),
});

app.post('/:tenantId/groups/:groupId/members', zValidator('json', addMemberSchema), async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const canManageMembers = await hasPermission(user.id, tenantId, 'canManageGroupMembers');
  const groupAdmin = await hasGroupAdminAccess(groupId, user.id);
  if (!canManageMembers && !groupAdmin) {
    return c.json({ error: 'forbidden', message: 'Missing permission to manage group members' }, 403);
  }

  const body = c.req.valid('json');
  const result = await addGroupMember({
    groupId,
    userId: body.user_id,
    tenantId,
    role: body.role || 'member',
    addedBy: user.id,
  });

  if (!result.success) {
    return c.json({ error: 'add_member_failed', message: result.error }, 400);
  }

  return c.json({ member: result.member }, 201);
});

/**
 * PATCH /:tenantId/groups/:groupId/members/:userId
 * Update group member role
 */
const updateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

app.patch(
  '/:tenantId/groups/:groupId/members/:userId',
  zValidator('json', updateMemberRoleSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const groupId = c.req.param('groupId');
    const targetUserId = c.req.param('userId');

    const memberCheck = await isTenantMember(user.id, tenantId);
    if (!memberCheck) {
      return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
    }

    const canManageMembers = await hasPermission(user.id, tenantId, 'canManageGroupMembers');
    const groupAdmin = await hasGroupAdminAccess(groupId, user.id);
    if (!canManageMembers && !groupAdmin) {
      return c.json({ error: 'forbidden', message: 'Missing permission to manage group members' }, 403);
    }

    // Admins can't promote to owner unless they are a group owner
    const body = c.req.valid('json');
    if (body.role === 'owner') {
      const callerRole = await getGroupMemberRole(groupId, user.id);
      if (callerRole !== 'owner') {
        const tenantAdmin = await isAdminOrOwner(user.id, tenantId);
        if (!tenantAdmin) {
          return c.json({ error: 'forbidden', message: 'Only group owners or tenant admins can transfer ownership' }, 403);
        }
      }
    }

    const result = await updateGroupMemberRole({
      groupId,
      userId: targetUserId,
      tenantId,
      newRole: body.role,
      updatedBy: user.id,
    });

    if (!result.success) {
      return c.json({ error: 'update_role_failed', message: result.error }, 400);
    }

    return c.json({ message: 'Member role updated successfully' });
  }
);

/**
 * DELETE /:tenantId/groups/:groupId/members/:userId
 * Remove member from group
 */
app.delete('/:tenantId/groups/:groupId/members/:userId', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');
  const targetUserId = c.req.param('userId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const canManageMembers = await hasPermission(user.id, tenantId, 'canManageGroupMembers');
  const groupAdmin = await hasGroupAdminAccess(groupId, user.id);
  if (!canManageMembers && !groupAdmin) {
    return c.json({ error: 'forbidden', message: 'Missing permission to manage group members' }, 403);
  }

  const result = await removeGroupMember({
    groupId,
    userId: targetUserId,
    tenantId,
    removedBy: user.id,
  });

  if (!result.success) {
    return c.json({ error: 'remove_member_failed', message: result.error }, 400);
  }

  return c.json({ message: 'Member removed from group' });
});

/**
 * POST /:tenantId/groups/:groupId/leave
 * Leave a group (self-removal)
 */
app.post('/:tenantId/groups/:groupId/leave', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const isMember = await isGroupMember(groupId, user.id);
  if (!isMember) {
    return c.json({ error: 'not_found', message: 'You are not a member of this group' }, 404);
  }

  const result = await removeGroupMember({
    groupId,
    userId: user.id,
    tenantId,
    removedBy: user.id,
  });

  if (!result.success) {
    return c.json({ error: 'leave_failed', message: result.error }, 400);
  }

  return c.json({ message: 'Left the group successfully' });
});

// ============================================================================
// Group Resources
// ============================================================================

/**
 * GET /:tenantId/groups/:groupId/resources
 * List group resources
 */
app.get('/:tenantId/groups/:groupId/resources', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const isMember = await isGroupMember(groupId, user.id);
  const canViewResources = await hasPermission(user.id, tenantId, 'canViewGroupResources');
  if (!isMember && !canViewResources) {
    return c.json({ error: 'forbidden', message: 'Must be a group member or have permission' }, 403);
  }

  const resourceType = c.req.query('resource_type') || undefined;
  const page = parseInt(c.req.query('page') || '1', 10);
  const perPage = parseInt(c.req.query('per_page') || '50', 10);

  const result = await getGroupResources({ groupId, tenantId, resourceType, page, perPage });

  return c.json({
    resources: result.resources,
    total: result.total,
    page,
    per_page: perPage,
    has_more: page * perPage < result.total,
  });
});

/**
 * POST /:tenantId/groups/:groupId/resources
 * Assign resource to group
 */
const assignResourceSchema = z.object({
  resource_type: z.string().min(1).max(50),
  resource_id: z.string().min(1).max(255),
});

app.post(
  '/:tenantId/groups/:groupId/resources',
  zValidator('json', assignResourceSchema),
  async (c) => {
    const user = c.get('user') as User;
    const tenantId = c.req.param('tenantId');
    const groupId = c.req.param('groupId');

    const memberCheck = await isTenantMember(user.id, tenantId);
    if (!memberCheck) {
      return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
    }

    const canAssign = await hasPermission(user.id, tenantId, 'canAssignGroupResources');
    const groupAdmin = await hasGroupAdminAccess(groupId, user.id);
    if (!canAssign && !groupAdmin) {
      return c.json({ error: 'forbidden', message: 'Missing permission to assign group resources' }, 403);
    }

    const body = c.req.valid('json');
    const result = await assignResourceToGroup({
      groupId,
      tenantId,
      resourceType: body.resource_type,
      resourceId: body.resource_id,
      assignedBy: user.id,
    });

    if (!result.success) {
      return c.json({ error: 'assign_failed', message: result.error }, 400);
    }

    return c.json({ resource: result.resource }, 201);
  }
);

/**
 * DELETE /:tenantId/groups/:groupId/resources/:resourceId
 * Remove resource from group
 */
app.delete('/:tenantId/groups/:groupId/resources/:resourceId', async (c) => {
  const user = c.get('user') as User;
  const tenantId = c.req.param('tenantId');
  const groupId = c.req.param('groupId');
  const resourceId = c.req.param('resourceId');

  const memberCheck = await isTenantMember(user.id, tenantId);
  if (!memberCheck) {
    return c.json({ error: 'forbidden', message: 'Not a tenant member' }, 403);
  }

  const canAssign = await hasPermission(user.id, tenantId, 'canAssignGroupResources');
  const groupAdmin = await hasGroupAdminAccess(groupId, user.id);
  if (!canAssign && !groupAdmin) {
    return c.json({ error: 'forbidden', message: 'Missing permission to manage group resources' }, 403);
  }

  const result = await removeResourceFromGroup({
    groupId,
    resourceId,
    tenantId,
    removedBy: user.id,
  });

  if (!result.success) {
    return c.json({ error: 'remove_failed', message: result.error }, 400);
  }

  return c.json({ message: 'Resource removed from group' });
});

export default app;
