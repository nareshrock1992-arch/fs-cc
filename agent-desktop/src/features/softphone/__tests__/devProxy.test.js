// @vitest-environment node
/**
 * The Agent Desktop page server must forward WebSocket upgrades under /api, so the
 * browser phone can reach the FS-CC SIP relay (wss://<desk>/api/sip-relay).
 */
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import viteConfig, { passClientAddress } from '../../../../vite.config.js';

describe('Agent Desktop dev/preview proxy', () => {
  const cfg = viteConfig({ mode: 'test', command: 'serve' });
  const proxy = cfg.server.proxy;

  it('forwards WebSocket upgrades for /api (SIP relay)', () => {
    expect(proxy['/api']).toMatchObject({ changeOrigin: true, ws: true });
  });

  it('tells the backend each browser\'s own address (X-Real-IP), for HTTP and WebSockets', () => {
    expect(proxy['/api'].configure).toBe(passClientAddress);
    expect(proxy['/socket.io'].configure).toBe(passClientAddress);
    const p = new EventEmitter();
    passClientAddress(p);
    for (const evt of ['proxyReq', 'proxyReqWs']) {
      const headers = { 'x-real-ip': '6.6.6.6' };                 // spoofed by the browser
      const proxyReq = { setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, removeHeader: (k) => { delete headers[k.toLowerCase()]; } };
      p.emit(evt, proxyReq, { socket: { remoteAddress: '192.168.1.50' } });
      expect(headers['x-real-ip']).toBe('192.168.1.50');           // overwritten, never trusted
    }
  });

  it('keeps Socket.IO WebSockets and the backend target unchanged', () => {
    expect(proxy['/socket.io']).toMatchObject({ changeOrigin: true, ws: true });
    expect(proxy['/api'].target).toBe(proxy['/socket.io'].target);
  });
});
