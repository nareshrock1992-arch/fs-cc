import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import jwt from 'jsonwebtoken';

// SEC-1 agent tokens on the admin API · SEC-2 login brute force · SEC-3 live events to
// unauthenticated sockets. See docs/enterprise-transformation/MASTER_TASK_TRACKER.md.

vi.mock('../../../config/index.js', () => ({ config: { jwt: { secret: 'test-secret' } } }));

const ccEvents = new EventEmitter();
vi.mock('../../../services/eslService.js', () => ({ ccEvents, isConnected: () => true }));

const ioState = { connectionHandler: null, emitted: [] };
vi.mock('socket.io', () => ({
  Server: class {
    constructor() {}
    on(ev, fn) { if (ev === 'connection') ioState.connectionHandler = fn; }
    emit(ev, p) { ioState.emitted.push({ to: '*', ev, p }); }
    to(room) { return { emit: (ev, p) => ioState.emitted.push({ to: room, ev, p }) }; }
  },
}));

const { requireAuth } = await import('../../../middleware/auth.js');
const { createLoginLimiter } = await import('../../../middleware/loginLimiter.js');
const { initSocket, SUBSCRIBERS } = await import('../../../services/socketService.js');

function mockRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn(() => res);
  res.set = vi.fn(() => res);
  return res;
}
const bearer = (payload) => ({ headers: { authorization: `Bearer ${jwt.sign(payload, 'test-secret')}` } });

describe('SEC-1 admin API rejects Agent Desktop tokens', () => {
  it('agent token → 403, next not called', () => {
    const res = mockRes(); const next = vi.fn();
    requireAuth(bearer({ role: 'agent', agentId: '1000' }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
  it('admin and supervisor tokens still pass', () => {
    for (const role of ['admin', 'supervisor']) {
      const req = bearer({ role, username: 'u' }); const next = vi.fn();
      requireAuth(req, mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
      expect(req.user.role).toBe(role);
    }
  });
  it('missing / invalid token → 401', () => {
    const r1 = mockRes(); requireAuth({ headers: {} }, r1, vi.fn());
    expect(r1.status).toHaveBeenCalledWith(401);
    const r2 = mockRes(); requireAuth({ headers: { authorization: 'Bearer nope' } }, r2, vi.fn());
    expect(r2.status).toHaveBeenCalledWith(401);
  });
});

describe('SEC-2 login limiter', () => {
  let t; let limiter;
  beforeEach(() => { t = 1_000_000; limiter = createLoginLimiter({ max: 3, windowMs: 60_000, idField: 'agent_id', now: () => t }); });
  const attempt = (status, id = '1000', ip = '1.1.1.1') => {
    const res = mockRes(); const next = vi.fn();
    limiter({ ip, body: { agent_id: id } }, res, next);
    if (next.mock.calls.length) { res.statusCode = status; res.emit('finish'); }
    return { res, next };
  };

  it('blocks after max failures with 429 + Retry-After, per ip+id', () => {
    for (let i = 0; i < 3; i++) expect(attempt(401).next).toHaveBeenCalled();
    const blocked = attempt(200);
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.res.set).toHaveBeenCalledWith('Retry-After', '60');
    expect(attempt(401, '2000').next).toHaveBeenCalled(); // other agent unaffected
    expect(attempt(401, '1000', '2.2.2.2').next).toHaveBeenCalled(); // other client unaffected
  });
  it('window expiry unblocks', () => {
    for (let i = 0; i < 3; i++) attempt(401);
    t += 61_000;
    expect(attempt(200).next).toHaveBeenCalled();
  });
  it('a successful login clears earlier failures; 400 does not count', () => {
    attempt(401); attempt(401); attempt(200);
    attempt(401); attempt(400); attempt(400);
    expect(attempt(401).next).toHaveBeenCalled();
  });
});

describe('SEC-3 live events only to authenticated sockets', () => {
  function connect() {
    const handlers = {}; const sent = []; const rooms = new Set();
    const socket = { id: 's', on: (ev, fn) => { handlers[ev] = fn; }, emit: (ev, p) => sent.push({ ev, p }), join: (r) => rooms.add(r) };
    ioState.connectionHandler(socket);
    return { handlers, sent, rooms };
  }
  beforeEach(() => { ccEvents.removeAllListeners(); ioState.emitted = []; initSocket({}, '*'); });

  it('call events go to the subscribers room, never to everyone', () => {
    ccEvents.emit('call:enqueued', { callerNumber: '0501234567' });
    expect(ioState.emitted).toEqual([{ to: SUBSCRIBERS, ev: 'call:enqueued', p: { callerNumber: '0501234567' } }]);
  });
  it('unauthenticated socket gets esl:status only and joins no room', () => {
    const s = connect();
    expect(s.sent).toEqual([{ ev: 'esl:status', p: { connected: true } }]);
    expect(s.rooms.size).toBe(0);
  });
  it('agent and supervisor authentication join subscribers; bad tokens do not', () => {
    const a = connect(); a.handlers['agent:authenticate']({ token: jwt.sign({ role: 'agent', agentId: '1000' }, 'test-secret') });
    expect([...a.rooms]).toEqual(['agent:1000', SUBSCRIBERS]);
    const v = connect(); v.handlers['supervisor:authenticate']({ token: jwt.sign({ role: 'supervisor' }, 'test-secret') });
    expect(v.rooms.has(SUBSCRIBERS)).toBe(true);
    const x = connect(); x.handlers['agent:authenticate']({ token: 'forged' });
    x.handlers['supervisor:authenticate']({ token: jwt.sign({ role: 'agent', agentId: '1' }, 'test-secret') });
    expect(x.rooms.size).toBe(0);
  });
});

describe('SEC-4 agent detail never returns the PIN hash', () => {
  it('pin_hash is reduced to a boolean', async () => {
    vi.resetModules();
    const q = vi.fn(async () => ({ rows: [{ agent_id: '1000', full_name: 'A', pin_hash: '$2a$10$abcdefghijklmnopqrstuv' }] }));
    vi.doMock('../../../db/pool.js', () => ({ query: q, pool: {} }));
    const { getAgent } = await import('../../../controllers/agentsController.js');
    const res = mockRes();
    await getAgent({ params: { agentId: '1000' } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ agent_id: '1000', pin_hash: true }));
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('$2a$');
  });
});
