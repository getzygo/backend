/**
 * Notification Preferences Routes
 *
 * GET  /api/v1/notifications/preferences - Get preferences
 * PATCH /api/v1/notifications/preferences - Update preferences
 * POST /api/v1/notifications/preferences/pause - Pause notifications
 * POST /api/v1/notifications/preferences/resume - Resume notifications
 *
 * All endpoints require authentication and tenant context.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { notificationService, ALERT_POLICIES } from '../../services/notification.service';

const app = new Hono();

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
 * GET /api/v1/notifications/preferences
 * Get notification preferences for the current user in current tenant
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

  const prefs = await notificationService.getOrCreatePreferences(user.id, tenant.id);

  return c.json({
    email_enabled: prefs.emailEnabled,
    in_app_enabled: prefs.inAppEnabled,
    sound_enabled: prefs.soundEnabled,
    sound_volume: prefs.soundVolume,
    dnd_enabled: prefs.dndEnabled,
    dnd_start_time: prefs.dndStartTime,
    dnd_end_time: prefs.dndEndTime,
    category_preferences: prefs.categoryPreferences,
    paused_until: prefs.pausedUntil,
    is_paused: prefs.pausedUntil ? new Date(prefs.pausedUntil) > new Date() : false,
    // Include policy info so frontend knows which categories can be disabled
    alert_policies: ALERT_POLICIES,
  });
});

/**
 * PATCH /api/v1/notifications/preferences
 * Update notification preferences
 */
app.patch('/', authMiddleware, zValidator('json', updatePreferencesSchema), async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const body = c.req.valid('json');

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_required',
        message: 'Tenant context is required',
      },
      400
    );
  }

  // Map snake_case to camelCase for the service
  const updates: Parameters<typeof notificationService.updatePreferences>[2] = {};

  if (body.email_enabled !== undefined) updates.emailEnabled = body.email_enabled;
  if (body.in_app_enabled !== undefined) updates.inAppEnabled = body.in_app_enabled;
  if (body.sound_enabled !== undefined) updates.soundEnabled = body.sound_enabled;
  if (body.sound_volume !== undefined) updates.soundVolume = body.sound_volume;
  if (body.dnd_enabled !== undefined) updates.dndEnabled = body.dnd_enabled;
  if (body.dnd_start_time !== undefined) updates.dndStartTime = body.dnd_start_time || undefined;
  if (body.dnd_end_time !== undefined) updates.dndEndTime = body.dnd_end_time || undefined;

  // Handle category preferences (convert from snake_case keys if needed)
  if (body.category_preferences) {
    const categoryPrefs: Record<string, { email?: boolean; inApp?: boolean; sound?: boolean }> = {};

    for (const [category, pref] of Object.entries(body.category_preferences)) {
      // Check if this category can be disabled
      const policy = ALERT_POLICIES[category as keyof typeof ALERT_POLICIES];
      if (policy === 'ALWAYS_SEND') {
        // Skip - cannot disable ALWAYS_SEND categories
        continue;
      }

      categoryPrefs[category] = {
        email: pref.email,
        inApp: pref.in_app,
        sound: pref.sound,
      };
    }

    updates.categoryPreferences = categoryPrefs;
  }

  const prefs = await notificationService.updatePreferences(user.id, tenant.id, updates);

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
});

/**
 * POST /api/v1/notifications/preferences/pause
 * Temporarily pause notifications
 */
app.post('/pause', authMiddleware, zValidator('json', pauseSchema), async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const body = c.req.valid('json');

  if (!tenant) {
    return c.json(
      {
        error: 'tenant_required',
        message: 'Tenant context is required',
      },
      400
    );
  }

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

  return c.json({
    success: true,
    paused_until: prefs.pausedUntil,
  });
});

/**
 * POST /api/v1/notifications/preferences/resume
 * Resume notifications (clear pause)
 */
app.post('/resume', authMiddleware, async (c) => {
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

  await notificationService.resumeNotifications(user.id, tenant.id);

  return c.json({
    success: true,
    paused_until: null,
  });
});

export default app;
