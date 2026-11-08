import { describe, expect, it } from 'vitest';
import { describePhoneIndicator } from '../adapters/agentStateAdapter';

const base = {
  connection: 'connected',
  registration: 'registered',
  online: true,
  account: { extension: '1000', domain: 'd', wssUrl: 'wss://d' },
};

describe('describePhoneIndicator', () => {
  it('maps engine state to a display-only indicator', () => {
    expect(describePhoneIndicator(null).level).toBe('off');
    expect(describePhoneIndicator({ ...base, account: undefined }).level).toBe('off');
    expect(describePhoneIndicator(base)).toEqual({ level: 'ok', label: 'Phone ready' });
    expect(describePhoneIndicator({ ...base, registration: 'failed' }).level).toBe('error');
    expect(describePhoneIndicator({ ...base, online: false }).level).toBe('warn');
    expect(describePhoneIndicator({ ...base, connection: 'reconnecting' }).level).toBe('warn');
    expect(describePhoneIndicator({ ...base, connection: 'connecting' }).label).toMatch(/connecting/);
    expect(describePhoneIndicator({ ...base, call: { status: 'active' } }).level).toBe('busy');
    expect(describePhoneIndicator({ ...base, call: { status: 'ended' } }).level).toBe('ok');
    expect(describePhoneIndicator({ ...base, registration: 'unregistered' }).level).toBe('warn');
  });
});
