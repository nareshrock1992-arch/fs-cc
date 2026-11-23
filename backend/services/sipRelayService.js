/**
 * Secure SIP WebSocket relay for the FS-CC browser phone (CP3-C).
 *
 *   Browser (SIP.js) ──WS "sip"──► FS-CC /api/sip-relay ──WS "sip"──► FreeSWITCH ws/wss binding
 *
 * - Signalling only. RTP/SRTP media still flows browser ↔ FreeSWITCH directly.
 * - SIP digest authentication stays end-to-end between browser and FreeSWITCH;
 *   the relay never sees or stores the SIP password.
 * - Frames are forwarded unchanged (no rewriting, no re-framing); browser frames
 *   are validated and must carry the ticket-bound extension (sipFrame.js).
 * - One upstream connection per browser connection; one relay session per agent.
 * - Never logs frames, SDP, ticket values or Authorization headers.
 *
 * Not attached at all when TELEPHONY_MODE=EXTERNAL_PBX (see server.js).
 */
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { checkOutboundFrame, parseSipFrame, isKeepAlive, registerExpires } from './sipFrame.js';
import { ticketHint } from './relayTicketStore.js';
import { effectiveWebrtc, modeAllowsWebrtc } from '../utils/telephony.js';

export const RELAY_PATH = '/api/sip-relay';

export const DEFAULTS = Object.freeze({
  maxPayload: 64 * 1024,
  maxConnections: 500,
  upgradesPerIpPerMin: 20,
  framesPerSec: 30,
  frameBurst: 60,
  pendingMaxFrames: 20,
  pingIntervalMs: 20_000,
  pongTimeoutMs: 10_000,
  heartbeatTickMs: 5_000,
  upstreamTimeoutMs: 10_000,
  authFailMax: 5,
  authFailWindowMs: 5 * 60_000,
  shutdownGraceMs: 5_000,
  maxDialogs: 64,          // calls remembered per phone connection
  dialogLingerMs: 32_000,  // keep a call after BYE/CANCEL for late responses (SIP Timer B/F)
});

// Close codes sent to the browser (4xxx = application specific).
export const CLOSE = {
  NORMAL: 1000, GOING_AWAY: 1001, UNSUPPORTED: 1003, POLICY: 1008, TOO_BIG: 1009, UPSTREAM_ERROR: 1011,
  BAD_FRAME: 4400, FORBIDDEN: 4403, REPLACED: 4409, AUTH_LIMIT: 4429, UPSTREAM_CLOSED: 4502, UPSTREAM_FAILED: 4504,
};

