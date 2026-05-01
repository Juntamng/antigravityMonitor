/**
 * PM2 — pm2 start ecosystem.config.js
 */
module.exports = {
  apps: [
    {
      name: "page-monitor-agent",
      script: "index.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
