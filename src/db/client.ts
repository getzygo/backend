/**
 * Database Client
 *
 * PostgreSQL connection using Drizzle ORM.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { getEnv } from '../config/env';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let connection: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (db) return db;

  const env = getEnv();

  // Create PostgreSQL connection
  connection = postgres(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  // Create Drizzle instance with schema
  db = drizzle(connection, { schema });

  return db;
}

export async function closeDb(): Promise<void> {
  if (connection) {
    await connection.end();
    connection = null;
    db = null;
  }
}

export type Database = ReturnType<typeof getDb>;
