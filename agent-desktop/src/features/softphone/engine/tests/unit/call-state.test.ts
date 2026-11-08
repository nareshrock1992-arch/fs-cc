import { describe, expect, it } from 'vitest';
import { describeSipStatus, reduceCall } from '../../src/services/call-state';
import type { CallInfo } from '../../src/types/phone';

const start = (direction: 'inbound' | 'outbound') =>
  reduceCall(undefined, { type: 'start', id: 'c1', direction, remoteIdentity: '7990002' });

describe('reduceCall – outbound', () => {
  it('dialing -> ringing-out -> active -> ended', () => {
    let call = start('outbound');
    expect(call?.status).toBe('dialing');
    call = reduceCall(call, { type: 'progress' });
    expect(call?.status).toBe('ringing-out');
    call = reduceCall(call, { type: 'established', at: 1000 });
    expect(call).toMatchObject({ status: 'active', answeredAt: 1000 });
    call = reduceCall(call, { type: 'ended', reason: 'Remote party hung up' });
    expect(call).toMatchObject({ status: 'ended', endReason: 'Remote party hung up' });
  });
});

describe('reduceCall – inbound', () => {
  it('ringing-in -> connecting -> active', () => {
    let call = start('inbound');
    expect(call?.status).toBe('ringing-in');
    call = reduceCall(call, { type: 'answering' });
    expect(call?.status).toBe('connecting');
    call = reduceCall(call, { type: 'established', at: 5 });
    expect(call?.status).toBe('active');
  });

  it('ignores progress on inbound calls', () => {
    const call = reduceCall(start('inbound'), { type: 'progress' });
    expect(call?.status).toBe('ringing-in');
  });
});

describe('reduceCall – mute/hold guards', () => {
  const active = reduceCall(start('outbound'), { type: 'established', at: 1 }) as CallInfo;

  it('mute and hold only while active', () => {
    expect(reduceCall(active, { type: 'mute', muted: true })?.muted).toBe(true);
    expect(reduceCall(active, { type: 'hold', held: true })?.held).toBe(true);
    expect(reduceCall(start('outbound'), { type: 'mute', muted: true })?.muted).toBe(false);
  });

  it('established twice keeps the original answer time', () => {
    expect(reduceCall(active, { type: 'established', at: 999 })?.answeredAt).toBe(1);
  });

  it('nothing changes an ended call', () => {
    const ended = reduceCall(active, { type: 'ended', reason: 'x' });
    expect(reduceCall(ended, { type: 'established', at: 2 })).toBe(ended);
  });

  it('events without a call are ignored', () => {
    expect(reduceCall(undefined, { type: 'progress' })).toBeUndefined();
  });
});

describe('describeSipStatus', () => {
  it('maps common codes', () => {
    expect(describeSipStatus(486)).toBe('Busy');
    expect(describeSipStatus(480)).toContain('not registered');
    expect(describeSipStatus(488)).toContain('codec');
    expect(describeSipStatus(599)).toBe('Call failed (SIP 599)');
  });
});