function rejectUpgrade(socket, status, text) {
  if (!socket.writable) return socket.destroy();
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function clientIp(req) {
  // Behind nginx the immediate peer is the proxy; X-Real-IP is set by FS-CP nginx.
  const real = req.headers['x-real-ip'];
  return (typeof real === 'string' && real.trim()) || req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {object} opts
 * @param {import('node:http').Server} [opts.server] attach to this server's 'upgrade' event
 * @param {object} opts.telephony config.telephony
 * @param {string[]} opts.allowedOrigins config.cors.origin
 * @param {{ consume(t:string): any }} opts.ticketStore
 * @param {(agentId:string) => Promise<object|null>} opts.loadAgent
 * @param {object} [opts.limits] overrides of DEFAULTS
 * @param {object} [opts.logger] { info, warn, error }
 * @param {() => number} [opts.now]
 */
export function createSipRelay({
  server, telephony, allowedOrigins, ticketStore, loadAgent,
  limits = {}, logger = console, now = Date.now,
}) {
  const L = { ...DEFAULTS, ...limits };
  const events = new EventEmitter();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: L.maxPayload,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has('sip') ? 'sip' : false),
  });
  const origins = new Set((allowedOrigins || []).map((o) => o.replace(/\/$/, '')));
  const sessions = new Map();      // connId -> session
  const byAgent = new Map();       // agentId -> session
  const upgradeHits = new Map();   // ip -> timestamps
  const authFails = new Map();     // agentId -> timestamps
  let accepting = true;
  let pending = 0;                 // upgrades between consume and session registration

  let tlsOptions = {};
  if (telephony.relayCaFile) tlsOptions.ca = readFileSync(telephony.relayCaFile);
  if (telephony.relayTlsInsecure) tlsOptions.rejectUnauthorized = false;

  const log = (lvl, msg, s) => logger[lvl](`[sip-relay] ${msg}${s ? ` conn=${s.id} agent=${s.agentId} ext=${s.extension} ip=${s.ip}` : ''}`);

  function recent(map, key, windowMs) {
    const cutoff = now() - windowMs;
    const list = (map.get(key) || []).filter((t) => t > cutoff);
    if (list.length) map.set(key, list); else map.delete(key);
    return list;
  }

  function authBlocked(agentId) {
    return recent(authFails, agentId, L.authFailWindowMs).length >= L.authFailMax;
  }

  // ── Upgrade (synchronous checks only, so the 101 is written immediately) ──────
  function handleUpgrade(req, socket, head) {
    let url;
    try { url = new URL(req.url, 'http://relay.local'); } catch { return false; }
    if (url.pathname !== RELAY_PATH) return false; // not ours (e.g. Socket.IO)

    const ip = clientIp(req);
    if (!accepting) { rejectUpgrade(socket, 503, 'Service Unavailable'); return true; }
    if (sessions.size + pending >= L.maxConnections) {
      log('warn', `rejected: connection cap reached (ip=${ip})`);
      rejectUpgrade(socket, 503, 'Service Unavailable'); return true;
    }
    const hits = recent(upgradeHits, ip, 60_000);
    if (hits.length >= L.upgradesPerIpPerMin) {
      log('warn', `rejected: upgrade rate limit (ip=${ip})`);
      rejectUpgrade(socket, 429, 'Too Many Requests'); return true;
    }
    upgradeHits.set(ip, [...hits, now()]);

    const origin = (req.headers.origin || '').replace(/\/$/, '');
    if (!origin || !origins.has(origin)) {
      log('warn', `rejected: origin not allowed (ip=${ip})`);
      rejectUpgrade(socket, 403, 'Forbidden'); return true;
    }
    const protos = String(req.headers['sec-websocket-protocol'] || '').split(',').map((p) => p.trim());
    if (!protos.includes('sip')) {
      log('warn', `rejected: missing "sip" subprotocol (ip=${ip})`);
      rejectUpgrade(socket, 400, 'Bad Request'); return true;
    }
    const ticket = url.searchParams.get('ticket');
    const binding = ticketStore.consume(ticket);
    if (!binding) {
      log('warn', `rejected: invalid, expired or reused ${ticketHint(ticket)} (ip=${ip})`);
      rejectUpgrade(socket, 401, 'Unauthorized'); return true;
    }
    if (authBlocked(binding.agentId)) {
      log('warn', `rejected: SIP auth failure limit for agent=${binding.agentId} (ip=${ip})`);
      rejectUpgrade(socket, 429, 'Too Many Requests'); return true;
    }

    pending++;
    wss.handleUpgrade(req, socket, head, (ws) => {
      pending--;
      onBrowserConnected(ws, binding, ip).catch((err) => {
        log('error', `session setup failed: ${err.message}`);
        try { ws.close(CLOSE.UPSTREAM_ERROR, 'relay error'); } catch { /* ignore */ }
      });
    });
    return true;
  }

  function closeSession(s, code, reason) {
    if (s.closed) return;
    s.closed = true;
    for (const t of s.dialogs.values()) if (t) clearTimeout(t);
    s.dialogs.clear();
    sessions.delete(s.id);
    if (byAgent.get(s.agentId) === s) byAgent.delete(s.agentId);
    const safeReason = String(reason || '').slice(0, 100);
    for (const w of [s.browser, s.upstream]) {
      if (!w) continue;
      try {
        if (w.readyState === WebSocket.OPEN) w.close(w === s.browser ? code : CLOSE.NORMAL, w === s.browser ? safeReason : '');
        else if (w.readyState === WebSocket.CONNECTING) w.terminate();
      } catch { /* ignore */ }
    }
    if (s.registered) events.emit('unregistered', { agentId: s.agentId, extension: s.extension, reason: 'session closed' });
    log('info', `closed code=${code} reason="${safeReason}" up=${s.framesUp} down=${s.framesDown}`, s);
    events.emit('session-close', { agentId: s.agentId, extension: s.extension, code, reason: safeReason });
  }

  async function onBrowserConnected(browser, binding, ip) {
    const s = {
      id: randomBytes(6).toString('hex'), agentId: binding.agentId, extension: binding.extension, ip,
      browser, upstream: null, queue: [], queuedBytes: 0, closed: false, registered: false,
      tokens: L.frameBurst, lastRefill: now(), framesUp: 0, framesDown: 0, lastRegisterHadAuth: false,
      dialogs: new Map(),   // Call-IDs of calls that belong to this phone (see trackDialog)
      alive: { browser: { pingAt: 0, waiting: false }, upstream: { pingAt: 0, waiting: false } },
    };
    sessions.set(s.id, s);

    browser.on('message', (data, isBinary) => onBrowserFrame(s, data, isBinary));
    browser.on('pong', () => { s.alive.browser.waiting = false; });
    browser.on('close', () => closeSession(s, CLOSE.NORMAL, 'browser closed'));
    browser.on('error', (err) => {
      const tooBig = /max payload/i.test(err.message);
      closeSession(s, tooBig ? CLOSE.TOO_BIG : CLOSE.POLICY, tooBig ? 'frame too large' : 'browser error');
    });

    // Server-side re-authorisation on every new connection (never trust the client).
    const agent = await loadAgent(s.agentId);
    if (s.closed) return;
    const eff = effectiveWebrtc(agent, telephony.mode);
    if (!eff.allowed || eff.extension !== s.extension) {
      log('warn', `rejected after handshake: ${eff.allowed ? 'extension changed' : eff.reason}`, s);
      return closeSession(s, CLOSE.FORBIDDEN, 'browser phone not allowed');
    }

    // One relay session per agent: the newest connection wins.
    // Register the new session first, so listeners of the old session's
    // 'session-close' (phone presence, CP3-D) see that a newer session exists.
    const old = byAgent.get(s.agentId);
    byAgent.set(s.agentId, s);
    if (old && old !== s) closeSession(old, CLOSE.REPLACED, 'replaced by a new connection');

    log('info', 'browser connected', s);
    events.emit('session-open', { agentId: s.agentId, extension: s.extension });
    openUpstream(s);
  }

  function openUpstream(s) {
    let up;
    try {
      up = new WebSocket(telephony.relayUpstreamUrl, 'sip', {
        handshakeTimeout: L.upstreamTimeoutMs,
        maxPayload: L.maxPayload,
        perMessageDeflate: false,
        ...tlsOptions,
      });
    } catch (err) {
      log('error', `upstream config error: ${err.message}`, s);
      return closeSession(s, CLOSE.UPSTREAM_FAILED, 'phone server unavailable');
    }
    s.upstream = up;
    up.on('open', () => {
      if (s.closed) return up.close();
      if (up.protocol !== 'sip') {
        log('error', 'upstream did not accept the "sip" subprotocol', s);
        return closeSession(s, CLOSE.UPSTREAM_FAILED, 'phone server protocol error');
      }
      log('info', 'upstream connected', s);
      for (const text of s.queue) up.send(text);
      s.queue = []; s.queuedBytes = 0;
    });
    up.on('message', (data, isBinary) => onUpstreamFrame(s, data, isBinary));
    up.on('pong', () => { s.alive.upstream.waiting = false; });
    up.on('unexpected-response', (_req, res) => {
      log('error', `upstream handshake refused (HTTP ${res.statusCode})`, s);
      closeSession(s, CLOSE.UPSTREAM_FAILED, 'phone server unavailable');
    });
    up.on('error', (err) => {
      log('error', `upstream error: ${err.code || err.message}`, s);
      closeSession(s, CLOSE.UPSTREAM_FAILED, 'phone server unavailable');
    });
    up.on('close', () => closeSession(s, CLOSE.UPSTREAM_CLOSED, 'phone server closed the connection'));
  }

  function takeToken(s) {
    const t = now();
    s.tokens = Math.min(L.frameBurst, s.tokens + ((t - s.lastRefill) / 1000) * L.framesPerSec);
    s.lastRefill = t;
    if (s.tokens < 1) return false;
    s.tokens -= 1;
    return true;
  }

  function onBrowserFrame(s, data, isBinary) {
    if (s.closed) return;
    if (isBinary) return closeSession(s, CLOSE.UNSUPPORTED, 'binary frames not allowed');
    if (!takeToken(s)) {
      log('warn', 'frame rate limit exceeded', s);
      return closeSession(s, CLOSE.POLICY, 'too many messages');
    }
    const text = data.toString('utf8');
    const verdict = checkOutboundFrame(text, s.extension, (callId) => s.dialogs.has(callId));
    if (!verdict.allow) {
      log('warn', `blocked frame: ${verdict.reason}`, s);
      return closeSession(s, verdict.code, verdict.reason);
    }
    // A call this phone starts (passed the identity check above) belongs to it.
    if (verdict.parsed?.kind === 'request') trackDialog(s, verdict.parsed);
    if (verdict.parsed?.kind === 'request' && verdict.parsed.method === 'REGISTER') {
      s.lastRegisterHadAuth = Boolean(verdict.parsed.headers.authorization);
    }
    s.framesUp++;
    const up = s.upstream;
    if (up && up.readyState === WebSocket.OPEN) return up.send(text);
    // Upstream still connecting (or agent check pending): queue in order, bounded.
    s.queuedBytes += Buffer.byteLength(text);
    if (s.queue.length >= L.pendingMaxFrames || s.queuedBytes > L.maxPayload) {
      return closeSession(s, CLOSE.POLICY, 'too many messages before the phone server was ready');
    }
    s.queue.push(text);
  }

  function onUpstreamFrame(s, data, isBinary) {
    if (s.closed) return;
    if (isBinary) return closeSession(s, CLOSE.UPSTREAM_ERROR, 'unexpected binary frame from phone server');
    const text = data.toString('utf8');
    if (!isKeepAlive(text)) {
      const p = parseSipFrame(text);
      if (p.ok && p.kind === 'response' && p.cseqMethod === 'REGISTER') trackRegister(s, p);
      // A call FreeSWITCH sends to this phone belongs to it.
      if (p.ok && p.kind === 'request') trackDialog(s, p);
    }
    s.framesDown++;
    if (s.browser.readyState === WebSocket.OPEN) s.browser.send(text);
  }

  /**
   * Remember the calls (Call-IDs) that belong to this phone, so its in-dialog
   * requests (BYE, re-INVITE, UPDATE, INFO, REFER…) are allowed even though, on a
   * call FreeSWITCH sent to it, neither From nor To carries the extension.
   * Only INVITEs create entries: from FreeSWITCH (inbound calls) or from this phone
   * after the identity check. A BYE or CANCEL lets the entry go after a short delay
   * (late responses/retransmissions); the list is bounded and dies with the session.
   */
  function trackDialog(s, p) {
    const callId = p.headers['call-id']?.[0];
    if (!callId) return;
    if (p.method === 'INVITE') {
      if (s.dialogs.has(callId)) return;
      if (s.dialogs.size >= L.maxDialogs) {
        const [oldest, timer] = s.dialogs.entries().next().value;
        if (timer) clearTimeout(timer);
        s.dialogs.delete(oldest);
      }
      s.dialogs.set(callId, null);
    } else if ((p.method === 'BYE' || p.method === 'CANCEL') && s.dialogs.has(callId) && !s.dialogs.get(callId)) {
      const t = setTimeout(() => s.dialogs.delete(callId), L.dialogLingerMs);
      t.unref?.();
      s.dialogs.set(callId, t);
    }
  }

  function trackRegister(s, p) {
    if (p.status >= 200 && p.status < 300) {
      const exp = registerExpires(p);
      if (exp === 0) {
        if (s.registered) { s.registered = false; events.emit('unregistered', { agentId: s.agentId, extension: s.extension, reason: 'unregister' }); }
      } else if (!s.registered) {
        s.registered = true;
        events.emit('registered', { agentId: s.agentId, extension: s.extension });
      }
      return;
    }
    const authFailure = p.status === 403 || ((p.status === 401 || p.status === 407) && s.lastRegisterHadAuth);
    if (!authFailure) return;
    const list = recent(authFails, s.agentId, L.authFailWindowMs);
    list.push(now());
    authFails.set(s.agentId, list);
    if (list.length >= L.authFailMax) {
      log('warn', 'SIP registration failed too often; closing', s);
      // Let the browser see the final 401/403 first, then close.
      setImmediate(() => closeSession(s, CLOSE.AUTH_LIMIT, 'too many failed phone sign-ins'));
    }
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────────
  function heartbeat() {
    const t = now();
    for (const s of sessions.values()) {
      for (const [leg, w] of [['browser', s.browser], ['upstream', s.upstream]]) {
        if (!w || w.readyState !== WebSocket.OPEN) continue;
        const a = s.alive[leg];
        if (a.waiting && t - a.pingAt > L.pongTimeoutMs) {
          log('warn', `${leg} heartbeat timeout`, s);
          try { w.terminate(); } catch { /* ignore */ }
          closeSession(s, leg === 'browser' ? CLOSE.GOING_AWAY : CLOSE.UPSTREAM_CLOSED, `${leg} not responding`);
          break;
        }
        if (!a.waiting && t - a.pingAt >= L.pingIntervalMs) {
          a.waiting = true; a.pingAt = t;
          try { w.ping(); } catch { /* ignore */ }
        }
      }
    }
  }
  const hbTimer = setInterval(heartbeat, L.heartbeatTickMs);
  hbTimer.unref?.();

  // ── Shutdown ────────────────────────────────────────────────────────────────
  async function close() {
    accepting = false;
    clearInterval(hbTimer);
    if (server) server.off('upgrade', upgradeListener);
    const all = [...sessions.values()];
    for (const s of all) closeSession(s, CLOSE.GOING_AWAY, 'server shutting down');
    const deadline = now() + L.shutdownGraceMs;
    const sockets = all.flatMap((s) => [s.browser, s.upstream]).filter(Boolean);
    while (sockets.some((w) => w.readyState !== WebSocket.CLOSED) && now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    for (const w of sockets) if (w.readyState !== WebSocket.CLOSED) w.terminate();
    await new Promise((r) => wss.close(() => r()));
    log('info', `stopped (${all.length} session(s) closed)`);
  }

  function upgradeListener(req, socket, head) {
    try { handleUpgrade(req, socket, head); } catch (err) {
      logger.error(`[sip-relay] upgrade error: ${err.message}`);
      socket.destroy();
    }
  }
  if (server) server.on('upgrade', upgradeListener);

  return {
    events,
    upgradeListener,
    handleUpgrade,
    close,
    heartbeat,
    stats: () => ({ sessions: sessions.size, agents: byAgent.size, accepting }),
    hasSession: (agentId) => byAgent.has(agentId),
    closeAgent: (agentId, reason = 'closed by server') => {
      const s = byAgent.get(agentId);
      if (s) closeSession(s, CLOSE.FORBIDDEN, reason);
      return Boolean(s);
    },
  };
}

/**
 * Attach the relay to the HTTP server only when the customer mode allows WebRTC.
 * Returns null (and attaches nothing) for EXTERNAL_PBX.
 */
export function initSipRelay({ server, config, ticketStore, loadAgent, logger }) {
  if (!modeAllowsWebrtc(config.telephony?.mode)) return null;
  return createSipRelay({
    server,
    telephony: config.telephony,
    allowedOrigins: config.cors.origin,
    ticketStore,
    loadAgent,
    logger,
    limits: { maxConnections: config.telephony.relayMaxConnections || DEFAULTS.maxConnections },
  });
}
