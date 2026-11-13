import { describe, expect, it } from 'vitest';
import { promoteConsult, reduceCall, sipfragStatus } from '../../src/services/call-state';

const active = () => {
  let c = reduceCall(undefined, { type: 'start', id: 'c1', direction: 'inbound', remoteIdentity: '1001' });
  c = reduceCall(c, { type: 'answering' });
  return reduceCall(c, { type: 'established', at: 1 });
};

describe('blind transfer state', () => {
  it('records progress on an active call', () => {
    let c = reduceCall(active(), { type: 'transfer', target: '1002', status: 'requesting' });
    expect(c?.transfer).toEqual({ target: '1002', status: 'requesting', reason: undefined });
    c = reduceCall(c, { type: 'transfer', target: '1002', status: 'failed', reason: 'Busy' });
    expect(c?.transfer?.status).toBe('failed');
    expect(c?.status).toBe('active'); // customer stays on the call
  });

  it('is ignored when the call is not active', () => {
    const ringing = reduceCall(undefined, { type: 'start', id: 'c1', direction: 'inbound', remoteIdentity: '1001' });
    expect(reduceCall(ringing, { type: 'transfer', target: '1002', status: 'requesting' })?.transfer).toBeUndefined();
  });

  it('reads the status of a REFER progress NOTIFY (sipfrag)', () => {
    expect(sipfragStatus('SIP/2.0 100 Trying\r\n')).toBe(100);
    expect(sipfragStatus('SIP/2.0 200 OK')).toBe(200);
    expect(sipfragStatus('SIP/2.0 486 Busy Here')).toBe(486);
    expect(sipfragStatus('')).toBeUndefined();
    expect(sipfragStatus(undefined)).toBeUndefined();
  });
});

describe('consult transfer state', () => {
  it('the colleague call becomes the main call when the customer leaves', () => {
    const call = promoteConsult({ id: 'k1', target: '1002', status: 'active', held: false, completing: false, answeredAt: 5 });
    expect(call).toEqual({ id: 'k1', direction: 'outbound', remoteIdentity: '1002', status: 'active', muted: false, held: false, answeredAt: 5 });
  });
  it('a ringing consult stays ringing after promotion', () => {
    expect(promoteConsult({ id: 'k1', target: '1002', status: 'ringing-out', held: false, completing: false }).status).toBe('ringing-out');
  });
});

describe('conference room (C1)', () => {
  it('is 30 + last two digits of the extension', async () => {
    const { conferenceRoomFor } = await import('../../src/services/call-state');
    expect(conferenceRoomFor('1001')).toBe('3001');
    expect(conferenceRoomFor('2047')).toBe('3047');
    expect(conferenceRoomFor('7')).toBe('3007');
    expect(conferenceRoomFor('')).toBeUndefined();
    expect(conferenceRoomFor(undefined)).toBeUndefined();
  });
});
