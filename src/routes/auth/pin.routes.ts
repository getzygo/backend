/**
 * PIN Routes
 *
 * POST /api/v1/auth/pin/setup    - Set up PIN (requires password)
 * POST /api/v1/auth/pin/verify   - Verify PIN (idle lock unlock)
 * POST /api/v1/auth/pin/change   - Change PIN (requires current PIN)
 * DELETE /api/v1/auth/pin        - Remove PIN (requires password)
 * GET /api/v1/auth/pin/status    - Check if PIN is set
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireEmailVerified } from '../../middleware/auth.middleware';
import { pinService } from '../../services/pin.service';
import { getDb } from '../../db/client';
import { auditLogs, tenantMembers, tenantSecurityConfig } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '../../middleware/rate-limit.middleware';

const app = new Hono();

// PIN digit schema
const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, 'PIN must be 4 or 6 digits');

/**
 * POST /api/v1/auth/pin/setup
 * Set up a new PIN
 */
app.post(
  '/setup',
  rateLimit(RATE_LIMITS.SENSITIVE),
  authMiddleware,
  requireEmailVerified,
  zValidator(
    'json',
    z.object({
      pin: pinSchema,
      confirm_pin: pinSchema,
      current_password: z.string().min(1),
    })
  ),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    if (body.pin !== body.confirm_pin) {
      return c.json(
        { error: 'pin_mismatch', message: 'PINs do not match' },
        400
      );
    }

    const result = await pinService.setupPin(user.id, body.pin, body.current_password);

    if (!result.success) {
      return c.json(
        { error: 'setup_failed', message: result.error },
        400
      );
    }

    // Audit log
    const db = getDb();
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'pin_setup',
      resourceType: 'user',
      resourceId: user.id,
      details: { pin_length: body.pin.length },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({
      success: true,
      pin_length: body.pin.length,
    });
  }
);

/**
 * POST /api/v1/auth/pin/verify
 * Verify PIN for idle lock unlock
 */
app.post(
  '/verify',
  rateLimit(RATE_LIMITS.SENSITIVE),
  authMiddleware,
  zValidator(
    'json',
    z.object({
      pin: z.string().min(4).max(6),
    })
  ),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    // Use user ID for PIN attempt tracking
    const sessionId = user.id;

    // Get tenant's max attempts setting
    let maxAttempts = 5;
    const db = getDb();
    const membership = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.userId, user.id),
        eq(tenantMembers.status, 'active')
      ),
      columns: { tenantId: true },
    });

    if (membership) {
      const config = await db.query.tenantSecurityConfig.findFirst({
        where: eq(tenantSecurityConfig.tenantId, membership.tenantId),
        columns: { pinMaxAttempts: true },
      });
      if (config?.pinMaxAttempts) {
        maxAttempts = config.pinMaxAttempts;
      }
    }

    const result = await pinService.verifyPin(user.id, sessionId, body.pin, maxAttempts);

    if (!result.verified) {
      return c.json(
        {
          error: result.lockedOut ? 'pin_locked_out' : 'invalid_pin',
          message: result.error,
          attempts_remaining: result.attemptsRemaining,
          locked_out: result.lockedOut,
        },
        result.lockedOut ? 423 : 403
      );
    }

    return c.json({
      verified: true,
    });
  }
);

/**
 * POST /api/v1/auth/pin/change
 * Change PIN (requires current PIN)
 */
app.post(
  '/change',
  rateLimit(RATE_LIMITS.SENSITIVE),
  authMiddleware,
  requireEmailVerified,
  zValidator(
    'json',
    z.object({
      current_pin: z.string().min(4).max(6),
      new_pin: pinSchema,
      confirm_pin: pinSchema,
    })
  ),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    if (body.new_pin !== body.confirm_pin) {
      return c.json(
        { error: 'pin_mismatch', message: 'New PINs do not match' },
        400
      );
    }

    const result = await pinService.changePin(user.id, body.current_pin, body.new_pin);

    if (!result.success) {
      return c.json(
        { error: 'change_failed', message: result.error },
        400
      );
    }

    // Audit log
    const db = getDb();
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'pin_changed',
      resourceType: 'user',
      resourceId: user.id,
      details: { pin_length: body.new_pin.length },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({ success: true });
  }
);

/**
 * DELETE /api/v1/auth/pin
 * Remove PIN (requires password)
 */
app.delete(
  '/',
  rateLimit(RATE_LIMITS.SENSITIVE),
  authMiddleware,
  requireEmailVerified,
  zValidator(
    'json',
    z.object({
      current_password: z.string().min(1),
    })
  ),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    const result = await pinService.removePin(user.id, body.current_password);

    if (!result.success) {
      return c.json(
        { error: 'remove_failed', message: result.error },
        400
      );
    }

    // Audit log
    const db = getDb();
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'pin_removed',
      resourceType: 'user',
      resourceId: user.id,
      details: {},
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      status: 'success',
    });

    return c.json({ success: true });
  }
);

/**
 * GET /api/v1/auth/pin/status
 * Check if PIN is set up
 */
app.get('/status', authMiddleware, async (c) => {
  const user = c.get('user');
  const status = await pinService.getPinStatus(user.id);

  return c.json({
    enabled: status.enabled,
    length: status.length,
  });
});

export default app;
