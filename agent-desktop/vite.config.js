import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Optional HTTPS for the dev server (needed for the browser phone: microphone access
// requires a secure origin). Off unless BOTH paths are set. The files live outside the
// repository; the variables have no VITE_ prefix, so they never reach the browser bundle.
function devHttps(env) {
  const cert = env.DEV_HTTPS_CERT;
  const key  = env.DEV_HTTPS_KEY;
  if (!cert || !key) return undefined;
  return { cert: readFileSync(cert), key: readFileSync(key) };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_BACKEND_DEV_URL || 'http://localhost:4000';

  return {
    plugins: [react()],
    server: {
      host:  true,
      port:  Number(env.VITE_DEV_PORT) || 8080,
      https: devHttps(env),
      proxy: {
        '/api':       { target: backendTarget, changeOrigin: true },
        '/socket.io': { target: backendTarget, changeOrigin: true, ws: true },
      },
    },
  };
});
