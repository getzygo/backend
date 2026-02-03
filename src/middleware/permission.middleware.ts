/**
 * Permission Middleware
 *
 * RBAC permission enforcement middleware.
 * Checks if the authenticated user has required permissions.
 */

import { Context, Next, MiddlewareHandler } from 'hono';
import { hasPermission, hasAnyPermission, hasAllPermissions } from '../services/permission.service';

/**
 * Require a single permission
 *
 * Usage:
 *   app.use('*', requirePermission('canManageNotifications'));
 */
export function requirePermission(permission: string): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    const tenant = c.get('tenant');

    if (!user || !tenant) {
      return c.json(
        {
          error: 'unauthorized',
          message: 'Authentication required',
        },
        401
      );
    }

    const allowed = await hasPermission(user.id, tenant.id, permission);

    if (!allowed) {
      return c.json(
        {
          error: 'forbidden',
          message: `Missing required permission: ${permission}`,
          required_permission: permission,
        },
        403
      );
    }

    await next();
  };
}

/**
 * Require any of the specified permissions (OR logic)
 *
 * Usage:
 *   app.use('*', requireAnyPermission(['canManageUsers', 'canViewUsers']));
 */
export function requireAnyPermission(permissions: string[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    const tenant = c.get('tenant');

    if (!user || !tenant) {
      return c.json(
        {
          error: 'unauthorized',
          message: 'Authentication required',
        },
        401
      );
    }

    const allowed = await hasAnyPermission(user.id, tenant.id, permissions);

    if (!allowed) {
      return c.json(
        {
          error: 'forbidden',
          message: `Missing required permissions. Need one of: ${permissions.join(', ')}`,
          required_permissions: permissions,
        },
        403
      );
    }

    await next();
  };
}

/**
 * Require all of the specified permissions (AND logic)
 *
 * Usage:
 *   app.use('*', requireAllPermissions(['canManageUsers', 'canDeleteUsers']));
 */
export function requireAllPermissions(permissions: string[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    const tenant = c.get('tenant');

    if (!user || !tenant) {
      return c.json(
        {
          error: 'unauthorized',
          message: 'Authentication required',
        },
        401
      );
    }

    const allowed = await hasAllPermissions(user.id, tenant.id, permissions);

    if (!allowed) {
      return c.json(
        {
          error: 'forbidden',
          message: `Missing required permissions. Need all of: ${permissions.join(', ')}`,
          required_permissions: permissions,
        },
        403
      );
    }

    await next();
  };
}
