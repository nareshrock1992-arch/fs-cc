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

// The backend's per-address limits (e.g. SIP relay connection attempts per minute) must see
// each browser, not this page server: without this every agent arrives as 127.0.0.1 and one
// agent's retries count against all. Same header FS-CP nginx sets. Always OVERWRITES any value
// the browser sent, so a client cannot choose its own address.
export function passClientAddress(proxy) {
  const set = (proxyReq, req) => {
    const ip = req.socket?.remoteAddress;
    if (ip) proxyReq.setHeader('X-Real-IP', ip); else proxyReq.removeHeader('X-Real-IP');
  };
  proxy.on('proxyReq', set);
  proxy.on('proxyReqWs', set);
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
        // ws: true carries the browser-phone SIP relay WebSocket (/api/sip-relay).
        '/api':       { target: backendTarget, changeOrigin: true, ws: true, configure: passClientAddress },
        '/socket.io': { target: backendTarget, changeOrigin: true, ws: true, configure: passClientAddress },
      },
    },
  };
});
