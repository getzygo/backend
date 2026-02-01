/**
 * Database Initialization Script
 *
 * Called during application startup to ensure required data exists.
 */

import { getDb } from '../db/client';
import { seedPermissions } from '../services/permission.service';

/**
 * Initialize database with required seed data
 * This runs on every app start but only seeds if data is missing
 */
export async function initializeDatabase(): Promise<void> {
  const db = getDb();

  // Check if permissions exist
  const existing = await db.query.permissions.findFirst();
  if (!existing) {
    console.log('Seeding permissions...');
    await seedPermissions();
  }

  console.log('Database initialized');
}
