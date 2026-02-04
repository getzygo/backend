/**
 * PM2 Ecosystem Configuration
 *
 * Defines processes for the Zygo backend:
 * - zygo-api: The main API server
 * - zygo-worker: Background job processor for reminders
 */

module.exports = {
  apps: [
    {
      name: 'zygo-api',
      script: 'dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/zygo/api-error.log',
      out_file: '/var/log/zygo/api-out.log',
      merge_logs: true,
      // Restart behavior
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
    {
      name: 'zygo-worker',
      script: 'dist/worker.js',
      instances: 1, // Only run one worker instance
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/zygo/worker-error.log',
      out_file: '/var/log/zygo/worker-out.log',
      merge_logs: true,
      // Restart behavior
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      // Graceful shutdown - give more time for jobs to complete
      kill_timeout: 30000,
      // Cron restart - restart daily at 4 AM to ensure fresh state
      cron_restart: '0 4 * * *',
    },
  ],
};
