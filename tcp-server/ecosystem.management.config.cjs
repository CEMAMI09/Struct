module.exports = {
  apps: [
    {
      name: 'struct-management',
      script: 'management-worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      kill_timeout: 20000,
      max_memory_restart: '256M',
      env: { STRUCT_DEVICE_OPERATIONS_ENABLED: 'true' },
    },
  ],
}
