/**
 * Zygo Backend - Worker Entry Point
 *
 * Starts the BullMQ worker for background job processing.
 * Handles reminder notifications (MFA, phone verification, trial expiration).
 */

// Load environment variables first
import 'dotenv/config';

import { loadEnv } from './config/env';
import { getDb, closeDb } from './db/client';
import { getRedis, closeRedis } from './db/redis';
import { closeQueues } from './queues';
import { setupReminderSchedules } from './queues/scheduler';
import { startReminderWorker, stopReminderWorker } from './queues/workers/reminder.worker';

// Load and validate environment variables
const env = loadEnv();

console.log('Starting Zygo Worker...');
console.log(`Environment: ${env.NODE_ENV}`);

// Track if shutdown is in progress
let isShuttingDown = false;

/**
 * Initialize database and Redis connections
 */
async function initializeConnections(): Promise<void> {
  // Initialize database
  try {
    console.log('Connecting to database...');
    getDb();
    console.log('Database connected');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }

  // Initialize Redis (required for worker)
  try {
    console.log('Connecting to Redis...');
    const redis = getRedis();
    await redis.ping();
    console.log('Redis connected');
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    console.error('Redis is required for the worker to function');
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  // Stop accepting new jobs
  try {
    console.log('Stopping reminder worker...');
    await stopReminderWorker();
    console.log('Reminder worker stopped');
  } catch (error) {
    console.error('Error stopping worker:', error);
  }

  // Close queue connections
  try {
    console.log('Closing queue connections...');
    await closeQueues();
    console.log('Queue connections closed');
  } catch (error) {
    console.error('Error closing queues:', error);
  }

  // Close database connection
  try {
    console.log('Closing database connection...');
    await closeDb();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error closing database:', error);
  }

  // Close Redis connection
  try {
    console.log('Closing Redis connection...');
    await closeRedis();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error closing Redis:', error);
  }

  console.log('Shutdown complete');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException').catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit on unhandled rejection, just log it
});

/**
 * Start the worker
 */
async function start(): Promise<void> {
  // Initialize connections
  await initializeConnections();

  // Setup reminder schedules (repeatable jobs)
  console.log('Setting up reminder schedules...');
  await setupReminderSchedules();

  // Start the worker
  console.log('Starting reminder worker...');
  startReminderWorker();

  console.log('Worker is running and waiting for jobs...');
  console.log('Press Ctrl+C to stop');
}

// Start the worker
start().catch((error) => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
