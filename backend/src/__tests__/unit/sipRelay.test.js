/**
 * CP3-C — SIP WebSocket relay security and lifecycle tests.
 * Real ws servers on random local ports: a fake browser client, the relay on an
 * http.Server, and a fake FreeSWITCH upstream. No DB, no FreeSWITCH, no network
 * beyond 127.0.0.1.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/sipRelay.test.js
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createSipRelay, initSipRelay, CLOSE, RELAY_PATH } from '../../../services/sipRelayService.js';
import { createTicketStore } from '../../../services/relayTicketStore.js';
import { sipRequest, sipResponse } from '../helpers/sipMessages.js';

const ORIGIN = 'https://cc.example';
const AGENTS = {
  alice: { agent_id: 'alice', agent_type: 'internal', webrtc_enabled: true, active: true, contact: '{sip_cid_type=pid}user/1001@pbx.example' },
  bob:   { agent_id: 'bob',   agent_type: 'internal', webrtc_enabled: true, active: true, contact: '{sip_cid_type=pid}user/1002@pbx.example' },
  gw:    { agent_id: 'gw',    agent_type: 'gateway',  webrtc_enabled: false, active: true, contact: '{sip_cid_type=pid}sofia/gateway/sp/05' },
  off:   { agent_id: 'off',   agent_type: 'internal', webrtc_enabled: false, active: true, contact: '{sip_cid_type=pid}user/1003@pbx.example' },
  gone:  { agent_id: 'gone',  agent_type: 'internal', webrtc_enabled: true, active: false, contact: '{sip_cid_type=pid}user/1004@pbx.example' },
};
const EXT = { alice: '1001', bob: '1002', gw: '1009', off: '1003', gone: '1004' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(10); }
  throw new Error('timed out waiting for condition');
}

let fs, fsConns, httpServer, relay, store, port, logs, agents, upstreamDelayMs;

async function setup({ mode = 'HYBRID', limits = {}, ticketNow } = {}) {
  agents = structuredClone(AGENTS);
  upstreamDelayMs = 0;
  fsConns = [];
  fs = new WebSocketServer({
    port: 0, host: '127.0.0.1',
    handleProtocols: (p) => (p.has('sip') ? 'sip' : false),
    verifyClient: (_info, cb) => setTimeout(() => cb(true), upstreamDelayMs),
  });
  fs.on('connection', (ws) => {
    const c = { ws, frames: [], protocol: ws.protocol };
    ws.on('message', (d, bin) => c.frames.push(bin ? d : d.toString('utf8')));
    fsConns.push(c);
  });
  await new Promise((r) => fs.on('listening', r));
  store = createTicketStore({ ttlMs: 30_000, now: ticketNow });
  logs = [];
  const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
  httpServer = http.createServer((_q, s) => s.end('ok'));
  relay = createSipRelay({
    server: httpServer,
    telephony: { mode, relayUpstreamUrl: `ws://127.0.0.1:${fs.address().port}` },
    allowedOrigins: [ORIGIN],
    ticketStore: store,
    loadAgent: async (id) => agents[id] || null,
    logger,
    limits,
  });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  port = httpServer.address().port;
}

async function teardown() {
  await relay?.close();
  await new Promise((r) => httpServer.close(() => r()));
  await new Promise((r) => fs.close(() => r()));
}

function ticketFor(agentId) {
  return store.issue({ agentId, extension: EXT[agentId] }).ticket;
}

/** Connect like SIP.js would. Resolves with the result of the handshake. */
function connect(ticket, { origin = ORIGIN, protocol = 'sip', path = RELAY_PATH, autoPong = true } = {}) {
  return new Promise((resolve) => {
    const q = ticket === undefined ? '' : `?ticket=${encodeURIComponent(ticket)}`;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}${q}`, protocol ? [protocol] : [], { origin, autoPong });
    const r = { ws, frames: [], closeCode: null, closeReason: null, status: null };
    ws.on('message', (d) => r.frames.push(d.toString('utf8')));
    ws.on('close', (code, reason) => { r.closeCode = code; r.closeReason = reason.toString(); });
    ws.on('open', () => resolve(r));
    ws.on('unexpected-response', (_req, res) => { r.status = res.statusCode; resolve(r); });
    ws.on('error', () => resolve(r));
  });
}

async function connectedPair(agentId = 'alice') {
  const before = fsConns.length;
  const b = await connect(ticketFor(agentId));
  await waitFor(() => fsConns.length > before && fsConns[fsConns.length - 1].ws.readyState === WebSocket.OPEN);
  await waitFor(() => relay.hasSession(agentId));
  return { b, f: fsConns[fsConns.length - 1] };
}

describe('SIP relay', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await teardown(); });

  describe('SIP WebSocket protocol and framing (RFC 7118)', () => {
    it('valid ticket: both legs negotiate "sip"; frames pass byte-for-byte in both directions', async () => {
      const { b, f } = await connectedPair();
      expect(b.ws.protocol).toBe('sip');
      expect(f.protocol).toBe('sip');
      const reg = sipRequest('REGISTER', { body: '' });
      b.ws.send(reg);
      await waitFor(() => f.frames.length === 1);
      expect(f.frames[0]).toBe(reg);
      const challenge = sipResponse(401, 'Unauthorized', 'REGISTER', ['WWW-Authenticate: Digest realm="pbx.example", nonce="abc"']);
      f.ws.send(challenge);
      await waitFor(() => b.frames.length === 1);
      expect(b.frames[0]).toBe(challenge);
    });

    it('SDP bodies, inbound INVITEs from FreeSWITCH and CRLF keep-alives pass unchanged', async () => {
      const { b, f } = await connectedPair();
      const sdp = 'v=0\r\no=- 1 1 IN IP4 10.0.0.5\r\ns=-\r\nc=IN IP4 10.0.0.5\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-ufrag:x\r\na=fingerprint:sha-256 AA\r\n';
      const invite = sipRequest('INVITE', { from: '1001', to: '5000', extra: ['Content-Type: application/sdp'], body: sdp });
      b.ws.send(invite);
      b.ws.send('\r\n\r\n');
      await waitFor(() => f.frames.length === 2);
      expect(f.frames).toEqual([invite, '\r\n\r\n']);
      const inbound = sipRequest('INVITE', { from: '0500000000', to: '1001', extra: ['Content-Type: application/sdp'], body: sdp });
      f.ws.send(inbound);
      f.ws.send('\r\n');
      await waitFor(() => b.frames.length === 2);
      expect(b.frames).toEqual([inbound, '\r\n']);
    });

    it('frames sent before the upstream is ready are queued and delivered in order', async () => {
      upstreamDelayMs = 200;
      const b = await connect(ticketFor('alice'));
      const msgs = [sipRequest('REGISTER', { cseq: 1 }), '\r\n\r\n', sipRequest('REGISTER', { cseq: 2 })];
      for (const m of msgs) b.ws.send(m);
      await waitFor(() => fsConns[0]?.frames.length === 3);
      expect(fsConns[0].frames).toEqual(msgs);
    });
  });

  describe('ticket checks (before the handshake)', () => {
    it('missing or invalid ticket → HTTP 401, nothing reaches FreeSWITCH', async () => {
      expect((await connect(undefined)).status).toBe(401);
      expect((await connect('not-a-ticket')).status).toBe(401);
      expect(fsConns.length).toBe(0);
    });
    it('reused ticket → 401 on the second use', async () => {
      const t = ticketFor('alice');
      const first = await connect(t);
      expect(first.ws.readyState).toBe(WebSocket.OPEN);
      expect((await connect(t)).status).toBe(401);
    });
    it('wrong Origin → 403; missing "sip" subprotocol → 400 (ticket not consumed)', async () => {
      const t = ticketFor('alice');
      expect((await connect(t, { origin: 'https://evil.example' })).status).toBe(403);
      expect((await connect(t, { protocol: null })).status).toBe(400);
      const ok = await connect(t);
      expect(ok.ws.readyState).toBe(WebSocket.OPEN);
    });
    it('other paths are ignored by the relay (left to Socket.IO / others)', async () => {
      const handled = relay.handleUpgrade({ url: '/socket.io/?EIO=4&transport=websocket', headers: {} }, { writable: true, end() {} }, null);
      expect(handled).toBe(false);
    });
    it('never logs the full ticket', async () => {
      const t = ticketFor('alice');
      await connect(t);
      await connect(t); // reused → logged as rejected with a hint
      const all = logs.join('\n');
      expect(all).toContain('ticket#');
      expect(all).not.toContain(t);
    });
  });

  describe('agent re-authorisation after the handshake', () => {
    it.each([
      ['gateway agent', 'gw'],
      ['browser phone disabled', 'off'],
      ['inactive agent', 'gone'],
    ])('%s → closed 4403, no upstream opened', async (_n, id) => {
      const r = await connect(ticketFor(id));
      await waitFor(() => r.closeCode !== null);
      expect(r.closeCode).toBe(CLOSE.FORBIDDEN);
      expect(fsConns.length).toBe(0);
    });
    it('agent disabled after the ticket was issued → 4403', async () => {
      const t = ticketFor('alice');
      agents.alice.webrtc_enabled = false;
      const r = await connect(t);
      await waitFor(() => r.closeCode !== null);
      expect(r.closeCode).toBe(CLOSE.FORBIDDEN);
    });
    it('contact extension changed after the ticket was issued → 4403', async () => {
      const t = ticketFor('alice');
      agents.alice.contact = '{sip_cid_type=pid}user/1999@pbx.example';
      const r = await connect(t);
      await waitFor(() => r.closeCode !== null);
      expect(r.closeCode).toBe(CLOSE.FORBIDDEN);
    });
  });

  describe('message validation and forwarding control', () => {
    it('REGISTER for another extension → closed 4403 and NOT forwarded', async () => {
      const { b, f } = await connectedPair();
      b.ws.send(sipRequest('REGISTER', { from: '1002' }));
      await waitFor(() => b.closeCode !== null);
      expect(b.closeCode).toBe(CLOSE.FORBIDDEN);
      expect(f.frames).toEqual([]);
    });
    it('digest username for another extension → blocked', async () => {
      const { b, f } = await connectedPair();
      b.ws.send(sipRequest('REGISTER', { auth: '1002' }));
      await waitFor(() => b.closeCode !== null);
      expect(b.closeCode).toBe(CLOSE.FORBIDDEN);
      expect(f.frames).toEqual([]);
    });
    it('INVITE impersonating another extension → blocked', async () => {
      const { b, f } = await connectedPair();
      b.ws.send(sipRequest('INVITE', { from: '1002', to: '5000' }));
      await waitFor(() => b.closeCode !== null);
      expect(f.frames).toEqual([]);
    });
    it('invalid message types: non-SIP text → 4400; binary → 1003', async () => {
      const p1 = await connectedPair();
      p1.b.ws.send('{"hello":"world"}');
      await waitFor(() => p1.b.closeCode !== null);
      expect(p1.b.closeCode).toBe(CLOSE.BAD_FRAME);
      const p2 = await connectedPair();
      p2.b.ws.send(Buffer.from([1, 2, 3]));
      await waitFor(() => p2.b.closeCode !== null);
      expect(p2.b.closeCode).toBe(CLOSE.UNSUPPORTED);
      expect(p2.f.frames).toEqual([]);
    });
    it('oversized payload (> 64 KiB) → closed 1009, not forwarded', async () => {
      const { b, f } = await connectedPair();
      b.ws.send(sipRequest('MESSAGE', { to: '5000', body: 'x'.repeat(70 * 1024) }));
      await waitFor(() => b.closeCode !== null);
      expect(b.closeCode).toBe(CLOSE.TOO_BIG);
      expect(f.frames).toEqual([]);
    });
  });

  // Lab finding 2026-11-23: on a queue call FreeSWITCH sends the INVITE to the phone's
  // random contact user (sip:i5gk7ss1@…;transport=wss), so the browser's in-dialog
  // requests carry neither From nor To = extension. They were blocked (4403) and the
  // phone reconnected during every answered call.
  describe('calls that belong to this phone (in-dialog requests)', () => {
    // Caller is an outside number so neither From nor To matches any test extension.
    const inbound = (callId) => sipRequest('INVITE', { from: '0500000000', to: 'i5gk7ss1', callId, extra: ['Content-Type: application/sdp'], body: 'v=0\r\n' });
    const fromPhone = (method, callId) => sipRequest(method, { from: 'i5gk7ss1', to: '0500000000', toTag: true, callId });

    it('inbound call to the random contact user: BYE, re-INVITE and INFO are forwarded, connection stays open', async () => {
      const { b, f } = await connectedPair();
      f.ws.send(inbound('in-1'));
      await waitFor(() => b.frames.length === 1);
      const msgs = [fromPhone('INVITE', 'in-1'), fromPhone('INFO', 'in-1'), fromPhone('BYE', 'in-1')];
      for (const m of msgs) b.ws.send(m);
      await waitFor(() => f.frames.length === 3);
      expect(f.frames).toEqual(msgs);
      expect(b.closeCode).toBeNull();
    });
    it('in-dialog request for a call this phone never saw → 4403, not forwarded', async () => {
      const { b, f } = await connectedPair();
      f.ws.send(inbound('in-1'));
      await waitFor(() => b.frames.length === 1);
      b.ws.send(fromPhone('BYE', 'someone-elses-call'));
      await waitFor(() => b.closeCode !== null);
      expect(b.closeCode).toBe(CLOSE.FORBIDDEN);
      expect(f.frames).toEqual([]);
    });
    it("a call sent to alice's phone cannot be used from bob's connection", async () => {
      const a = await connectedPair('alice');
      const bb = await connectedPair('bob');
      a.f.ws.send(inbound('alice-call'));
      await waitFor(() => a.b.frames.length === 1);
      bb.b.ws.send(sipRequest('BYE', { from: 'i5gk7ss1', to: '0500000000', toTag: true, callId: 'alice-call' }));
      await waitFor(() => bb.b.closeCode !== null);
      expect(bb.b.closeCode).toBe(CLOSE.FORBIDDEN);
      expect(bb.f.frames).toEqual([]);
    });
    it('a known call never relaxes the identity checks (REGISTER / new INVITE as another extension)', async () => {
      const p1 = await connectedPair();
      p1.f.ws.send(inbound('in-1'));
      await waitFor(() => p1.b.frames.length === 1);
      p1.b.ws.send(sipRequest('REGISTER', { from: '1002', callId: 'in-1' }));
      await waitFor(() => p1.b.closeCode !== null);
      expect(p1.b.closeCode).toBe(CLOSE.FORBIDDEN);
      expect(p1.f.frames).toEqual([]);
      const p2 = await connectedPair();
      p2.f.ws.send(inbound('in-2'));
      await waitFor(() => p2.b.frames.length === 1);
      p2.b.ws.send(sipRequest('INVITE', { from: '1002', to: '5000', callId: 'in-2' }));
      await waitFor(() => p2.b.closeCode !== null);
      expect(p2.f.frames).toEqual([]);
    });
    it('after BYE the call is forgotten (short linger); the list is bounded', async () => {
      await teardown();
      await setup({ limits: { dialogLingerMs: 50, maxDialogs: 2 } });
      const p1 = await connectedPair();
      p1.f.ws.send(inbound('in-1'));
      await waitFor(() => p1.b.frames.length === 1);
      p1.b.ws.send(fromPhone('BYE', 'in-1'));
      await waitFor(() => p1.f.frames.length === 1);
      await sleep(120);
      p1.b.ws.send(fromPhone('INFO', 'in-1'));
      await waitFor(() => p1.b.closeCode !== null);
      expect(p1.b.closeCode).toBe(CLOSE.FORBIDDEN);

      const p2 = await connectedPair();
      for (const id of ['c1', 'c2', 'c3']) p2.f.ws.send(inbound(id));
      await waitFor(() => p2.b.frames.length === 3);
      p2.b.ws.send(fromPhone('INFO', 'c3'));          // newest: still known
      await waitFor(() => p2.f.frames.length === 1);
      p2.b.ws.send(fromPhone('INFO', 'c1'));          // oldest: dropped by the bound
      await waitFor(() => p2.b.closeCode !== null);
      expect(p2.b.closeCode).toBe(CLOSE.FORBIDDEN);
      expect(p2.f.frames.length).toBe(1);
    });
  });

  describe('multi-agent isolation', () => {
    it('each agent gets its own upstream; traffic never crosses', async () => {
      const a = await connectedPair('alice');
      const b = await connectedPair('bob');
      expect(a.f).not.toBe(b.f);
      a.b.ws.send(sipRequest('REGISTER', { from: '1001' }));
      b.b.ws.send(sipRequest('REGISTER', { from: '1002' }));
      await waitFor(() => a.f.frames.length === 1 && b.f.frames.length === 1);
      expect(a.f.frames[0]).toContain('sip:1001@');
      expect(b.f.frames[0]).toContain('sip:1002@');
      a.f.ws.send(sipResponse(200, 'OK', 'REGISTER', ['Contact: <sip:x@y>;expires=300']));
      await waitFor(() => a.b.frames.length === 1);
      await sleep(50);
      expect(b.b.frames).toEqual([]);
    });
    it('alice cannot send bob-owned SIP even with her own valid ticket', async () => {
      const a = await connectedPair('alice');
      a.b.ws.send(sipRequest('SUBSCRIBE', { from: '1002', to: '1002' }));
      await waitFor(() => a.b.closeCode !== null);
      expect(a.f.frames).toEqual([]);
    });
    it('a second connection for the same agent replaces the first (4409)', async () => {
      const first = await connectedPair('alice');
      const second = await connectedPair('alice');
      await waitFor(() => first.b.closeCode !== null);
      expect(first.b.closeCode).toBe(CLOSE.REPLACED);
      expect(second.b.ws.readyState).toBe(WebSocket.OPEN);
      expect(relay.stats().sessions).toBe(1);
    });
  });

  describe('disconnect, reconnect and heartbeat', () => {
    it('browser disconnect closes the upstream; reconnect with a new ticket works', async () => {
      const p = await connectedPair();
      p.b.ws.close();
      await waitFor(() => p.f.ws.readyState === WebSocket.CLOSED);
      const again = await connectedPair();
      expect(again.b.ws.readyState).toBe(WebSocket.OPEN);
    });
    it('FreeSWITCH disconnect closes the browser with 4502', async () => {
      const p = await connectedPair();
      p.f.ws.close();
      await waitFor(() => p.b.closeCode !== null);
      expect(p.b.closeCode).toBe(CLOSE.UPSTREAM_CLOSED);
    });
    it('FreeSWITCH unreachable → browser closed with 4504', async () => {
      await teardown();
      await setup();
      await new Promise((r) => fs.close(() => r())); // upstream gone
      fs = { close: (cb) => cb() };
      const r = await connect(ticketFor('alice'));
      await waitFor(() => r.closeCode !== null);
      expect(r.closeCode).toBe(CLOSE.UPSTREAM_FAILED);
    });
  });

  describe('relay + phone presence (CP3-D integration)', () => {
    it('browser refresh (new connection replaces the old) never puts the phone into grace', async () => {
      const { createPhonePresence } = await import('../../../services/phonePresenceService.js');
      const applyPhoneOffline = async () => true;
      const presence = createPhonePresence({
        getMode: () => 'HYBRID', graceMs: 15_000, relay, applyPhoneOffline,
        loadAgent: async (id) => ({ ...agents[id], status: 'Available', state: 'Waiting' }),
        logger: { info() {}, warn() {}, error() {} },
      });
      presence.attach({ relayEvents: relay.events });
      const first = await connectedPair('alice');
      first.b.ws.send(sipRequest('REGISTER', { auth: '1001' }));
      await waitFor(() => first.f.frames.length === 1);
      first.f.ws.send(sipResponse(200, 'OK', 'REGISTER', ['Contact: <sip:x@y>;expires=300']));
      await waitFor(() => presence.getPhoneStatus('alice') === 'online');
      const second = await connectedPair('alice'); // refresh
      await waitFor(() => first.b.closeCode !== null);
      expect(presence.getPhoneStatus('alice')).toBe('online');
      second.b.ws.close(); // tab closed for real → grace starts
      await waitFor(() => presence.getPhoneStatus('alice') === 'grace');
      presence.stop();
    });
  });

  describe('events for CP3-D', () => {
    it('emits session-open, registered, unregistered and session-close', async () => {
      const seen = [];
      for (const e of ['session-open', 'registered', 'unregistered', 'session-close']) relay.events.on(e, (p) => seen.push([e, p.agentId]));
      const p = await connectedPair();
      p.b.ws.send(sipRequest('REGISTER', { auth: '1001' }));
      await waitFor(() => p.f.frames.length === 1);
      p.f.ws.send(sipResponse(200, 'OK', 'REGISTER', ['Contact: <sip:x@y>;expires=300']));
      await waitFor(() => seen.some(([e]) => e === 'registered'));
      p.b.ws.close();
      await waitFor(() => seen.some(([e]) => e === 'session-close'));
      expect(seen.map(([e]) => e)).toEqual(['session-open', 'registered', 'unregistered', 'session-close']);
    });
  });
});

describe('SIP relay — limits', () => {
  afterEach(async () => { await teardown(); });

  it('frame rate limit → closed 1008', async () => {
    await setup({ limits: { framesPerSec: 5, frameBurst: 5 } });
    const { b } = await connectedPair();
    for (let i = 0; i < 20; i++) b.ws.send('\r\n\r\n');
    await waitFor(() => b.closeCode !== null);
    expect(b.closeCode).toBe(CLOSE.POLICY);
  });

  it('upgrade attempts per IP are limited → 429', async () => {
    await setup({ limits: { upgradesPerIpPerMin: 3 } });
    for (let i = 0; i < 3; i++) await connect('bad');
    expect((await connect(ticketFor('alice'))).status).toBe(429);
  });

  it('global connection cap → 503', async () => {
    await setup({ limits: { maxConnections: 1 } });
    await connectedPair('alice');
    expect((await connect(ticketFor('bob'))).status).toBe(503);
  });

  it('repeated SIP sign-in failures close the agent (4429) and block new connections (429)', async () => {
    await setup({ limits: { authFailMax: 3 } });
    const { b, f } = await connectedPair();
    for (let i = 0; i < 3; i++) {
      b.ws.send(sipRequest('REGISTER', { auth: '1001', cseq: i + 1 }));
      await waitFor(() => f.frames.length === i + 1);
      f.ws.send(sipResponse(403, 'Forbidden', 'REGISTER'));
    }
    await waitFor(() => b.closeCode !== null);
    expect(b.closeCode).toBe(CLOSE.AUTH_LIMIT);
    expect((await connect(ticketFor('alice'))).status).toBe(429);
    expect((await connect(ticketFor('bob'))).ws.readyState).toBe(WebSocket.OPEN); // other agents unaffected
  });

  it('the normal first 401 challenge is not counted as a failure', async () => {
    await setup({ limits: { authFailMax: 1 } });
    const { b, f } = await connectedPair();
    b.ws.send(sipRequest('REGISTER')); // no Authorization yet
    await waitFor(() => f.frames.length === 1);
    f.ws.send(sipResponse(401, 'Unauthorized', 'REGISTER'));
    await sleep(100);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('browser that stops answering pings is disconnected', async () => {
    await setup({ limits: { pingIntervalMs: 50, pongTimeoutMs: 80, heartbeatTickMs: 20 } });
    const r = await connect(ticketFor('alice'), { autoPong: false });
    await waitFor(() => r.closeCode !== null, 3000);
    expect(r.ws.readyState).toBe(WebSocket.CLOSED);
    expect(logs.join('\n')).toMatch(/browser heartbeat timeout/);
  });

  it('expired ticket → 401', async () => {
    let t = 1_000_000;
    await setup({ ticketNow: () => t });
    const ticket = ticketFor('alice');
    t += 30_000;
    expect((await connect(ticket)).status).toBe(401);
  });
});

describe('SIP relay — coexistence with Socket.IO on the same server', () => {
  afterEach(async () => { await teardown(); });
  it('relay sessions survive engine.io\'s 1 s "unknown upgrade" timer; Socket.IO still serves its own path', async () => {
    await setup();
    const { Server } = await import('socket.io');
    const io = new Server(httpServer, { cors: { origin: [ORIGIN] } }); // same options style as socketService.js
    const { b, f } = await connectedPair();
    await sleep(1500);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
    b.ws.send(sipRequest('REGISTER'));
    await waitFor(() => f.frames.length === 1);
    // Socket.IO's own WebSocket transport still upgrades on /socket.io/.
    const sio = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    const opened = await new Promise((r) => { sio.on('open', () => r(true)); sio.on('error', () => r(false)); });
    expect(opened).toBe(true);
    sio.close();
    io.close();
  });
});

describe('SIP relay — customer mode and shutdown', () => {
  it('EXTERNAL_PBX: initSipRelay attaches nothing', () => {
    const server = http.createServer();
    const r = initSipRelay({ server, config: { telephony: { mode: 'EXTERNAL_PBX' }, cors: { origin: [ORIGIN] } } });
    expect(r).toBeNull();
    expect(server.listenerCount('upgrade')).toBe(0);
  });

  it('HYBRID and FREESWITCH_WEBRTC: initSipRelay attaches exactly one upgrade listener', async () => {
    for (const mode of ['HYBRID', 'FREESWITCH_WEBRTC']) {
      const server = http.createServer();
      const r = initSipRelay({ server, config: { telephony: { mode, relayUpstreamUrl: 'ws://127.0.0.1:9' }, cors: { origin: [ORIGIN] } }, ticketStore: createTicketStore(), loadAgent: async () => null, logger: { info() {}, warn() {}, error() {} } });
      expect(server.listenerCount('upgrade')).toBe(1);
      await r.close();
      expect(server.listenerCount('upgrade')).toBe(0);
    }
  });

  it('EXTERNAL_PBX agents are refused even if a relay were reached', async () => {
    await setup({ mode: 'EXTERNAL_PBX' });
    const r = await connect(ticketFor('alice'));
    await waitFor(() => r.closeCode !== null);
    expect(r.closeCode).toBe(CLOSE.FORBIDDEN);
    await teardown();
  });

  it('graceful shutdown closes browsers with 1001 and upstreams, then stops accepting', async () => {
    await setup();
    const a = await connectedPair('alice');
    const b = await connectedPair('bob');
    await relay.close();
    await waitFor(() => a.b.closeCode !== null && b.b.closeCode !== null);
    expect(a.b.closeCode).toBe(CLOSE.GOING_AWAY);
    expect(b.b.closeCode).toBe(CLOSE.GOING_AWAY);
    await waitFor(() => a.f.ws.readyState === WebSocket.CLOSED && b.f.ws.readyState === WebSocket.CLOSED);
    expect(relay.stats()).toMatchObject({ sessions: 0, accepting: false });
    const sock = { writable: true, out: '', end(s) { this.out = s; } };
    relay.handleUpgrade({ url: `${RELAY_PATH}?ticket=x`, headers: {} }, sock, null);
    expect(sock.out).toMatch(/^HTTP\/1\.1 503/);
    relay = null; // already closed
    await new Promise((r) => httpServer.close(() => r()));
    await new Promise((r) => fs.close(() => r()));
  });
});
