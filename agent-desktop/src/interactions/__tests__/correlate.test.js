import { describe, expect, it } from 'vitest';
import { correlate, numbersCompatible, LINK } from '../correlate.js';

const esl = (extra = {}) => ({
  phase: 'ringing', callUuid: 'uuid-1', ani: '0501234567', caller_name: 'John', queueName: 'Sales',
  startedAt: '2026-11-08T10:00:00Z', ...extra,
});
const sip = (extra = {}) => ({
  id: 'sip-1', direction: 'inbound', remoteIdentity: 'sip:0501234567@192.168.1.124', status: 'ringing-in',
  muted: false, held: false, ...extra,
});

describe('numbersCompatible', () => {
  it('equal, suffix (international vs local) and unknown numbers are compatible', () => {
    expect(numbersCompatible('0501234567', 'sip:0501234567@d')).toBe(true);
    expect(numbersCompatible('+971501234567', '0501234567')).toBe(true); // trunk 0 dropped
    expect(numbersCompatible('+971501234567', '501234567')).toBe(true);
    expect(numbersCompatible(undefined, '1001')).toBe(true);
  });
  it('different numbers and short suffixes are not', () => {
    expect(numbersCompatible('1001', '1002')).toBe(false);
    expect(numbersCompatible('0501234567', '4567')).toBe(false);
  });
});

describe('correlate', () => {
  it('nothing live → no interaction', () => {
    expect(correlate({ esl: null, sip: null, phoneSignedIn: true }).interaction).toBeNull();
    expect(correlate({ esl: { phase: null }, sip: null, phoneSignedIn: true }).interaction).toBeNull();
  });

  it('links queue call + inbound browser call for this agent → ONE interaction with queue details', () => {
    const r = correlate({ esl: esl(), sip: sip(), phoneSignedIn: true });
    expect(r.link).toBe(LINK.LINKED);
    expect(r.queueCall).toBeNull();
    expect(r.warning).toBeNull();
    expect(r.interaction).toMatchObject({
      kind: 'queue', queue: 'Sales', name: 'John', callUuid: 'uuid-1', status: 'ringing', controllable: true,
    });
  });

  it('links when the queue side has no number yet (event before poll)', () => {
    const r = correlate({ esl: esl({ ani: null }), sip: sip({ status: 'active', answeredAt: 1 }), phoneSignedIn: true });
    expect(r.link).toBe(LINK.LINKED);
    expect(r.interaction.number).toBe('0501234567');
    expect(r.interaction.status).toBe('connected');
  });

  it('does NOT link on conflicting numbers — keeps both and warns', () => {
    const r = correlate({ esl: esl({ ani: '0509999999' }), sip: sip(), phoneSignedIn: true });
    expect(r.link).toBe(LINK.UNLINKED);
    expect(r.queueCall.callUuid).toBe('uuid-1');
    expect(r.interaction.kind).toBe('direct');
    expect(r.warning).toMatch(/could not be confirmed/);
  });

  it('does NOT link an outbound browser call even if the number matches', () => {
    const r = correlate({ esl: esl(), sip: sip({ direction: 'outbound', status: 'ringing-out' }), phoneSignedIn: true });
    expect(r.link).toBe(LINK.UNLINKED);
    expect(r.interaction.kind).toBe('outbound');
  });

  it('does NOT link when the browser phone is not signed in', () => {
    const r = correlate({ esl: esl(), sip: sip(), phoneSignedIn: false });
    expect(r.link).toBe(LINK.UNLINKED);
  });

  it('browser call only → direct or outbound interaction', () => {
    expect(correlate({ esl: null, sip: sip(), phoneSignedIn: true }).interaction.kind).toBe('direct');
    const out = correlate({ esl: null, sip: sip({ direction: 'outbound', status: 'dialing' }), phoneSignedIn: true });
    expect(out.link).toBe(LINK.PHONE_ONLY);
    expect(out.interaction).toMatchObject({ kind: 'outbound', status: 'dialing' });
  });

  it('queue call only, phone signed in: offering waits for the browser ring (timing gap)', () => {
    const r = correlate({ esl: esl(), sip: null, phoneSignedIn: true });
    expect(r.link).toBe(LINK.QUEUE_ONLY);
    expect(r.interaction).toMatchObject({ status: 'offering', controllable: false });
    expect(r.warning).toMatch(/waiting for it to ring/);
  });

  it('queue call talking with no browser call → connected elsewhere, not controllable', () => {
    const r = correlate({ esl: esl({ phase: 'talking' }), sip: null, phoneSignedIn: false });
    expect(r.interaction).toMatchObject({ status: 'connected-elsewhere', controllable: false });
    expect(r.warning).toMatch(/that device only/);
  });

  it('held and ended browser states are reported', () => {
    expect(correlate({ esl: null, sip: sip({ status: 'active', held: true }), phoneSignedIn: true }).interaction.status).toBe('held');
    const ended = correlate({ esl: null, sip: sip({ status: 'ended', endReason: 'Busy' }), phoneSignedIn: true });
    expect(ended.interaction).toMatchObject({ status: 'ended', endReason: 'Busy' });
  });
});
