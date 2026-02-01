/**
 * Apply RLS Functions and Policies
 *
 * Runs the RLS SQL files using the existing database connection.
 * Run with: npm run db:apply-rls
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from '../config/env';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment
loadEnv();

async function main() {
  const env = process.env;

  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(env.DATABASE_URL);

  try {
    console.log('Applying RLS functions...');
    const functionsPath = join(__dirname, '../../drizzle/rls-functions.sql');
    const functionsSql = readFileSync(functionsPath, 'utf-8');
    await sql.unsafe(functionsSql);
    console.log('RLS functions applied');

    console.log('Applying RLS policies...');
    const policiesPath = join(__dirname, '../../drizzle/rls-policies.sql');
    const policiesSql = readFileSync(policiesPath, 'utf-8');
    await sql.unsafe(policiesSql);
    console.log('RLS policies applied');

    console.log('RLS setup complete');
  } catch (error) {
    console.error('Failed to apply RLS:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }

  process.exit(0);
}

main();
