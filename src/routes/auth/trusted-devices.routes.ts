/**
 * Trusted Devices Routes
 *
 * POST /api/v1/auth/mfa/trust-device - Trust current device for 30 days
 * GET /api/v1/auth/mfa/trusted-devices - List trusted devices
 * POST /api/v1/auth/mfa/check-trust - Check if current device is trusted
 * DELETE /api/v1/auth/mfa/trusted-devices/:id - Remove device trust
 * DELETE /api/v1/auth/mfa/trusted-devices - Remove all trusted devices
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  trustDevice,
  isDeviceTrusted,
  getUserTrustedDevices,
  untrustDevice,
  untrustAllDevices,
} from '../../services/trusted-device.service';

const app = new Hono();

/**
 * POST /api/v1/auth/mfa/trust-device
 * Trust the current device to skip MFA for 30 days.
 */
app.post('/trust-device', authMiddleware, async (c) => {
  const user = c.get('user');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const acceptLanguage = c.req.header('accept-language');

  const device = await trustDevice({
    userId: user.id,
    userAgent,
    acceptLanguage,
    ipAddress,
  });

  return c.json({
    success: true,
    message: 'Device trusted for 30 days',
    trusted_until: device.trustedUntil.toISOString(),
  });
});

/**
 * GET /api/v1/auth/mfa/trusted-devices
 * List all trusted devices for the current user.
 */
app.get('/trusted-devices', authMiddleware, async (c) => {
  const user = c.get('user');

  const devices = await getUserTrustedDevices(user.id);

  return c.json({
    devices: devices.map((device) => ({
      id: device.id,
      device_name: device.deviceName,
      browser: device.browser,
      os: device.os,
      trusted_until: device.trustedUntil.toISOString(),
      created_at: device.createdAt.toISOString(),
    })),
  });
});

/**
 * POST /api/v1/auth/mfa/check-trust
 * Check if the current device is trusted.
 * Can be called during login to skip MFA if device is trusted.
 */
app.post('/check-trust', authMiddleware, async (c) => {
  const user = c.get('user');
  const userAgent = c.req.header('user-agent');
  const acceptLanguage = c.req.header('accept-language');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');

  const trusted = await isDeviceTrusted({
    userId: user.id,
    userAgent,
    acceptLanguage,
    ipAddress,
  });

  return c.json({
    trusted,
    mfa_required: !trusted && user.mfaEnabled,
  });
});

/**
 * DELETE /api/v1/auth/mfa/trusted-devices/:id
 * Remove trust from a specific device.
 */
app.delete('/trusted-devices/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const deviceId = c.req.param('id');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const success = await untrustDevice(deviceId, user.id, ipAddress, userAgent);

  if (!success) {
    return c.json(
      {
        error: 'device_not_found',
        message: 'Trusted device not found',
      },
      404
    );
  }

  return c.json({
    success: true,
    message: 'Device trust removed',
  });
});

/**
 * DELETE /api/v1/auth/mfa/trusted-devices
 * Remove trust from all devices.
 */
app.delete('/trusted-devices', authMiddleware, async (c) => {
  const user = c.get('user');
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');

  const count = await untrustAllDevices(user.id, ipAddress, userAgent);

  return c.json({
    success: true,
    message: `${count} device${count !== 1 ? 's' : ''} untrusted`,
    removed_count: count,
  });
});

export default app;
