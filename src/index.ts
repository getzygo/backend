/**
 * Zygo Backend - Entry Point
 *
 * Starts the Hono server with all configured routes and middleware.
 */

import { serve } from '@hono/node-server';
import { loadEnv } from './config/env';
import { app } from './app';
import { getDb, closeDb } from './db/client';
import { getRedis, closeRedis } from './db/redis';
import { initializeDatabase } from './scripts/init';

// Load and validate environment variables
const env = loadEnv();

const port = env.PORT;

console.log(`Starting Zygo API server...`);
console.log(`Environment: ${env.NODE_ENV}`);

// Initialize connections
async function initializeConnections() {
  // Initialize database
  try {
    console.log('Connecting to database...');
    getDb();
    console.log('Database connected');

    // Initialize database (seed if needed)
    await initializeDatabase();
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }

  // Initialize Redis (optional - API can work without it for basic endpoints)
  try {
    console.log('Connecting to Redis...');
    const redis = getRedis();
    await redis.ping();
    console.log('Redis connected');
  } catch (error) {
    console.warn('Redis not available - some features (OAuth, sessions, caching) will be disabled');
    console.warn('Redis error:', (error as Error).message);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('\nShutting down...');

  try {
    await closeDb();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error closing database:', error);
  }

  try {
    await closeRedis();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error closing Redis:', error);
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
async function start() {
  await initializeConnections();

  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      console.log(`Server running at http://localhost:${info.port}`);
      console.log(`API available at http://localhost:${info.port}/api/v1`);
      console.log(`Health check: http://localhost:${info.port}/api/v1/health`);
    }
  );
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
