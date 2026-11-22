/**
 * M1 — wrap-up dispositions and notes (wrapupService + agent-desk controller).
 *
 * Covers: queue-specific availability (assigned vs "none chosen = all"), saving
 * (own answered queue call only, offered code only, notes optional/limited, upsert,
 * agent replaces a system outcome), "Ready now" (refused until the outcome is saved,
 * live wrap_up_time 0 + Idle→Waiting only, never changes the DB value), restore of the
 * configured wrap_up_time on the next call / status change, and the system outcome for
 * a phone that dropped during the call (never overwrites the agent's outcome).
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/wrapupDispositions.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: { agentSetParam: vi.fn().mockResolvedValue('+OK'), agentSetState: vi.fn().mockResolvedValue('+OK') },
}));

import { query } from '../../../db/pool.js';
import { cc } from '../../../services/eslService.js';
import * as wrapup from '../../../services/wrapupService.js';
import { agentSaveWrapup, agentReadyNow, agentWrapups } from '../../../controllers/agentWrapupController.js';

function makeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b)   { this.body = b; return this; },
  };
}

const OPTIONS = [
  { code: 'RESOLVED', name: 'Resolved', description: null },
  { code: 'CALLBACK', name: 'Callback needed', description: null },
];
const ANSWERED_CALL = {
  call_uuid: 'c-1', queue_name: 'support@default',
  agent_answer_time: new Date(), end_time: new Date(), in_window: true,
};

// Route each SQL statement to a canned answer; records every call for assertions.
function sqlRouter(routes) {
  query.mockImplementation(async (sql, params) => {
    for (const [match, answer] of routes) {
      if (sql.includes(match)) return typeof answer === 'function' ? answer(sql, params) : answer;
    }
    return { rows: [] };
  });
}
const sqlCalls = (needle) => query.mock.calls.filter(([sql]) => sql.includes(needle));

beforeEach(() => {
  vi.clearAllMocks();
  wrapup._resetOverrides();
  query.mockResolvedValue({ rows: [] });
});

// ── Queue-specific availability ─────────────────────────────────────────────
describe('offeredCodes — queue-specific availability', () => {
  it('asks for active, non-system codes; assigned codes only, or all when none assigned', async () => {
    query.mockResolvedValueOnce({ rows: OPTIONS });
    const rows = await wrapup.offeredCodes('support@default');
    expect(rows).toEqual(OPTIONS);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['support@default']);
    expect(sql).toContain('d.active = true AND d.is_system = false');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM assigned) OR d.id IN (SELECT id FROM assigned)');
    expect(sql).toMatch(/q\.name = \$1/);
  });
});

// ── Saving an outcome ───────────────────────────────────────────────────────
describe('saveWrapup — validation', () => {
  it('requires an outcome code (DISPOSITION_REQUIRED)', async () => {
    const r = await wrapup.saveWrapup({ agentId: 'alice', callUuid: 'c-1', code: '  ' });
    expect(r).toMatchObject({ ok: false, status: 400, code: 'DISPOSITION_REQUIRED' });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects notes over 2000 characters and non-text notes', async () => {
    let r = await wrapup.saveWrapup({ agentId: 'alice', callUuid: 'c-1', code: 'RESOLVED', notes: 'x'.repeat(2001) });
    expect(r).toMatchObject({ ok: false, status: 400 });
    r = await wrapup.saveWrapup({ agentId: 'alice', callUuid: 'c-1', code: 'RESOLVED', notes: 42 });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('only the agent\'s own call: the lookup is scoped by agent_id (404 otherwise)', async () => {
    sqlRouter([['FROM calls WHERE call_uuid = $1 AND agent_id = $2', { rows: [] }]]);
    const r = await wrapup.saveWrapup({ agentId: 'alice', callUuid: 'c-other', code: 'RESOLVED' });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(sqlCalls('FROM calls WHERE call_uuid = $1 AND agent_id = $2')[0][1]).toEqual(['c-other', 'alice']);
  });

  it('refuses unanswered calls and calls outside the 24 h window (409)', async () => {
    sqlRouter([['FROM calls WHERE call_uuid', { rows: [{ ...ANSWERED_CALL, agent_answer_time: null }] }]]);
    expect(await wrapup.saveWrapup({ agentId: 'alice', callUuid: 'c-1', code: 'RESOLVED' }))
      .toMatchObject({ ok: false, status: 409 });
    sqlRouter([['FROM calls WHERE call_uuid', { rows: [{ ...ANSWERED_CALL, in_window: false }] }]]);
    expect(await wrapup.saveWrapup({ agentId: 'alice', callUuid: 'c-1', code: 'RESOLVED' }))
      .toMatchObject({ ok: false, status: 409 });
    expect(sqlCalls('INSERT INTO call_wrapups')).toHaveLength(0);
  });

  it('refuses a code the call\'s queue does not offer (inactive, system or not assigned)', async () => {
    sqlRouter([
      ['FROM calls WHERE call_uuid', { rows: [ANSWERED_CALL] }],
      ['WITH assigned', { rows: OPTIONS }],
    ]);
    for (const code of ['SALE', 'SYSTEM_DISCONNECTED']) {
      const r = await wrapup.saveWrapup({ agentId: 'alice', callUuid: 'c-1', code });
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
    expect(sqlCalls('INSERT INTO call_wrapups')).toHaveLength(0);
  });
});

describe('saveWrapup — saving', () => {
  beforeEach(() => {
    sqlRouter([
      ['FROM calls WHERE call_uuid', { rows: [ANSWERED_CALL] }],
      ['WITH assigned', { rows: OPTIONS }],
      ['INSERT INTO call_wrapups', (_sql, p) => ({ rows: [{
        call_uuid: p[0], disposition_code: p[3], disposition_name: p[4], notes: p[5], source: 'agent', updated_at: new Date(),
      }] })],
    ]);
  });

  it('saves the code with a name snapshot, the queue, trimmed notes, source agent', async () => {
    const r = await wrapup.saveWrapup({ agentId: 'alice', callUuid: 'c-1', code: 'resolved', notes: '  asked about bill  ' });
    expect(r.ok).toBe(true);
    expect(r.wrapup).toMatchObject({ code: 'RESOLVED', name: 'Resolved', notes: 'asked about bill', source: 'agent' });
    const [sql, params] = sqlCalls('INSERT INTO call_wrapups')[0];
    expect(params).toEqual(['c-1', 'alice', 'support@default', 'RESOLVED', 'Resolved', 'asked about bill']);
    // One row per call: re-saving updates it, and an agent outcome replaces a system one.
    expect(sql).toContain('ON CONFLICT (call_uuid) DO UPDATE');
    expect(sql).toContain("source           = 'agent'");
  });

  it('notes are optional (empty → null)', async () => {
    const r = await wrapup.saveWrapup({ agentId: 'alice', callUuid: 'c-1', code: 'CALLBACK', notes: '   ' });
    expect(r.ok).toBe(true);
    expect(sqlCalls('INSERT INTO call_wrapups')[0][1][5]).toBeNull();
  });

  it('controller: uses req.agentId, never an agent id from the body', async () => {
    const res = makeRes();
    await agentSaveWrapup({ agentId: 'alice', params: { callUuid: 'c-1' }, body: { code: 'RESOLVED', agent_id: 'mallory' } }, res);
    expect(res.statusCode).toBe(200);
    expect(sqlCalls('FROM calls WHERE call_uuid')[0][1]).toEqual(['c-1', 'alice']);
  });

  it('controller: passes validation errors through with their code', async () => {
    const res = makeRes();
    await agentSaveWrapup({ agentId: 'alice', params: { callUuid: 'c-1' }, body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('DISPOSITION_REQUIRED');
  });
});

// ── Listing recent calls for the wrap-up panel ──────────────────────────────
describe('recentWrapups', () => {
  it('returns recent answered queue calls with outcome (or null) and the queue\'s options', async () => {
    sqlRouter([
      ['FROM calls c', { rows: [
        { call_uuid: 'c-2', queue_name: 'support@default', ani: '100', caller_name: null,
          agent_answer_time: 't2', end_time: null, disposition_code: null },
        { call_uuid: 'c-1', queue_name: 'support@default', ani: '101', caller_name: 'Bob',
          agent_answer_time: 't1', end_time: 't1e', disposition_code: 'RESOLVED', disposition_name: 'Resolved',
          notes: null, source: 'agent', wrapup_at: 'x' },
      ] }],
      ['WITH assigned', { rows: OPTIONS }],
    ]);
    const res = makeRes();
    await agentWrapups({ agentId: 'alice' }, res);
    expect(res.body.calls).toHaveLength(2);
    expect(res.body.calls[0]).toMatchObject({ call_uuid: 'c-2', wrapup: null, options: OPTIONS });
    expect(res.body.calls[1].wrapup).toMatchObject({ code: 'RESOLVED', source: 'agent' });
    // Options are looked up once per queue.
    expect(sqlCalls('WITH assigned')).toHaveLength(1);
    const [sql, params] = sqlCalls('FROM calls c')[0];
    expect(params[0]).toBe('alice');
    expect(sql).toContain('c.agent_answer_time IS NOT NULL');
    expect(sql).toContain('c.queue_name IS NOT NULL');
    // Older calls (before the feature was installed) are left out; a re-login does not hide pending calls.
    expect(sql).toContain('FROM schema_migrations');
    expect(sql).not.toContain('agent_sessions');
  });
});

// ── Ready now ───────────────────────────────────────────────────────────────
function readyRoutes({ agent, latest }) {
  sqlRouter([
    ['SELECT status, state, wrap_up_time FROM agents', { rows: agent ? [agent] : [] }],
    ['FROM calls c', { rows: latest ? [latest] : [] }],
    ['SELECT wrap_up_time FROM agents', { rows: [{ wrap_up_time: agent?.wrap_up_time ?? 20 }] }],
  ]);
}
const justEnded = (over = {}) => ({ call_uuid: 'c-1', end_time: new Date(Date.now() - 2000), ...over });

describe('readyNow — end wrap-up early', () => {
  it('is refused until the latest call\'s outcome is saved (409 DISPOSITION_REQUIRED)', async () => {
    readyRoutes({ agent: { status: 'Available', state: 'Idle', wrap_up_time: 20 }, latest: justEnded({ disposition_code: null }) });
    const res = makeRes();
    await agentReadyNow({ agentId: 'alice' }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('DISPOSITION_REQUIRED');
    expect(cc.agentSetParam).not.toHaveBeenCalled();
    expect(cc.agentSetState).not.toHaveBeenCalled();
  });

  it('after saving: live wrap_up_time 0 and Idle → Waiting for this agent only', async () => {
    readyRoutes({ agent: { status: 'Available', state: 'Idle', wrap_up_time: 20 }, latest: justEnded({ disposition_code: 'RESOLVED' }) });
    const res = makeRes();
    await agentReadyNow({ agentId: 'alice' }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ready: true, already_ready: false });
    expect(cc.agentSetParam).toHaveBeenCalledWith('alice', 'wrap_up_time', 0);
    expect(cc.agentSetState).toHaveBeenCalledWith('alice', 'Waiting');
    expect(wrapup.hasReadyOverride('alice')).toBe(true);
    // The configured value in the database is never written.
    expect(query.mock.calls.some(([sql]) => /UPDATE\s+agents/i.test(sql))).toBe(false);
  });

  it('does not touch the state when the agent is already Waiting', async () => {
    readyRoutes({ agent: { status: 'Available', state: 'Waiting', wrap_up_time: 20 }, latest: justEnded({ disposition_code: 'RESOLVED' }) });
    await wrapup.readyNow('alice');
    expect(cc.agentSetParam).toHaveBeenCalledWith('alice', 'wrap_up_time', 0);
    expect(cc.agentSetState).not.toHaveBeenCalled();
  });

  it('does nothing in FreeSWITCH when wrap-up already ended on its own', async () => {
    readyRoutes({ agent: { status: 'Available', state: 'Waiting', wrap_up_time: 20 },
                  latest: justEnded({ disposition_code: 'RESOLVED', end_time: new Date(Date.now() - 60_000) }) });
    expect(await wrapup.readyNow('alice')).toEqual({ ok: true, alreadyReady: true });
    expect(cc.agentSetParam).not.toHaveBeenCalled();
  });

  it('phone system unreachable: plain 503, nothing recorded as overridden', async () => {
    readyRoutes({ agent: { status: 'Available', state: 'Waiting', wrap_up_time: 20 }, latest: justEnded({ disposition_code: 'RESOLVED' }) });
    cc.agentSetParam.mockRejectedValueOnce(new Error('ESL not connected'));
    const res = makeRes();
    await agentReadyNow({ agentId: 'alice' }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('PHONE_SYSTEM_UNAVAILABLE');
    expect(res.body.error).not.toMatch(/ESL/);
    expect(wrapup.hasReadyOverride('alice')).toBe(false);
  });

  it('is refused on a call, when not Available, or with no call to wrap up', async () => {
    readyRoutes({ agent: { status: 'Available', state: 'In a queue call', wrap_up_time: 20 }, latest: justEnded({ disposition_code: 'X' }) });
    expect(await wrapup.readyNow('alice')).toMatchObject({ ok: false, status: 409, code: 'ON_CALL' });
    readyRoutes({ agent: { status: 'On Break', state: 'Idle', wrap_up_time: 20 }, latest: justEnded({ disposition_code: 'X' }) });
    expect(await wrapup.readyNow('alice')).toMatchObject({ ok: false, status: 409, code: 'NOT_AVAILABLE' });
    readyRoutes({ agent: { status: 'Available', state: 'Idle', wrap_up_time: 20 }, latest: null });
    expect(await wrapup.readyNow('alice')).toMatchObject({ ok: false, status: 409, code: 'NO_CALL' });
    expect(cc.agentSetParam).not.toHaveBeenCalled();
  });
});

// ── Restoring the configured wrap-up time ───────────────────────────────────
describe('restore of the configured wrap_up_time', () => {
  async function readyThenEvents() {
    readyRoutes({ agent: { status: 'Available', state: 'Idle', wrap_up_time: 25 }, latest: justEnded({ disposition_code: 'RESOLVED' }) });
    await wrapup.readyNow('alice');
    cc.agentSetParam.mockClear();
    const ev = new EventEmitter();
    wrapup.attachWrapupRestore(ev, { log: () => {}, error: () => {} });
    return ev;
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('restores the DB value when the next call is offered / answered', async () => {
    const ev = await readyThenEvents();
    ev.emit('agent:state', { agentId: 'alice', state: 'Waiting' });     // not a call: no restore
    await flush();
    expect(cc.agentSetParam).not.toHaveBeenCalled();
    ev.emit('agent:state', { agentId: 'alice', state: 'Receiving' });
    await flush();
    expect(cc.agentSetParam).toHaveBeenCalledWith('alice', 'wrap_up_time', 25);
    expect(wrapup.hasReadyOverride('alice')).toBe(false);
  });

  it('restores on any status change (break, logout)', async () => {
    const ev = await readyThenEvents();
    ev.emit('agent:status', { agentId: 'alice', status: 'Logged Out' });
    await flush();
    expect(cc.agentSetParam).toHaveBeenCalledWith('alice', 'wrap_up_time', 25);
  });

  it('never touches agents that did not use Ready now', async () => {
    const ev = await readyThenEvents();
    ev.emit('agent:state', { agentId: 'bob', state: 'Receiving' });
    ev.emit('agent:offering', { agentId: 'bob', callUuid: 'x' });
    await flush();
    expect(cc.agentSetParam).not.toHaveBeenCalled();
  });
});

// ── System outcome: phone dropped during the call ───────────────────────────
describe('recordSystemDisconnect', () => {
  it('records SYSTEM_DISCONNECTED on the latest answered call, never overwriting', async () => {
    sqlRouter([
      ['SELECT call_uuid, queue_name FROM calls', { rows: [{ call_uuid: 'c-9', queue_name: 'support@default' }] }],
      ['FROM disposition_codes WHERE code', { rows: [{ name: 'Disconnected unexpectedly' }] }],
      ['INSERT INTO call_wrapups', { rows: [{ call_uuid: 'c-9' }] }],
    ]);
    expect(await wrapup.recordSystemDisconnect('alice')).toBe(true);
    const [sql, params] = sqlCalls('INSERT INTO call_wrapups')[0];
    expect(params).toEqual(['c-9', 'alice', 'support@default', 'SYSTEM_DISCONNECTED', 'Disconnected unexpectedly']);
    expect(sql).toContain("'system'");
    expect(sql).toContain('ON CONFLICT (call_uuid) DO NOTHING');
  });

  it('does nothing without a recent answered call', async () => {
    sqlRouter([['SELECT call_uuid, queue_name FROM calls', { rows: [] }]]);
    expect(await wrapup.recordSystemDisconnect('alice')).toBe(false);
    expect(sqlCalls('INSERT INTO call_wrapups')).toHaveLength(0);
  });
});
