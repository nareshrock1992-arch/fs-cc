// Unit tests for the pre-queue live store (Phase 1A). Pure module — no DB, no
// ESL, no timers — so these run fully offline and prove the lifecycle logic:
// create/update, dedupe, hangup, queue-entry handoff + dedup, stale expiry,
// unknown-field safety, and caller-ID masking.
import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../../../services/preQueueStore.js';

beforeEach(() => store.clear());

describe('observe — create & update', () => {
  it('creates an active entry on first observation with first-seen timestamps', () => {
    const e = store.observe('chanA', { ani: '96650001111', dnis: '7001', stage: 'play:welcome', now: 1000 });
    expect(e.status).toBe('active');
    expect(e.firstSeen).toBe(1000);
    expect(e.stageSince).toBe(1000);
    expect(store.size()).toBe(1);
  });

  it('updates the SAME entry in place on repeat (no duplicate rows)', () => {
    store.observe('chanA', { stage: 'play:welcome', now: 1000 });
    store.observe('chanA', { stage: 'play:welcome', now: 2000 }); // same stage
    expect(store.size()).toBe(1);
    const e = store.get('chanA');
    expect(e.firstSeen).toBe(1000);       // unchanged
    expect(e.lastUpdate).toBe(2000);      // advanced
    expect(e.stageSince).toBe(1000);      // stage did NOT change → anchor held
  });

  it('advances stageSince only when the stage actually changes', () => {
    store.observe('chanA', { stage: 'play:welcome', now: 1000 });
    store.observe('chanA', { stage: 'gather_digits', now: 3000 });
    expect(store.get('chanA').stageSince).toBe(3000);
  });

  it('ignores empty chanUuid', () => {
    expect(store.observe('', { stage: 'x' })).toBeNull();
    expect(store.size()).toBe(0);
  });
});

// CHANNEL_CREATE seed lifecycle: an inbound caller is created with NO observed
// stage yet (we only know a leg exists), then EXECUTE/DTMF refine the stage. This
// is the path that makes the monitor populate for the mod_lua IVR (which doesn't
// emit CHANNEL_EXECUTE for its prompts).
describe('observe — CHANNEL_CREATE seed then refine', () => {
  it('creates an entry with no stage (caller present, step not yet observed)', () => {
    const e = store.observe('chanA', { ani: '96650001111', dnis: '7001', now: 1000 });
    expect(e.status).toBe('active');
    expect(e.stage).toBeNull();            // nothing observed yet → not an invented step
    expect(e.firstSeen).toBe(1000);
    expect(store.publicView(e).stage).toBeNull(); // panel shows its generic "in IVR" fallback
  });
  it('a later observed step refines the stage and advances stageSince (first-seen preserved)', () => {
    store.observe('chanA', { ani: '9665', now: 1000 });       // seed (no stage)
    const e = store.observe('chanA', { stage: 'gather_digits', now: 4000 }); // refine
    expect(store.size()).toBe(1);          // same entry, not a duplicate
    expect(e.firstSeen).toBe(1000);        // preserved from the seed
    expect(e.stage).toBe('gather_digits');
    expect(e.stageSince).toBe(4000);       // stage became known here
    expect(e.ani).toBe('9665');            // seed ANI retained
  });
  it('a stage-less repeat (e.g. another CREATE-like touch) only advances lastUpdate', () => {
    store.observe('chanA', { now: 1000 });
    store.observe('chanA', { now: 2500 });
    expect(store.size()).toBe(1);
    expect(store.get('chanA')).toMatchObject({ stage: null, firstSeen: 1000, lastUpdate: 2500 });
  });
});

describe('hangup before queue entry', () => {
  it('removes the entry and reports reason hangup', () => {
    store.observe('chanA', { stage: 'play', now: 1000 });
    const removed = store.remove('chanA', { reason: 'hangup', now: 5000 });
    expect(removed.status).toBe('hangup');
    expect(store.get('chanA')).toBeNull();
    expect(store.size()).toBe(0);
  });
  it('remove on an unknown channel is a safe no-op', () => {
    expect(store.remove('ghost', { reason: 'hangup' })).toBeNull();
  });
});

describe('queue-entry handoff + dedup', () => {
  it('handoff removes from the active list (caller now a real queue member)', () => {
    store.observe('chanA', { stage: 'queue:Sales', now: 1000 });
    const t = store.handoff('chanA', { callUuid: 'MEMBER-1', queueName: 'Sales@ACME', now: 2000 });
    expect(t.status).toBe('enqueued');
    expect(t.callUuid).toBe('MEMBER-1');
    expect(store.get('chanA')).toBeNull();      // not in pre-queue list anymore
    expect(store.listActive()).toHaveLength(0); // → no double count with the queue list
  });
  it('handoff on an unknown channel is a safe no-op', () => {
    expect(store.handoff('ghost', { callUuid: 'X' })).toBeNull();
  });
});

describe('stale expiry', () => {
  it('sweeps entries older than the TTL and returns their ids (not a hangup)', () => {
    const TTL = store.PREQUEUE_TTL_MS;
    store.observe('old', { stage: 'play', now: 0 });        // age at sweep = TTL + 1000 → stale
    store.observe('fresh', { stage: 'play', now: TTL });    // age at sweep = 1000 → kept
    const removed = store.sweepStale(TTL + 1000, TTL);
    expect(removed).toContain('old');
    expect(removed).not.toContain('fresh');
    expect(store.get('fresh')).toBeTruthy();
  });
  it('keeps an entry exactly at the boundary minus 1ms', () => {
    store.observe('edge', { stage: 'play', now: 0 });
    const removed = store.sweepStale(store.PREQUEUE_TTL_MS - 1, store.PREQUEUE_TTL_MS);
    expect(removed).toHaveLength(0);
  });
});

describe('reconnect reset', () => {
  it('clear() drops all live state', () => {
    store.observe('a', { stage: 'x' });
    store.observe('b', { stage: 'y' });
    store.clear();
    expect(store.size()).toBe(0);
  });
});

describe('publicView — masking & unknown-field safety', () => {
  it('masks the caller id and never leaks the raw ANI', () => {
    store.observe('chanA', { ani: '96650001234', stage: 'play', now: 1000 });
    const v = store.publicView(store.get('chanA'));
    expect(v.callerMasked).toBe('•••••••••34');
    expect(JSON.stringify(v)).not.toContain('96650001234');
  });
  it('short/empty ANI masks safely', () => {
    expect(store.maskAni('12')).toBe('•••');
    expect(store.maskAni(null)).toBeNull();
  });
  it('eligibility / target queue / transfer / flow name are null (not observable)', () => {
    store.observe('chanA', { ani: '9665', stage: 'play', now: 1000 });
    const v = store.publicView(store.get('chanA'));
    expect(v.eligibilityReason).toBeNull();
    expect(v.targetQueue).toBeNull();
    expect(v.transferSucceeded).toBeNull();
    expect(v.flowName).toBeNull();
  });
  it('exposes a safe short channel id, ISO timestamps, and observed stage', () => {
    store.observe('0123456789abcdef', { stage: 'gather_digits', now: 1000 });
    const v = store.publicView(store.get('0123456789abcdef'));
    expect(v.id).toBe('01234567');
    expect(v.stage).toBe('gather_digits');
    expect(v.firstSeen).toBe(new Date(1000).toISOString());
  });
});
