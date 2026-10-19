// Review-only template. The worker refuses to start until SQL and server flags agree.
module.exports = {
  apps: [
    {
      name: 'struct-fleet',
      cwd: __dirname,
      script: 'fleet-worker.js',
      instances: 1,
      exec_mode: 'fork',
      kill_timeout: 20000,
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production', STRUCT_FLEET_ENABLED: 'true' },
    },
  ],
}
