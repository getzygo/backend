/**
 * Notification Preferences Routes
 *
 * GET  /api/v1/notifications/preferences - Get preferences
 * PATCH /api/v1/notifications/preferences - Update preferences
 * POST /api/v1/notifications/preferences/pause - Pause notifications
 * POST /api/v1/notifications/preferences/resume - Resume notifications
 *
 * All endpoints require authentication, tenant context, and canManageNotifications permission.
 * Rate limiting and audit logging are applied.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { rateLimit, RATE_LIMITS } from '../../middleware/rate-limit.middleware';
import {
  notificationService,
  ALERT_POLICIES,
  CATEGORY_VISIBILITY,
  getVisibleAlertPolicies,
} from '../../services/notification.service';
import { auditService } from '../../services/audit.service';
import { resolvePermissions } from '../../services/permission.service';

const app = new Hono();

// Apply auth, tenant, and permission middleware to all routes
app.use('*', authMiddleware, tenantMiddleware, requirePermission('canManageNotifications'));

// Update preferences schema
const updatePreferencesSchema = z.object({
  email_enabled: z.boolean().optional(),
  in_app_enabled: z.boolean().optional(),
  sound_enabled: z.boolean().optional(),
  sound_volume: z.number().min(0).max(100).optional(),
  dnd_enabled: z.boolean().optional(),
  dnd_start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format')
    .optional()
    .nullable(),
  dnd_end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format')
    .optional()
    .nullable(),
  category_preferences: z
    .record(
      z.string(),
      z.object({
        email: z.boolean().optional(),
        in_app: z.boolean().optional(),
        sound: z.boolean().optional(),
      })
    )
    .optional(),
});

// Pause notifications schema
const pauseSchema = z.object({
  duration: z.enum(['1h', '4h', '8h', '24h', 'custom']),
  until: z.string().datetime().optional(), // Required if duration is 'custom'
});

/**
 * Helper to extract client info for audit logging
 */
function getClientInfo(c: any): { ipAddress?: string; userAgent?: string } {
  const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  return { ipAddress, userAgent };
}

/**
 * GET /api/v1/notifications/preferences
 * Get notification preferences for the current user in current tenant
 * Rate limit: 60 req/min
 *
 * Returns only notification categories the user has permission to see.
 * For example, billing_email_changed is only shown to users with canUpdateBillingInfo.
 */
app.get('/', rateLimit(RATE_LIMITS.STANDARD), async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');

  const prefs = await notificationService.getOrCreatePreferences(user.id, tenant.id);

  // Get user's permissions to filter visible notification categories
  const userPermissions = await resolvePermissions(user.id, tenant.id);
  const visiblePolicies = await getVisibleAlertPolicies(user.id, tenant.id, userPermissions);

  // Filter category_preferences to only include visible categories
  const filteredCategoryPrefs: Record<string, unknown> = {};
  if (prefs.categoryPreferences) {
    for (const [category, pref] of Object.entries(prefs.categoryPreferences as Record<string, unknown>)) {
      if (category in visiblePolicies) {
        filteredCategoryPrefs[category] = pref;
      }
    }
  }

  return c.json({
    email_enabled: prefs.emailEnabled,
    in_app_enabled: prefs.inAppEnabled,
    sound_enabled: prefs.soundEnabled,
    sound_volume: prefs.soundVolume,
    dnd_enabled: prefs.dndEnabled,
    dnd_start_time: prefs.dndStartTime,
    dnd_end_time: prefs.dndEndTime,
    category_preferences: filteredCategoryPrefs,
    paused_until: prefs.pausedUntil,
    is_paused: prefs.pausedUntil ? new Date(prefs.pausedUntil) > new Date() : false,
    // Include only visible policies so frontend knows which categories can be disabled
    alert_policies: visiblePolicies,
  });
});

/**
 * PATCH /api/v1/notifications/preferences
 * Update notification preferences
 * Rate limit: 30 req/min
 */
