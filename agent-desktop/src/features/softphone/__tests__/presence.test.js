import { describe, expect, it } from 'vitest';
import { phonePresence, availableBlockedReason, showRecoveryPrompt, PHONE } from '../presence';

const eng = (o = {}) => ({ connection: 'disconnected', registration: 'unregistered', ...o });
const acct = { account: { extension: '1000' } };

describe('phonePresence — phone state is separate from agent state', () => {
  it('desk-phone agents (not allowed) → hidden, nothing shown', () => {
    expect(phonePresence({ allowed: false, engine: eng({ registration: 'registered' }) }).key).toBe(PHONE.HIDDEN);
  });
  it.each([
    ['not signed in', eng(), 'none', PHONE.SIGNED_OUT],
    ['connecting', eng({ ...acct, connection: 'connecting' }), 'none', PHONE.CONNECTING],
    ['registering', eng({ ...acct, connection: 'connected', registration: 'registering' }), 'none', PHONE.CONNECTING],
    ['registered', eng({ ...acct, connection: 'connected', registration: 'registered' }), 'online', PHONE.REGISTERED],
    ['engine reconnecting', eng({ ...acct, connection: 'reconnecting' }), 'online', PHONE.RECONNECTING],
    ['server grace while signed in', eng({ ...acct, connection: 'connected' }), 'grace', PHONE.RECONNECTING],
    ['server offline (e.g. after refresh, not signed in)', eng(), 'offline', PHONE.OFFLINE],
    ['sign-in failed', eng({ registration: 'failed' }), 'none', PHONE.FAILED],
  ])('%s', (_n, engine, server, key) => {
    expect(phonePresence({ allowed: true, engine, server }).key).toBe(key);
  });
  it('registered on this browser wins over a lagging server "offline"', () => {
    expect(phonePresence({ allowed: true, engine: eng({ ...acct, connection: 'connected', registration: 'registered' }), server: 'offline' }).key).toBe(PHONE.REGISTERED);
  });
  it('phone code not loaded yet (engine null) → signed out', () => {
    expect(phonePresence({ allowed: true, engine: null }).key).toBe(PHONE.SIGNED_OUT);
  });
});

describe('Available is blocked while the phone cannot take calls', () => {
  it.each([[PHONE.OFFLINE, /offline/], [PHONE.SIGNED_OUT, /Sign in/], [PHONE.FAILED, /Sign in/]])('%s', (key, re) => {
    expect(availableBlockedReason({ key })).toMatch(re);
  });
  it.each([PHONE.REGISTERED, PHONE.RECONNECTING, PHONE.CONNECTING, PHONE.HIDDEN])('%s → allowed (short interruptions do not block)', (key) => {
    expect(availableBlockedReason({ key })).toBeNull();
  });
});

describe('recovery prompt — never sets Available automatically', () => {
  it('only when registered again AND on the PHONE_OFFLINE break', () => {
    const reg = { key: PHONE.REGISTERED };
    expect(showRecoveryPrompt({ presence: reg, agentStatus: 'On Break', breakCode: 'PHONE_OFFLINE' })).toBe(true);
    expect(showRecoveryPrompt({ presence: reg, agentStatus: 'On Break', breakCode: 'LUNCH' })).toBe(false);
    expect(showRecoveryPrompt({ presence: { key: PHONE.OFFLINE }, agentStatus: 'On Break', breakCode: 'PHONE_OFFLINE' })).toBe(false);
    expect(showRecoveryPrompt({ presence: reg, agentStatus: 'Available', breakCode: null })).toBe(false);
  });
});
