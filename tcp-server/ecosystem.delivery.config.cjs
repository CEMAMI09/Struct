// Review-only deployment template. No production PM2 process is modified by tests.
module.exports = {
  apps: [
    {
      name: 'struct-delivery',
      cwd: __dirname,
      script: 'worker.js',
      instances: 1,
      exec_mode: 'fork',
      kill_timeout: 35000,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        STRUCT_DELIVERY_PIPELINE_V2: 'true',
        OUTBOX_CONCURRENCY: '8',
        OUTBOX_IDLE_POLL_MS: '1000',
        OUTBOX_HEALTH_PORT: '9092',
      },
    },
  ],
}
