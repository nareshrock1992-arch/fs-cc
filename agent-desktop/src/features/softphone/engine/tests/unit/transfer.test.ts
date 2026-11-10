import { describe, expect, it } from 'vitest';
import { reduceCall, sipfragStatus } from '../../src/services/call-state';

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
