/**
 * CP3-B — agent-desk browser-phone endpoints across the three customer modes.
 * Scenarios 1, 4, 5, 6, 8, 13 (+ logout ticket invalidation, no secret logging).
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/webrtcAgentDesk.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cfg = vi.hoisted(() => ({
  config: {
    jwt: { secret: 'test' },
    fs: { sipDomain: 'pbx.example' },
    telephony: { mode: 'EXTERNAL_PBX', relayUpstreamUrl: 'wss://fs.example:7443', ticketTtlMs: 30_000, graceMs: 15_000 },
  },
}));
vi.mock('../../../config/index.js', () => cfg);
vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: { agentSetStatus: vi.fn().mockResolvedValue(undefined) },
  isConnected: vi.fn(() => true),
}));
vi.mock('../../../services/agentSessionService.js', () => ({
  handleStatusTransition: vi.fn().mockResolvedValue(undefined),
  startLoginSession: vi.fn().mockResolvedValue(1),
}));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn().mockResolvedValue(true) } }));
// Relay lock state for the ticket service (lab 2026-11-24: locked phone looked like a certificate error).
const relayLock = vi.hoisted(() => ({ value: { locked: false, retryAfterMs: 0 } }));
vi.mock('../../../services/sipRelayService.js', () => ({
  getSipRelay: () => ({ authLock: vi.fn(() => relayLock.value) }),
}));

import { query } from '../../../db/pool.js';
import { cc } from '../../../services/eslService.js';
import { agentWebrtcTicket, agentMe, agentLogin, agentSetStatus } from '../../../controllers/agentDeskController.js';
import { getTicketStore } from '../../../services/relayTicketStore.js';

function makeRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    set(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const internalOn = { agent_id: 'alice', agent_type: 'internal', webrtc_enabled: true, active: true, contact: '{sip_cid_type=pid}user/1001@pbx.example' };
const req = (over = {}) => ({ agentId: 'alice', body: {}, params: {}, query: {}, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  relayLock.value = { locked: false, retryAfterMs: 0 };
  cfg.config.telephony.mode = 'EXTERNAL_PBX';
  query.mockResolvedValue({ rows: [] });
});

describe('POST /webrtc/ticket', () => {
  it('phone locked after refused passwords: 429 PHONE_SIGNIN_LOCKED with minutes, no ticket', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    query.mockResolvedValue({ rows: [internalOn] });
    relayLock.value = { locked: true, retryAfterMs: 241_000 };
    const res = makeRes();
    await agentWebrtcTicket(req(), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      error: 'Too many failed phone sign-ins. Check your phone password and try again in 5 minutes.',
      code: 'PHONE_SIGNIN_LOCKED', retry_after_seconds: 241,
    });
    expect(res.headers['Retry-After']).toBe('241');
    expect(res.body.ticket).toBeUndefined();
  });

  it('lock with under a minute left says "1 minute"', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    query.mockResolvedValue({ rows: [internalOn] });
    relayLock.value = { locked: true, retryAfterMs: 20_000 };
    const res = makeRes();
    await agentWebrtcTicket(req(), res);
    expect(res.body.error).toMatch(/in 1 minute.$/);
  });

  it('EXTERNAL_PBX: 404, no ticket, no DB lookup (scenario 1)', async () => {
    const res = makeRes();
    await agentWebrtcTicket(req(), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.ticket).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  for (const mode of ['FREESWITCH_WEBRTC', 'HYBRID']) {
    it(`${mode}: enabled internal agent gets a single-use ticket for their own extension (scenario 4)`, async () => {
      cfg.config.telephony.mode = mode;
      query.mockResolvedValueOnce({ rows: [internalOn] });
      const res = makeRes();
      await agentWebrtcTicket(req(), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ kind: 'connect', expires_in: 30, extension: '1001', sip_domain: 'pbx.example', relay_path: '/api/sip-relay' });
      expect(res.headers['Cache-Control']).toBe('no-store');
      // The SQL is scoped to the authenticated agent only.
      expect(query.mock.calls[0][1]).toEqual(['alice']);
      const store = getTicketStore();
      expect(store.consume(res.body.ticket)).toEqual({ agentId: 'alice', extension: '1001', kind: 'connect' });
      expect(store.consume(res.body.ticket)).toBeNull(); // replay
    });

    it(`${mode}: not-enabled internal agent → 403 (scenario 5)`, async () => {
      cfg.config.telephony.mode = mode;
      query.mockResolvedValueOnce({ rows: [{ ...internalOn, webrtc_enabled: false }] });
      const res = makeRes();
      await agentWebrtcTicket(req(), res);
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('WEBRTC_NOT_ALLOWED');
    });

    it(`${mode}: gateway agent → 403 (scenario 6)`, async () => {
      cfg.config.telephony.mode = mode;
      query.mockResolvedValueOnce({ rows: [{ ...internalOn, agent_type: 'gateway', contact: 'sofia/gateway/sp/05' }] });
      const res = makeRes();
      await agentWebrtcTicket(req(), res);
      expect(res.statusCode).toBe(403);
    });
  }

  it('reconnect kind is honoured; any other kind becomes connect', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    query.mockResolvedValue({ rows: [internalOn] });
    const r1 = makeRes(); await agentWebrtcTicket(req({ body: { kind: 'reconnect' } }), r1);
    const r2 = makeRes(); await agentWebrtcTicket(req({ body: { kind: 'admin' } }), r2);
    expect(r1.body.kind).toBe('reconnect');
    expect(r2.body.kind).toBe('connect');
  });

  it('never logs the full ticket (scenario 16)', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    query.mockResolvedValueOnce({ rows: [internalOn] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = makeRes();
    await agentWebrtcTicket(req(), res);
    const logged = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(logged).toContain('ticket#');
    expect(logged).not.toContain(res.body.ticket);
  });
});

describe('webrtc permission in /me and login', () => {
  it('EXTERNAL_PBX: /me reports webrtc_allowed=false even if the DB flag is true; flag itself not exposed', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...internalOn, full_name: 'Alice', status: 'Available' }] });
    const res = makeRes();
    await agentMe(req(), res);
    expect(res.body.webrtc_allowed).toBe(false);
    expect(res.body).not.toHaveProperty('webrtc_enabled');
  });

  it('HYBRID: /me reports webrtc_allowed=true for an enabled internal agent', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    query.mockResolvedValueOnce({ rows: [{ ...internalOn, full_name: 'Alice' }] });
    const res = makeRes();
    await agentMe(req(), res);
    expect(res.body.webrtc_allowed).toBe(true);
  });

  it('login response carries webrtc.allowed and never the PIN hash', async () => {
    cfg.config.telephony.mode = 'FREESWITCH_WEBRTC';
    query.mockResolvedValueOnce({ rows: [{ ...internalOn, id: 1, full_name: 'Alice', pin_hash: 'HASH' }] });
    const res = makeRes();
    await agentLogin({ body: { agent_id: 'alice', pin: '0000' } }, res);
    expect(res.body.agent.webrtc).toEqual({ allowed: true });
    expect(JSON.stringify(res.body)).not.toContain('HASH');
  });
});

describe('PHONE_OFFLINE and logout', () => {
  it('agents cannot select PHONE_OFFLINE (scenario 13) — refused before any DB lookup, any casing', async () => {
    for (const code of ['PHONE_OFFLINE', ' phone_offline ']) {
      query.mockClear();
      const res = makeRes();
      await agentSetStatus(req({ body: { status: 'On Break', break_code: code } }), res);
      expect(res.statusCode).toBe(400);
      expect(query).not.toHaveBeenCalled();
      expect(cc.agentSetStatus).not.toHaveBeenCalled();
    }
  });

  it('PHONE_OFFLINE is never in the agent break list, even if a DB row were selectable', async () => {
    const { agentBreakCodes } = await import('../../../controllers/agentDeskController.js');
    const res = makeRes();
    await agentBreakCodes(req(), res);
    expect(query.mock.calls[0][0]).toMatch(/agent_selectable = true AND code <> \$1/);
    expect(query.mock.calls[0][1]).toEqual(['PHONE_OFFLINE']);
  });

  it('Logged Out revokes unused tickets', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    const store = getTicketStore();
    const { ticket } = store.issue({ agentId: 'alice', extension: '1001' });
    const res = makeRes();
    await agentSetStatus(req({ body: { status: 'Logged Out' } }), res);
    expect(res.statusCode).toBe(200);
    expect(store.consume(ticket)).toBeNull();
  });
});
