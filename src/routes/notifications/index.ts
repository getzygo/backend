/**
 * Notification Routes
 *
 * GET  /api/v1/notifications - List notifications
 * GET  /api/v1/notifications/unread/count - Get unread count
 * PATCH /api/v1/notifications/:id/read - Mark as read
 * POST /api/v1/notifications/read-all - Mark all as read
 * DELETE /api/v1/notifications/:id - Delete notification
 *
 * All endpoints require authentication and tenant context.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { notificationService } from '../../services/notification.service';

const app = new Hono();

// Query params schema for listing
const listQuerySchema = z.object({
  limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 20)),
  cursor: z.string().uuid().optional(),
  unread_only: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

/**
 * GET /api/v1/notifications
 * List notifications for the current user in current tenant
 * Rate limit: 60 req/min
 */
app.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_required',
        message: 'Tenant context is required',
      },
      400
    );
  }

  // Parse query params
  const query = c.req.query();
  const parsed = listQuerySchema.safeParse(query);

  if (!parsed.success) {
    return c.json(
      {
        error: 'invalid_params',
        message: 'Invalid query parameters',
        details: parsed.error.flatten(),
      },
      400
    );
  }

  const { limit, cursor, unread_only } = parsed.data;

  const result = await notificationService.getNotifications({
    userId: user.id,
    tenantId: tenant.id,
    limit,
    cursor,
    unreadOnly: unread_only,
  });

  return c.json({
    notifications: result.notifications.map((n) => ({
      id: n.id,
      type: n.type,
      category: n.category,
      title: n.title,
      message: n.message,
      action_route: n.actionRoute,
      action_label: n.actionLabel,
      severity: n.severity,
      is_read: n.isRead,
      read_at: n.readAt,
      metadata: n.metadata,
      created_at: n.createdAt,
    })),
    next_cursor: result.nextCursor,
    has_more: result.hasMore,
  });
});

/**
 * GET /api/v1/notifications/unread/count
 * Get unread notification count
 * Rate limit: 60 req/min (for polling)
 */
app.get('/unread/count', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_required',
        message: 'Tenant context is required',
      },
      400
    );
  }

  const count = await notificationService.getUnreadCount(user.id, tenant.id);

  return c.json({ count });
});

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a notification as read
 */
app.patch('/:id/read', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const notificationId = c.req.param('id');

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_required',
        message: 'Tenant context is required',
      },
      400
    );
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(notificationId)) {
    return c.json(
      {
        error: 'invalid_id',
        message: 'Invalid notification ID format',
      },
      400
    );
  }

  const success = await notificationService.markAsRead(notificationId, user.id, tenant.id);

  if (!success) {
    return c.json(
      {
        error: 'not_found',
        message: 'Notification not found',
      },
      404
    );
  }

  return c.json({ success: true });
});

/**
 * POST /api/v1/notifications/read-all
 * Mark all notifications as read
 * Rate limit: 10 req/min (prevent spam)
 */
app.post('/read-all', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_required',
        message: 'Tenant context is required',
      },
      400
    );
  }

  const count = await notificationService.markAllAsRead(user.id, tenant.id);

  return c.json({
    success: true,
    marked_count: count,
  });
});

/**
 * DELETE /api/v1/notifications/:id
 * Delete a notification
 */
app.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const notificationId = c.req.param('id');

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_required',
        message: 'Tenant context is required',
      },
      400
    );
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(notificationId)) {
    return c.json(
      {
        error: 'invalid_id',
        message: 'Invalid notification ID format',
      },
      400
    );
  }

  const success = await notificationService.deleteNotification(notificationId, user.id, tenant.id);

  if (!success) {
    return c.json(
      {
        error: 'not_found',
        message: 'Notification not found',
      },
      404
    );
  }

  return c.json({ success: true });
});

export default app;
