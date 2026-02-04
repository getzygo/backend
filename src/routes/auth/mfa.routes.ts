/**
 * MFA (Multi-Factor Authentication) Routes
 *
 * POST /api/v1/auth/mfa/setup - Start MFA setup
 * POST /api/v1/auth/mfa/enable - Enable MFA with first code verification
 * POST /api/v1/auth/mfa/verify - Verify MFA code (during signin)
 * POST /api/v1/auth/mfa/disable - Disable MFA
 * POST /api/v1/auth/mfa/backup-codes - Regenerate backup codes
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireEmailVerified } from '../../middleware/auth.middleware';
import { mfaService } from '../../services/mfa.service';
import { getDb } from '../../db/client';
import { auditLogs, tenantMembers } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { notify } from '../../services/notification-hub.service';
import { NOTIFICATION_CONFIGS, EMAIL_TEMPLATES } from '../../services/notification-configs';
import { rateLimit, RATE_LIMITS } from '../../middleware/rate-limit.middleware';

const app = new Hono();

// Apply rate limiting to all MFA routes (prevent code guessing)
app.use('*', rateLimit(RATE_LIMITS.SENSITIVE));

// MFA code schema
const mfaCodeSchema = z.object({
  code: z
    .string()
    .min(6)
    .max(10) // Allow for backup codes with dashes
    .regex(/^[\dA-Z-]+$/i, 'Invalid code format'),
});

/**
 * POST /api/v1/auth/mfa/setup
 * Start MFA setup - generate secret and QR code
 */
app.post('/setup', authMiddleware, requireEmailVerified, async (c) => {
  const user = c.get('user');

  // Check if MFA is already enabled
  if (user.mfaEnabled) {
    return c.json(
      {
        error: 'mfa_already_enabled',
        message: 'MFA is already enabled. Disable it first to set up again.',
      },
      400
    );
  }

  const result = await mfaService.setupMfa(user.id, user.email);

  if (result.error) {
    return c.json(
      {
        error: 'setup_failed',
        message: result.error,
      },
      500
    );
  }

  return c.json({
    secret: result.secret,
    qr_code: result.qrCodeUrl,
    backup_codes: result.backupCodes,
  });
});

/**
 * POST /api/v1/auth/mfa/enable
 * Enable MFA by verifying the first TOTP code
 */
app.post(
  '/enable',
  authMiddleware,
  requireEmailVerified,
  zValidator('json', mfaCodeSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    // Check if MFA is already enabled
    if (user.mfaEnabled) {
      return c.json(
        {
          error: 'mfa_already_enabled',
          message: 'MFA is already enabled',
        },
        400
      );
    }

    const result = await mfaService.enableMfa(user.id, body.code);

    if (!result.enabled) {
      return c.json(
        {
          error: 'enable_failed',
          message: result.error || 'Failed to enable MFA',
        },
        400
      );
    }

    // Audit log
    const db = getDb();
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'mfa_enabled',
      resourceType: 'user',
      resourceId: user.id,
      details: {},
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    // Get user's primary tenant for in-app notification
    const membership = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.userId, user.id),
        eq(tenantMembers.status, 'active')
      ),
      columns: { tenantId: true },
    });

    // Send MFA enabled notification (email + in-app)
    const config = NOTIFICATION_CONFIGS.mfa_enabled;
    notify({
      userId: user.id,
      tenantId: membership?.tenantId,
      category: config.category,
      type: config.type,
      title: config.title,
      message: config.message as string,
      severity: config.severity,
      actionRoute: config.actionRoute,
      actionLabel: config.actionLabel,
      emailTemplate: EMAIL_TEMPLATES.mfaEnabled({
        firstName: user.firstName || undefined,
        method: 'totp',
      }),
      emailSubject: config.emailSubject,
    }).catch((err) => console.error('[MFA] Notification failed:', err));

    return c.json({
      enabled: true,
    });
  }
);

/**
 * POST /api/v1/auth/mfa/verify
 * Verify MFA code (standalone verification, e.g., for sensitive operations)
 */
