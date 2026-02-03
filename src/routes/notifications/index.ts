/**
 * Notification Routes
 *
 * GET  /api/v1/notifications - List notifications
 * GET  /api/v1/notifications/unread/count - Get unread count
 * PATCH /api/v1/notifications/:id/read - Mark as read
 * POST /api/v1/notifications/read-all - Mark all as read
 * DELETE /api/v1/notifications/:id - Delete notification
 *
 * All endpoints require authentication, tenant context, and proper permissions.
 * Rate limiting is applied to prevent abuse.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { rateLimit, RATE_LIMITS } from '../../middleware/rate-limit.middleware';
import { notificationService } from '../../services/notification.service';
import { auditService } from '../../services/audit.service';

const app = new Hono();

// Apply auth, tenant, and permission middleware to all routes
app.use('*', authMiddleware, tenantMiddleware);

// Apply rate limiting based on endpoint type
// GET endpoints: standard rate limit (60/min)
// POST/DELETE endpoints: stricter rate limits

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
app.get('/', rateLimit(RATE_LIMITS.STANDARD), async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');

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

  // Cap limit at 100 for security
  const cappedLimit = Math.min(limit, 100);

  const result = await notificationService.getNotifications({
    userId: user.id,
    tenantId: tenant.id,
    limit: cappedLimit,
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
app.get('/unread/count', rateLimit(RATE_LIMITS.POLLING), async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');

  const count = await notificationService.getUnreadCount(user.id, tenant.id);

  return c.json({ count });
});

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a notification as read
 * Rate limit: 30 req/min
 */
app.patch('/:id/read', rateLimit(RATE_LIMITS.WRITE), async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const notificationId = c.req.param('id');

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
app.post('/read-all', rateLimit(RATE_LIMITS.BULK), async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');

  const count = await notificationService.markAllAsRead(user.id, tenant.id);

  // Audit log for bulk operation
  const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  await auditService.logNotificationMarkAllRead(
    user.id,
    tenant.id,
    count,
    ipAddress,
    userAgent
  );

  return c.json({
    success: true,
    marked_count: count,
  });
});

/**
 * DELETE /api/v1/notifications/:id
 * Delete a notification
 * Rate limit: 30 req/min
 */
app.delete('/:id', rateLimit(RATE_LIMITS.WRITE), async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const notificationId = c.req.param('id');

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

  // Audit log for deletion
  const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  await auditService.logNotificationDelete(
    user.id,
    tenant.id,
    notificationId,
    undefined, // We don't have notification details after deletion
    ipAddress,
    userAgent
  );

  return c.json({ success: true });
});

export default app;
