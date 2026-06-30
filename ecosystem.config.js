module.exports = {
  apps: [
    {
      name: 'walking-dashboard',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3005',
      cwd: '/var/www/walking-dashboard',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