app.patch(
  '/',
  rateLimit(RATE_LIMITS.WRITE),
  zValidator('json', updatePreferencesSchema),
  async (c) => {
    const user = c.get('user');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const { ipAddress, userAgent } = getClientInfo(c);

    // Get current preferences for audit logging (before update)
    const currentPrefs = await notificationService.getOrCreatePreferences(user.id, tenant.id);

    // Map snake_case to camelCase for the service
    const updates: Parameters<typeof notificationService.updatePreferences>[2] = {};

    // Track changes for audit log
    const changes: Record<string, { old: unknown; new: unknown }> = {};

    if (body.email_enabled !== undefined && body.email_enabled !== currentPrefs.emailEnabled) {
      updates.emailEnabled = body.email_enabled;
      changes.emailEnabled = { old: currentPrefs.emailEnabled, new: body.email_enabled };
    }

    if (body.in_app_enabled !== undefined && body.in_app_enabled !== currentPrefs.inAppEnabled) {
      updates.inAppEnabled = body.in_app_enabled;
      changes.inAppEnabled = { old: currentPrefs.inAppEnabled, new: body.in_app_enabled };
    }

    if (body.sound_enabled !== undefined && body.sound_enabled !== currentPrefs.soundEnabled) {
      updates.soundEnabled = body.sound_enabled;
      changes.soundEnabled = { old: currentPrefs.soundEnabled, new: body.sound_enabled };
    }

    if (body.sound_volume !== undefined && body.sound_volume !== currentPrefs.soundVolume) {
      updates.soundVolume = body.sound_volume;
      changes.soundVolume = { old: currentPrefs.soundVolume, new: body.sound_volume };
    }

    if (body.dnd_enabled !== undefined && body.dnd_enabled !== currentPrefs.dndEnabled) {
      updates.dndEnabled = body.dnd_enabled;
      changes.dndEnabled = { old: currentPrefs.dndEnabled, new: body.dnd_enabled };
    }

    if (body.dnd_start_time !== undefined) {
      updates.dndStartTime = body.dnd_start_time || undefined;
      if (body.dnd_start_time !== currentPrefs.dndStartTime) {
        changes.dndStartTime = { old: currentPrefs.dndStartTime, new: body.dnd_start_time };
      }
    }

    if (body.dnd_end_time !== undefined) {
      updates.dndEndTime = body.dnd_end_time || undefined;
      if (body.dnd_end_time !== currentPrefs.dndEndTime) {
        changes.dndEndTime = { old: currentPrefs.dndEndTime, new: body.dnd_end_time };
      }
    }

    // Handle category preferences (convert from snake_case keys if needed)
    if (body.category_preferences) {
      // Get user's permissions to filter visible notification categories
      const userPermissions = await resolvePermissions(user.id, tenant.id);
      const visiblePolicies = await getVisibleAlertPolicies(user.id, tenant.id, userPermissions);

      const categoryPrefs: Record<string, { email?: boolean; inApp?: boolean; sound?: boolean }> = {};
      const categoryChanges: Record<string, { old: unknown; new: unknown }> = {};

      for (const [category, pref] of Object.entries(body.category_preferences)) {
        // Check if this category can be disabled
        const policy = ALERT_POLICIES[category as keyof typeof ALERT_POLICIES];
        if (policy === 'ALWAYS_SEND') {
          // Skip - cannot disable ALWAYS_SEND categories
          continue;
        }

        // Check if user has permission to modify this category
        if (!(category in visiblePolicies)) {
          // Skip - user doesn't have permission to see/modify this category
          continue;
        }

        categoryPrefs[category] = {
          email: pref.email,
          inApp: pref.in_app,
          sound: pref.sound,
        };

        // Track category changes
        const oldCategoryPrefs = (currentPrefs.categoryPreferences as Record<string, unknown>)?.[category];
        categoryChanges[category] = { old: oldCategoryPrefs, new: categoryPrefs[category] };
      }

      updates.categoryPreferences = categoryPrefs;

      if (Object.keys(categoryChanges).length > 0) {
        changes.categoryPreferences = { old: currentPrefs.categoryPreferences, new: categoryPrefs };
      }
    }

    const prefs = await notificationService.updatePreferences(user.id, tenant.id, updates);

    // Audit log the changes (only if there were actual changes)
    if (Object.keys(changes).length > 0) {
      await auditService.logNotificationPreferenceChange(
        user.id,
        tenant.id,
        changes,
        ipAddress,
        userAgent
      );
    }

    return c.json({
      success: true,
      email_enabled: prefs.emailEnabled,
      in_app_enabled: prefs.inAppEnabled,
      sound_enabled: prefs.soundEnabled,
      sound_volume: prefs.soundVolume,
      dnd_enabled: prefs.dndEnabled,
      dnd_start_time: prefs.dndStartTime,
      dnd_end_time: prefs.dndEndTime,
      category_preferences: prefs.categoryPreferences,
    });
  }
);

/**
 * POST /api/v1/notifications/preferences/pause
 * Temporarily pause notifications
 * Rate limit: 10 req/min
 */
app.post(
  '/pause',
  rateLimit(RATE_LIMITS.BULK),
  zValidator('json', pauseSchema),
  async (c) => {
    const user = c.get('user');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const { ipAddress, userAgent } = getClientInfo(c);

    let pauseUntil: Date;

    if (body.duration === 'custom') {
      if (!body.until) {
        return c.json(
          {
            error: 'invalid_params',
            message: 'Custom duration requires "until" field',
          },
          400
        );
      }
      pauseUntil = new Date(body.until);

      // Validate the custom date is in the future
      if (pauseUntil <= new Date()) {
        return c.json(
          {
            error: 'invalid_params',
            message: 'Pause end time must be in the future',
          },
          400
        );
      }

      // Cap at 7 days maximum
      const maxPause = new Date();
      maxPause.setDate(maxPause.getDate() + 7);
      if (pauseUntil > maxPause) {
        return c.json(
          {
            error: 'invalid_params',
            message: 'Cannot pause notifications for more than 7 days',
          },
          400
        );
      }
    } else {
      const durationMs: Record<string, number> = {
        '1h': 1 * 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '8h': 8 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
      };
      pauseUntil = new Date(Date.now() + durationMs[body.duration]);
    }

    const prefs = await notificationService.pauseNotifications(user.id, tenant.id, pauseUntil);

    // Audit log the pause action
    await auditService.logNotificationPause(
      user.id,
      tenant.id,
      pauseUntil,
      ipAddress,
      userAgent
    );

    return c.json({
      success: true,
      paused_until: prefs.pausedUntil,
    });
  }
);

/**
 * POST /api/v1/notifications/preferences/resume
 * Resume notifications (clear pause)
 * Rate limit: 10 req/min
 */
app.post('/resume', rateLimit(RATE_LIMITS.BULK), async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const { ipAddress, userAgent } = getClientInfo(c);

  await notificationService.resumeNotifications(user.id, tenant.id);

  // Audit log the resume action
  await auditService.logNotificationResume(
    user.id,
    tenant.id,
    ipAddress,
    userAgent
  );

  return c.json({
    success: true,
    paused_until: null,
  });
});

export default app;
