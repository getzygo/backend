/**
 * Password Security Routes
 *
 * POST /api/v1/auth/password/check-breach - Check if password is in known breaches
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { checkPasswordBreach, getBreachMessage, getBreachSeverity } from '../../services/hibp.service';

const app = new Hono();

// Schema for breach check
const checkBreachSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

/**
 * POST /api/v1/auth/password/check-breach
 * Check if a password has been exposed in known data breaches.
 * Uses HIBP k-anonymity - password is never sent to external API.
 *
 * This endpoint does NOT require authentication, allowing checks during:
 * - Signup (before account exists)
 * - Password reset (user may not be logged in)
 * - Login (to warn about compromised passwords)
 */
app.post('/check-breach', zValidator('json', checkBreachSchema), async (c) => {
  const { password } = c.req.valid('json');

  const result = await checkPasswordBreach(password);
  const severity = getBreachSeverity(result.count);
  const message = getBreachMessage(result);

  return c.json({
    breached: result.breached,
    count: result.breached ? result.count : undefined,
    severity,
    message,
    // Don't expose error details to client
    check_available: !result.error,
  });
});

export default app;
