/**
 * Database Seeding Script
 *
 * Seeds initial data required for the application to function.
 * Run with: npm run db:seed
 */

import { loadEnv } from '../config/env';
import { getDb, closeDb } from '../db/client';
import { seedPermissions } from '../services/permission.service';

// Load environment
loadEnv();

async function main() {
  console.log('Starting database seeding...');

  try {
    // Initialize database connection
    getDb();

    // Seed permissions
    await seedPermissions();

    console.log('Seeding complete');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }

  process.exit(0);
}

main();
