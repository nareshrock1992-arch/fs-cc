// @vitest-environment node
/**
 * The Agent Desktop page server must forward WebSocket upgrades under /api, so the
 * browser phone can reach the FS-CC SIP relay (wss://<desk>/api/sip-relay).
 */
import { describe, expect, it } from 'vitest';
import viteConfig from '../../../../vite.config.js';

describe('Agent Desktop dev/preview proxy', () => {
  const cfg = viteConfig({ mode: 'test', command: 'serve' });
  const proxy = cfg.server.proxy;

  it('forwards WebSocket upgrades for /api (SIP relay)', () => {
    expect(proxy['/api']).toMatchObject({ changeOrigin: true, ws: true });
  });

  it('keeps Socket.IO WebSockets and the backend target unchanged', () => {
    expect(proxy['/socket.io']).toMatchObject({ changeOrigin: true, ws: true });
    expect(proxy['/api'].target).toBe(proxy['/socket.io'].target);
  });
});
