/** PM2 config for Windows Server */
module.exports = {
  apps: [
    {
      name: 'ai-lpdp',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '5s',
      time: true,
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
    },
  ],
};
