/**
 * Zygo Backend - Entry Point
 *
 * Starts the Hono server with all configured routes and middleware.
 */

// Load environment variables first
import 'dotenv/config';

import { serve } from '@hono/node-server';
import { loadEnv } from './config/env';
import { app } from './app';
import { getDb, closeDb } from './db/client';
import { getRedis, closeRedis } from './db/redis';
import { initializeDatabase } from './scripts/init';
import { logger } from './utils/logger';

// Load and validate environment variables
const env = loadEnv();

const port = env.PORT;

logger.info(`Starting Zygo API server...`);
logger.info(`Environment: ${env.NODE_ENV}`);

// Initialize connections
async function initializeConnections() {
  // Initialize database
  try {
    logger.info('Connecting to database...');
    getDb();
    logger.info('Database connected');

    // Initialize database (seed if needed)
    await initializeDatabase();
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    process.exit(1);
  }

  // Initialize Redis (optional - API can work without it for basic endpoints)
  try {
    logger.info('Connecting to Redis...');
    const redis = getRedis();
    await redis.ping();
    logger.info('Redis connected');
  } catch (error) {
    logger.warn('Redis not available - some features (OAuth, sessions, caching) will be disabled');
    logger.warn('Redis error:', (error as Error).message);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');

  try {
    await closeDb();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database:', error);
  }

  try {
    await closeRedis();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error('Error closing Redis:', error);
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
      logger.info(`Server running at http://localhost:${info.port}`);
      logger.info(`API available at http://localhost:${info.port}/api/v1`);
      logger.info(`Health check: http://localhost:${info.port}/api/v1/health`);
    }
  );
}

start().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
