module.exports = {
  apps: [
    {
      name: "fs-backend",
      script: "server.js",
      cwd: "/opt/freeswitch-ui/fs-cc/backend",
      watch: false,
      env: {
        NODE_ENV: "development",
        PORT: 4000
      }
    },
    {
      name: "fs-frontend",
      cwd: "/opt/freeswitch-ui/fs-cc/frontend",
      // serves the built pages in dist/ (run scripts/dev-deploy.sh frontend to rebuild)
      script: "node_modules/.bin/vite",
      args: "preview --host 0.0.0.0 --port 8000 --strictPort",
      watch: false,
      env: {
        NODE_ENV: "development"
      }
    },
    {
      name: "fs-agent",
      cwd: "/opt/freeswitch-ui/fs-cc/agent-desktop",
      // serves the built pages in dist/ over HTTPS (run scripts/dev-deploy.sh agent to rebuild)
      script: "node_modules/.bin/vite",
      args: "preview --host 0.0.0.0 --port 8080 --strictPort",
      watch: false,
      env: {
        NODE_ENV: "development"
      }
    }
  ]
};
