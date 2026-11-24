/**
 * CP3-D — browser-phone presence and PHONE_OFFLINE state machine.
 * Controlled clocks (vitest fake timers); no real waiting, no DB, no FreeSWITCH.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/phonePresence.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createPhonePresence, makeApplyPhoneOffline, PHONE_OFFLINE_CODE } from '../../../services/phonePresenceService.js';

const GRACE = 15_000;
const base = { agent_id: 'alice', agent_type: 'internal', webrtc_enabled: true, active: true, contact: '{sip_cid_type=pid}user/1001@pbx.example', status: 'Available', state: 'Waiting' };

let db, presence, relayEvents, ccEvents, relay, emitted, applyPhoneOffline, mode;

function build({ startupGraceMs = 60_000 } = {}) {
  relayEvents = new EventEmitter();
  ccEvents = new EventEmitter();
  relay = { sessions: new Set(), hasSession: vi.fn((id) => relay.sessions.has(id)), closeAgent: vi.fn((id) => relay.sessions.delete(id)) };
  emitted = [];
  // Fake "agents" table + the atomic compare-and-set used by the real writer.
  applyPhoneOffline = vi.fn(async (id) => {
    const a = db[id];
    if (!a || a.status !== 'Available') return false;
    a.status = 'On Break'; a.break_code = PHONE_OFFLINE_CODE;
    return true;
  });
  presence = createPhonePresence({
    getMode: () => mode,
    graceMs: GRACE,
    startupGraceMs,
    loadAgent: vi.fn(async (id) => (db[id] ? { ...db[id] } : null)),
    applyPhoneOffline,
    emit: (event, agentId, payload) => emitted.push([event, agentId, payload.phone ?? payload.allowed]),
    relay,
    logger: { info() {}, warn() {}, error() {} },
  });
  presence.attach({ relayEvents, ccEvents });
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
async function advance(ms) { await vi.advanceTimersByTimeAsync(ms); await flush(); }
const registered = (id = 'alice') => relayEvents.emit('registered', { agentId: id, extension: '1001' });
const closed = (id = 'alice') => relayEvents.emit('session-close', { agentId: id, extension: '1001', code: 1006 });
const phoneEvents = () => emitted.filter(([e]) => e === 'agent:phone').map(([, , p]) => p);

beforeEach(() => {
  vi.useFakeTimers();
  mode = 'HYBRID';
  db = { alice: { ...base }, bob: { ...base, agent_id: 'bob', contact: '{sip_cid_type=pid}user/1002@pbx.example' } };
  build();
});
afterEach(() => { presence.stop(); vi.useRealTimers(); });

describe('15-second grace period', () => {
  it('phone connected → online; no status change', async () => {
    registered();
    expect(presence.getPhoneStatus('alice')).toBe('online');
    expect(phoneEvents()).toEqual(['online']);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });

  it('disconnect starts a grace; nothing happens before 15 s', async () => {
    registered(); closed();
    expect(presence.getPhoneStatus('alice')).toBe('grace');
    await advance(GRACE - 1);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    expect(db.alice.status).toBe('Available');
  });

  it('still disconnected at 15 s → phone offline and Available agent put On Break PHONE_OFFLINE', async () => {
    registered(); closed();
    await advance(GRACE);
    expect(presence.getPhoneStatus('alice')).toBe('offline');
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
    expect(db.alice).toMatchObject({ status: 'On Break', break_code: PHONE_OFFLINE_CODE });
    expect(phoneEvents()).toEqual(['online', 'grace', 'offline']);
  });

  it('reconnect + re-register inside the grace → no state change at all (temporary interruption)', async () => {
    registered(); closed();
    await advance(10_000);
    registered();
    await advance(60_000);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    expect(presence.getPhoneStatus('alice')).toBe('online');
  });

  it('a socket that reconnects but does not re-register is NOT a recovery', async () => {
    registered(); closed();
    relayEvents.emit('session-open', { agentId: 'alice' });
    await advance(GRACE);
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
  });

  it('repeated disconnects do not extend the grace (flapping cannot postpone offline)', async () => {
    registered(); closed();
    await advance(10_000);
    closed(); closed();
    await advance(5_000);
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
  });

  it('phone signed out (REGISTER expires 0) while the socket stays open → same grace', async () => {
    registered();
    relayEvents.emit('unregistered', { agentId: 'alice', reason: 'unregister' });
    await advance(GRACE);
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
  });

  it('registration failure before ever registering does not create PHONE_OFFLINE', async () => {
    relayEvents.emit('session-open', { agentId: 'alice' });
    closed();
    await advance(GRACE * 2);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    expect(presence.getPhoneStatus('alice')).toBe('none');
  });
});

describe('browser refresh and duplicate sessions', () => {
  it('refresh: old session closes while a newer one exists → no grace at all', async () => {
    registered();
    relay.sessions.add('alice');           // new session already registered with the relay
    closed();                               // old session's close event
    expect(presence.getPhoneStatus('alice')).toBe('online');
    await advance(GRACE);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });

  it('refresh without overlap: close then re-register within the grace → no change', async () => {
    registered(); closed();
    await advance(2_000);
    registered();
    await advance(GRACE);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });

  it('browser tab closed (no reconnect) → offline after the grace', async () => {
    registered(); closed();
    await advance(GRACE);
    expect(db.alice.status).toBe('On Break');
  });
});

describe('duplicate events', () => {
  it('duplicate offline events apply PHONE_OFFLINE once', async () => {
    registered(); closed();
    await advance(GRACE);
    closed(); closed();
    await advance(GRACE * 2);
    await presence.evaluate('alice');
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
    expect(phoneEvents().filter((p) => p === 'offline')).toHaveLength(1);
  });

  it('duplicate recovery events are harmless and emit once', async () => {
    registered(); closed();
    await advance(GRACE);
    registered(); registered(); registered();
    expect(phoneEvents().filter((p) => p === 'online')).toHaveLength(2); // initial + one recovery
    expect(db.alice.status).toBe('On Break');
  });

  it('a concurrent agent action wins: if the agent left Available first, nothing is applied', async () => {
    registered(); closed();
    db.alice.status = 'On Break'; db.alice.break_code = 'LUNCH';
    await advance(GRACE);
    expect(db.alice.break_code).toBe('LUNCH');
    expect(presence.getPhoneStatus('alice')).toBe('offline');
  });
});

describe('recovery behaviour', () => {
  it('recovery clears the indicator but does NOT make the agent Available', async () => {
    registered(); closed();
    await advance(GRACE);
    registered();
    expect(presence.getPhoneStatus('alice')).toBe('online');
    expect(db.alice).toMatchObject({ status: 'On Break', break_code: PHONE_OFFLINE_CODE });
  });

  it('agent already on another break keeps it; only the phone indicator changes', async () => {
    db.alice.status = 'On Break'; db.alice.break_code = 'COFFEE';
    registered(); closed();
    await advance(GRACE);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    expect(db.alice.break_code).toBe('COFFEE');
    expect(presence.getPhoneStatus('alice')).toBe('offline');
  });
});

describe('active calls', () => {
  it('disconnect during a queue call: phone offline, PHONE_OFFLINE deferred, call untouched', async () => {
    db.alice.state = 'In a queue call';
    registered(); closed();
    await advance(GRACE);
    expect(presence.getPhoneStatus('alice')).toBe('offline');
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    expect(presence.isPending('alice').offline).toBe(true);
    expect(relay.closeAgent).not.toHaveBeenCalled();
  });

  it('…then the call ends → PHONE_OFFLINE applied once', async () => {
    db.alice.state = 'In a queue call';
    registered(); closed();
    await advance(GRACE);
    db.alice.state = 'Waiting';
    ccEvents.emit('agent:state', { agentId: 'alice', status: 'Available', state: 'Waiting' });
    ccEvents.emit('agent:state', { agentId: 'alice', status: 'Available', state: 'Waiting' });
    await flush();
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
    expect(db.alice.status).toBe('On Break');
  });

  it('M1: phone dropped during the call → system outcome recorded once when the call ends', async () => {
    const onCallDisconnected = vi.fn().mockResolvedValue(true);
    presence.stop();
    relayEvents = new EventEmitter(); ccEvents = new EventEmitter();
    presence = createPhonePresence({
      getMode: () => mode, graceMs: GRACE,
      loadAgent: vi.fn(async (id) => (db[id] ? { ...db[id] } : null)),
      applyPhoneOffline, relay, logger: { info() {}, warn() {}, error() {} },
      onCallDisconnected,
    });
    presence.attach({ relayEvents, ccEvents });
    db.alice.state = 'In a queue call';
    registered(); closed();
    await advance(GRACE);
    expect(onCallDisconnected).not.toHaveBeenCalled();          // never during the call
    db.alice.state = 'Waiting';
    ccEvents.emit('agent:state', { agentId: 'alice', status: 'Available', state: 'Waiting' });
    ccEvents.emit('agent:state', { agentId: 'alice', status: 'Available', state: 'Waiting' });
    await flush();
    expect(onCallDisconnected).toHaveBeenCalledTimes(1);
    expect(onCallDisconnected).toHaveBeenCalledWith('alice', { lostAt: expect.any(Date) });
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);          // PHONE_OFFLINE unchanged
  });

  it('M1: a phone that recovered during the call records no system outcome', async () => {
    const onCallDisconnected = vi.fn();
    presence.stop();
    relayEvents = new EventEmitter(); ccEvents = new EventEmitter();
    presence = createPhonePresence({
      getMode: () => mode, graceMs: GRACE,
      loadAgent: vi.fn(async (id) => (db[id] ? { ...db[id] } : null)),
      applyPhoneOffline, relay, logger: { info() {}, warn() {}, error() {} },
      onCallDisconnected,
    });
    presence.attach({ relayEvents, ccEvents });
    db.alice.state = 'In a queue call';
    registered(); closed();
    await advance(GRACE);
    registered();
    db.alice.state = 'Waiting';
    ccEvents.emit('agent:state', { agentId: 'alice', state: 'Waiting' });
    await flush();
    expect(onCallDisconnected).not.toHaveBeenCalled();
  });

  it('ringing (Receiving) counts as a call too', async () => {
    db.alice.state = 'Receiving';
    registered(); closed();
    await advance(GRACE);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });

  it('recovery during the call cancels the pending PHONE_OFFLINE', async () => {
    db.alice.state = 'In a queue call';
    registered(); closed();
    await advance(GRACE);
    registered();
    db.alice.state = 'Waiting';
    ccEvents.emit('agent:state', { agentId: 'alice', state: 'Waiting' });
    await flush();
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    expect(db.alice.status).toBe('Available');
  });

  it('agent:state events for other agents or still-in-call states change nothing', async () => {
    db.alice.state = 'In a queue call';
    registered(); closed();
    await advance(GRACE);
    ccEvents.emit('agent:state', { agentId: 'bob', state: 'Waiting' });
    ccEvents.emit('agent:state', { agentId: 'alice', state: 'In a queue call' });
    await flush();
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });
});

// KF-11 (lab 2026-11-23): on a real drop FreeSWITCH ends the call ~9 s later, inside the grace.
describe('M1 system outcome when the call ends during the grace (KF-11)', () => {
  let onCallDisconnected;
  function buildWithOutcome() {
    presence.stop();
    relayEvents = new EventEmitter(); ccEvents = new EventEmitter();
    onCallDisconnected = vi.fn().mockResolvedValue(true);
    presence = createPhonePresence({
      getMode: () => mode, graceMs: GRACE,
      loadAgent: vi.fn(async (id) => (db[id] ? { ...db[id] } : null)),
      applyPhoneOffline, relay, logger: { info() {}, warn() {}, error() {} },
      onCallDisconnected,
    });
    presence.attach({ relayEvents, ccEvents });
  }
  const state = (st, status) => { db.alice.state = st; ccEvents.emit('agent:state', { agentId: 'alice', status, state: st }); };
  beforeEach(() => buildWithOutcome());

  it('call answered, phone drops, call ends 9 s later → outcome once when the grace ends, then PHONE_OFFLINE', async () => {
    registered();
    state('In a queue call', 'Available');
    const dropAt = Date.now();
    closed();
    await advance(9_000);
    state('Waiting', 'Available');
    await flush();
    expect(onCallDisconnected).not.toHaveBeenCalled();           // phone may still come back
    await advance(GRACE - 9_000);
    expect(presence.getPhoneStatus('alice')).toBe('offline');
    expect(onCallDisconnected).toHaveBeenCalledTimes(1);
    const [id, { lostAt }] = onCallDisconnected.mock.calls[0];
    expect(id).toBe('alice');
    expect(lostAt.getTime()).toBe(dropAt);
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
    expect(db.alice).toMatchObject({ status: 'On Break', break_code: PHONE_OFFLINE_CODE });
    // later state events never write a second outcome
    state('Waiting', 'On Break');
    await advance(GRACE);
    expect(onCallDisconnected).toHaveBeenCalledTimes(1);
  });

  it('same with the 60 s page-close allowance (the lab case)', async () => {
    registered();
    state('In a queue call', 'Available');
    presence.expectReload('alice');
    closed();
    await advance(9_000);
    state('Waiting', 'Available');
    await advance(GRACE);
    expect(onCallDisconnected).not.toHaveBeenCalled();           // still inside 60 s
    await advance(60_000);
    expect(onCallDisconnected).toHaveBeenCalledTimes(1);
  });

  it('phone back inside the grace → no system outcome (agent records it)', async () => {
    registered();
    state('In a queue call', 'Available');
    closed();
    await advance(5_000);
    state('Waiting', 'Available');
    await advance(3_000);
    registered();
    await advance(GRACE * 2);
    expect(onCallDisconnected).not.toHaveBeenCalled();
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });

  it('a call that only rang (never answered) gets no system outcome', async () => {
    registered();
    state('Receiving', 'Available');
    closed();
    await advance(2_000);
    state('Waiting', 'Available');
    await advance(GRACE);
    expect(onCallDisconnected).not.toHaveBeenCalled();
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);          // PHONE_OFFLINE unchanged
  });

  it('ringing then answered counts as answered', async () => {
    registered();
    state('Receiving', 'Available');
    state('In a queue call', 'Available');
    closed();
    await advance(4_000);
    state('Waiting', 'Available');
    await advance(GRACE);
    expect(onCallDisconnected).toHaveBeenCalledTimes(1);
  });

  it('no call during the loss → no system outcome', async () => {
    registered();
    state('In a queue call', 'Available');
    state('Waiting', 'Available');                               // call ended BEFORE the drop
    closed();
    await advance(GRACE);
    expect(onCallDisconnected).not.toHaveBeenCalled();
  });

  it('agent was On Break (status) during the call: outcome still written, status untouched', async () => {
    db.alice.status = 'On Break';
    registered();
    state('In a queue call', 'On Break');
    closed();
    await advance(3_000);
    state('Waiting', 'On Break');
    await advance(GRACE);
    expect(onCallDisconnected).toHaveBeenCalledTimes(1);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });

  it('call still up when declared offline, agent On Break → outcome when the call ends', async () => {
    db.alice.status = 'On Break';
    registered();
    state('In a queue call', 'On Break');
    closed();
    await advance(GRACE);
    expect(onCallDisconnected).not.toHaveBeenCalled();
    state('Waiting', 'On Break');
    await flush();
    expect(onCallDisconnected).toHaveBeenCalledTimes(1);
  });

  it('a second, later drop without a call records nothing more', async () => {
    registered();
    state('In a queue call', 'Available');
    closed();
    await advance(2_000);
    state('Waiting', 'Available');
    await advance(GRACE);
    expect(onCallDisconnected).toHaveBeenCalledTimes(1);
    registered();
    closed();
    await advance(GRACE);
    expect(onCallDisconnected).toHaveBeenCalledTimes(1);
  });
});

describe('logout, disabled and gateway agents', () => {
  it('logout while disconnected cancels the grace, forgets presence and closes the relay session', async () => {
    registered(); closed();
    presence.agentLoggedOut('alice');
    await advance(GRACE * 2);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    expect(presence.getPhoneStatus('alice')).toBe('none');
    expect(relay.closeAgent).toHaveBeenCalledWith('alice', 'agent logged out');
  });

  it('agent disabled during the grace → no PHONE_OFFLINE, presence cleared', async () => {
    registered(); closed();
    db.alice.webrtc_enabled = false;
    await advance(GRACE);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    expect(presence.getPhoneStatus('alice')).toBe('none');
  });

  it('admin disables an idle agent → relay session closed now, webrtc-changed emitted', async () => {
    registered(); relay.sessions.add('alice');
    await presence.permissionChanged('alice', false);
    expect(relay.closeAgent).toHaveBeenCalledWith('alice', 'browser phone disabled');
    expect(emitted).toContainEqual(['agent:webrtc-changed', 'alice', false]);
    expect(presence.getPhoneStatus('alice')).toBe('none');
  });

  it('admin disables an agent on a call → relay closed only after the call ends', async () => {
    db.alice.state = 'In a queue call';
    registered(); relay.sessions.add('alice');
    await presence.permissionChanged('alice', false);
    expect(relay.closeAgent).not.toHaveBeenCalled();
    ccEvents.emit('agent:state', { agentId: 'alice', state: 'Waiting' });
    await flush();
    expect(relay.closeAgent).toHaveBeenCalledWith('alice', 'browser phone disabled');
  });

  it('gateway agent (or EXTERNAL_PBX) never gets PHONE_OFFLINE', async () => {
    db.alice.agent_type = 'gateway';
    registered(); closed();
    await advance(GRACE);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    db.alice.agent_type = 'internal';
    mode = 'EXTERNAL_PBX';
    registered(); closed();
    await advance(GRACE);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });
});

describe('backend restart', () => {
  it('logged-in WebRTC agents that do not re-register within the startup grace go offline', async () => {
    const n = presence.startupRecovery([db.alice, db.bob, { ...base, agent_id: 'gw', agent_type: 'gateway' }, { ...base, agent_id: 'out', status: 'Logged Out' }]);
    expect(n).toBe(2);
    registered('bob');
    await advance(60_000);
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
    expect(applyPhoneOffline).toHaveBeenCalledWith('alice');
    expect(presence.getPhoneStatus('bob')).toBe('online');
  });

  it('nothing is applied before the startup grace ends', async () => {
    presence.startupRecovery([db.alice]);
    await advance(59_999);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });
});

describe('makeApplyPhoneOffline — existing status path, no duplicates', () => {
  function deps(updatedRows) {
    const calls = [];
    const query = vi.fn(async (sql, params) => {
      calls.push(sql.replace(/\s+/g, ' ').trim());
      if (/^UPDATE agents/.test(sql.trim())) return { rows: updatedRows };
      if (/FROM break_codes/.test(sql)) return { rows: [{ name: 'Phone offline' }] };
      return { rows: [] };
    });
    const order = [];
    const agentSession = { handleStatusTransition: vi.fn(async () => order.push('history')) };
    const cc = { agentSetStatus: vi.fn(async () => order.push('esl')) };
    const ev = new EventEmitter(); const seen = []; ev.on('agent:status', (p) => seen.push(p));
    return { query, agentSession, cc, ccEvents: ev, calls, order, seen };
  }

  it('compare-and-set only from Available; history written before FreeSWITCH is told', async () => {
    const d = deps([{ agent_id: 'alice' }]);
    const apply = makeApplyPhoneOffline(d);
    expect(await apply('alice')).toBe(true);
    expect(d.calls[0]).toMatch(/WHERE agent_id = \$1 AND status = 'Available'/);
    expect(d.agentSession.handleStatusTransition).toHaveBeenCalledWith('alice', 'On Break', 'phone_offline', { break_code: 'PHONE_OFFLINE', break_name: 'Phone offline' });
    expect(d.order).toEqual(['history', 'esl']);
    expect(d.calls.some((c) => /INSERT INTO agent_state_log .*'phone_offline'/.test(c))).toBe(true);
    expect(d.seen[0]).toMatchObject({ agentId: 'alice', status: 'On Break', break_code: 'PHONE_OFFLINE' });
  });

  it('agent no longer Available → nothing written, FreeSWITCH untouched', async () => {
    const d = deps([]);
    expect(await makeApplyPhoneOffline(d)('alice')).toBe(false);
    expect(d.agentSession.handleStatusTransition).not.toHaveBeenCalled();
    expect(d.cc.agentSetStatus).not.toHaveBeenCalled();
    expect(d.calls).toHaveLength(1);
  });

  it('ESL offline does not break the DB transition', async () => {
    const d = deps([{ agent_id: 'alice' }]);
    d.cc.agentSetStatus.mockRejectedValueOnce(new Error('ESL down'));
    expect(await makeApplyPhoneOffline(d)('alice')).toBe(true);
  });
});

describe('browser refresh allowance (CP3-E page-reload)', () => {
  it('reload notice before the loss: the next loss gets 60 s instead of 15 s', async () => {
    registered();
    expect(presence.expectReload('alice')).toBe(true);
    closed();
    await advance(GRACE + 1_000);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    registered(); // agent typed the SIP password again in time
    await advance(60_000);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    expect(presence.getPhoneStatus('alice')).toBe('online');
  });

  it('reload notice after the loss already started: the running grace is extended once', async () => {
    registered(); closed();
    await advance(10_000);
    presence.expectReload('alice');
    await advance(10_000);              // 20 s after loss: normal grace would have expired
    expect(applyPhoneOffline).not.toHaveBeenCalled();
    await advance(50_000);              // reload allowance over, no re-registration
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
  });

  it('refresh that never comes back still ends in PHONE_OFFLINE (no permanent bypass)', async () => {
    registered();
    presence.expectReload('alice');
    closed();
    await advance(60_000);
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
  });

  it('allowance is once per 5 minutes and only for the next loss', async () => {
    registered();
    expect(presence.expectReload('alice')).toBe(true);
    expect(presence.expectReload('alice')).toBe(false);
    closed(); registered();             // allowance used
    closed();
    await advance(GRACE);
    expect(applyPhoneOffline).toHaveBeenCalledTimes(1);
  });

  it('phone signed out by the page unload (REGISTER expires 0) also gets the allowance', async () => {
    registered();
    presence.expectReload('alice');
    relayEvents.emit('unregistered', { agentId: 'alice', reason: 'unregister' });
    await advance(GRACE + 1_000);
    expect(applyPhoneOffline).not.toHaveBeenCalled();
  });
});
