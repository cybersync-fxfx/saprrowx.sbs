// PM2 Ecosystem Config — Sparrowx Guard Panel
// Usage: pm2 start ecosystem.config.js
// Reload: pm2 reload sparrowx-panel
// Logs:   pm2 logs sparrowx-panel

module.exports = {
  apps: [
    {
      name: 'sparrowx-panel',
      script: './server.js',
      cwd: __dirname,
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './server-start.err.txt',
      out_file: './server-start.out.txt',
      merge_logs: true,
      // Kill timeout: wait 8s for graceful shutdown before force-kill
      kill_timeout: 8000,
    },
  ],
};