app.post(
  '/verify',
  authMiddleware,
  requireEmailVerified,
  zValidator('json', mfaCodeSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    // Check if MFA is enabled
    if (!user.mfaEnabled) {
      return c.json(
        {
          error: 'mfa_not_enabled',
          message: 'MFA is not enabled for this account',
        },
        400
      );
    }

    const result = await mfaService.verifyMfaCode(user.id, body.code);

    if (!result.verified) {
      return c.json(
        {
          error: 'invalid_code',
          message: result.error || 'Invalid verification code',
        },
        400
      );
    }

    return c.json({
      verified: true,
    });
  }
);

/**
 * POST /api/v1/auth/mfa/disable
 * Disable MFA (requires current MFA code)
 */
app.post(
  '/disable',
  authMiddleware,
  requireEmailVerified,
  zValidator('json', mfaCodeSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    // Check if MFA is enabled
    if (!user.mfaEnabled) {
      return c.json(
        {
          error: 'mfa_not_enabled',
          message: 'MFA is not enabled',
        },
        400
      );
    }

    const result = await mfaService.disableMfa(user.id, body.code);

    if (!result.disabled) {
      return c.json(
        {
          error: 'disable_failed',
          message: result.error || 'Failed to disable MFA',
        },
        400
      );
    }

    // Audit log
    const db = getDb();
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'mfa_disabled',
      resourceType: 'user',
      resourceId: user.id,
      details: {},
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    // Get user's primary tenant for in-app notification
    const membership = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.userId, user.id),
        eq(tenantMembers.status, 'active')
      ),
      columns: { tenantId: true },
    });

    // Send MFA disabled notification (email + in-app) - ALWAYS_SEND
    const config = NOTIFICATION_CONFIGS.mfa_disabled;
    notify({
      userId: user.id,
      tenantId: membership?.tenantId,
      category: config.category,
      type: config.type,
      title: config.title,
      message: config.message as string,
      severity: config.severity,
      actionRoute: config.actionRoute,
      actionLabel: config.actionLabel,
      emailTemplate: EMAIL_TEMPLATES.mfaDisabled({
        firstName: user.firstName || undefined,
        ipAddress: ipAddress || undefined,
        deviceInfo: userAgent || undefined,
      }),
      emailSubject: config.emailSubject,
    }).catch((err) => console.error('[MFA] Notification failed:', err));

    return c.json({
      disabled: true,
    });
  }
);

/**
 * POST /api/v1/auth/mfa/backup-codes
 * Regenerate backup codes (requires current MFA code)
 */
app.post(
  '/backup-codes',
  authMiddleware,
  requireEmailVerified,
  zValidator('json', mfaCodeSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    // Check if MFA is enabled
    if (!user.mfaEnabled) {
      return c.json(
        {
          error: 'mfa_not_enabled',
          message: 'MFA is not enabled',
        },
        400
      );
    }

    const result = await mfaService.regenerateBackupCodes(user.id, body.code);

    if (result.error) {
      return c.json(
        {
          error: 'regenerate_failed',
          message: result.error,
        },
        400
      );
    }

    // Audit log
    const db = getDb();
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'mfa_backup_codes_regenerated',
      resourceType: 'user',
      resourceId: user.id,
      details: {},
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    // Get user's primary tenant for in-app notification
    const membership = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.userId, user.id),
        eq(tenantMembers.status, 'active')
      ),
      columns: { tenantId: true },
    });

    // Send backup codes regenerated notification (email + in-app)
    const config = NOTIFICATION_CONFIGS.backup_codes;
    notify({
      userId: user.id,
      tenantId: membership?.tenantId,
      category: config.category,
      type: config.type,
      title: config.title,
      message: config.message as string,
      severity: config.severity,
      actionRoute: config.actionRoute,
      actionLabel: config.actionLabel,
      emailTemplate: EMAIL_TEMPLATES.backupCodesRegenerated({
        firstName: user.firstName || undefined,
        ipAddress: ipAddress || undefined,
        deviceInfo: userAgent || undefined,
      }),
      emailSubject: config.emailSubject,
    }).catch((err) => console.error('[MFA] Notification failed:', err));

    return c.json({
      backup_codes: result.codes,
    });
  }
);

/**
 * GET /api/v1/auth/mfa/status
 * Get MFA status
 */
app.get('/status', authMiddleware, async (c) => {
  const user = c.get('user');

  return c.json({
    enabled: user.mfaEnabled,
  });
});

export default app;
