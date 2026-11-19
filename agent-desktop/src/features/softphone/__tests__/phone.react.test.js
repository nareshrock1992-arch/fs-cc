import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Store } from '../engine/src/services/store';

// Replace the real engine facade (it needs SIP.js, microphone and a server) with a fake
// that has the same public shape and a real engine Store.
const constructed = [];
vi.mock('../engine/src/services/phone-service', () => {
  class FakePhoneService {
    constructor(config) {
      this.config = config;
      this.store = new Store({ connection: 'disconnected', registration: 'unregistered', online: true });
      this.login = vi.fn(async () => {});
      this.logout = vi.fn(async () => {});
      this.answer = vi.fn(async () => {});
      constructed.push(this);
    }
  }
  return { PhoneService: FakePhoneService };
});

const { getPhoneService, __resetPhoneServiceForTests } = await import('../phoneSingleton');
const { PhoneProvider } = await import('../PhoneProvider');
const { usePhone } = await import('../usePhone');

const ENV = {};
const AGENT = { contact: '{sip_cid_type=pid}user/1000@172.21.20.57', full_name: 'Agent One', webrtc_allowed: true };
const TICKET = { ticket: 'test-ticket-1', extension: '1000', sip_domain: '192.168.1.124', relay_path: '/api/sip-relay' };
const fetchTicket = vi.fn(async (kind) => ({ ...TICKET, ticket: `test-ticket-${kind}` }));

let host;
let root;
let latest;

function Probe() {
  latest = usePhone();
  return null;
}

function render(props, strict = false) {
  const tree = createElement(PhoneProvider, { fetchTicket, apiBase: 'https://cc.example/cc/api', ...props }, createElement(Probe));
  act(() => root.render(strict ? createElement(StrictMode, null, tree) : tree));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  __resetPhoneServiceForTests();
  constructed.length = 0;
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('phoneSingleton', () => {
  it('creates one instance and reuses it', () => {
    const a = getPhoneService({ defaultDomain: 'd' });
    const b = getPhoneService({ defaultDomain: 'other' });
    expect(a).toBe(b);
    expect(constructed).toHaveLength(1);
  });

  it('requires config on first use', () => {
    expect(() => getPhoneService()).toThrow(/configuration is required/);
  });
});

describe('PhoneProvider + usePhone', () => {
  it('StrictMode double mounting still creates exactly one PhoneService', () => {
    render({ agent: AGENT, env: ENV }, true);
    render({ agent: { ...AGENT }, env: ENV }, true);
    expect(constructed).toHaveLength(1);
    expect(latest.available).toBe(true);
  });

  it('reflects engine store updates', () => {
    render({ agent: AGENT, env: ENV });
    expect(latest.state.registration).toBe('unregistered');
    act(() =>
      constructed[0].store.update({
        connection: 'connected',
        registration: 'registered',
        account: { extension: '1000', domain: '192.168.1.124', wssUrl: 'wss://cc.example/cc/api/sip-relay?ticket=***' },
      }),
    );
    expect(latest.state.registration).toBe('registered');
    expect(latest.indicator).toEqual({ level: 'ok', label: 'Phone ready' });
  });

  it('login: a relay ticket is fetched first; extension/domain come from the SERVER; URL is the FS-CC relay', async () => {
    fetchTicket.mockClear();
    render({ agent: AGENT, env: ENV });
    let result;
    await act(async () => {
      result = await latest.login('dummy-test-value');
    });
    expect(result).toEqual({ ok: true });
    expect(fetchTicket).toHaveBeenCalledWith('connect');
    const creds = constructed[0].login.mock.calls[0][0];
    expect(creds).toMatchObject({
      extension: '1000',
      password: 'dummy-test-value',
      domain: '192.168.1.124',
      wssUrl: 'wss://cc.example/cc/api/sip-relay?ticket=test-ticket-connect',
      displayName: 'Agent One',
    });
    // No direct FreeSWITCH WSS (:7443) anywhere in the integrated path.
    expect(creds.wssUrl).not.toMatch(/:7443/);
    // Reconnects get a NEW ticket each time.
    await expect(creds.ticketProvider('reconnect')).resolves.toBe('wss://cc.example/cc/api/sip-relay?ticket=test-ticket-reconnect');
    expect(fetchTicket).toHaveBeenLastCalledWith('reconnect');
  });

  it('login: the server refuses the ticket (403) → clear message, engine untouched', async () => {
    const refuse = vi.fn(async () => { const e = new Error('Browser phone is not enabled for this agent.'); e.status = 403; throw e; });
    render({ agent: AGENT, env: ENV, fetchTicket: refuse });
    let result;
    await act(async () => { result = await latest.login('x'); });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not enabled for you/);
    expect(constructed[0].login).not.toHaveBeenCalled();
  });

  it('agent the server does not allow (EXTERNAL_PBX / switch off): no engine, no ticket request', async () => {
    fetchTicket.mockClear();
    render({ agent: { ...AGENT, webrtc_allowed: false }, env: ENV });
    expect(constructed).toHaveLength(0);
    expect(latest.available).toBe(false);
    let result;
    await act(async () => { result = await latest.login('x'); });
    expect(result.ok).toBe(false);
    expect(fetchTicket).not.toHaveBeenCalled();
  });

  it('gateway agent: not available and login is refused without creating the engine', async () => {
    fetchTicket.mockClear();
    render({ agent: { contact: 'sofia/gateway/gw/0501234567', webrtc_allowed: true }, env: ENV });
    expect(latest.available).toBe(false);
    let result;
    await act(async () => {
      result = await latest.login('x');
    });
    expect(result.ok).toBe(false);
    expect(constructed).toHaveLength(0);
    expect(fetchTicket).not.toHaveBeenCalled();
  });

  it('missing configuration: no engine is created and the error is reported', async () => {
    render({ agent: AGENT, env: { VITE_WEBRTC_ENABLED: 'false' } });
    expect(constructed).toHaveLength(0);
    expect(latest.available).toBe(false);
    expect(latest.state).toBeNull();
    expect(latest.configError).toMatch(/switched off/);
    let result;
    await act(async () => {
      result = await latest.login('x');
    });
    expect(result.ok).toBe(false);
  });

  it('unmounting the provider does not log the phone out', () => {
    render({ agent: AGENT, env: ENV });
    act(() => root.unmount());
    root = createRoot(host); // so afterEach can unmount safely
    expect(constructed[0].logout).not.toHaveBeenCalled();
  });

  it('usePhone outside the provider throws a clear error', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => act(() => root.render(createElement(Probe)))).toThrow(/inside <PhoneProvider>/);
    errors.mockRestore();
  });
});
