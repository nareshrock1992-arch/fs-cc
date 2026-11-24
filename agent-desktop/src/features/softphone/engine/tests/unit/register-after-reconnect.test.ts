// Lab 2026-11-24: after a successful call the desk kept saying "Phone connecting…"
// while FreeSWITCH had the phone registered. Cause: after a WebSocket reconnect the
// desk marks itself "registering" and re-REGISTERs, but SIP.js's Registerer is still
// "Registered" and emits no stateChange for the accepted refresh. These tests pin the
// fix: an accepted REGISTER always reports "registered".
import { describe, expect, it, vi } from 'vitest';

type Delegate = { onAccept?: (r: unknown) => void; onReject?: (r: { message: { statusCode: number; reasonPhrase: string } }) => void };
const registerers: FakeRegisterer[] = [];
class FakeRegisterer {
  state = 'Initial';
  listeners: ((s: string) => void)[] = [];
  stateChange = { addListener: (fn: (s: string) => void) => this.listeners.push(fn) };
  constructor() { registerers.push(this); }
  /** Like SIP.js: transition (and emit) only when the state changes, then call onAccept. */
  async register(opts: { requestDelegate?: Delegate }) {
    if (this.state !== 'Registered') { this.state = 'Registered'; this.listeners.forEach((fn) => fn('Registered')); }
    opts.requestDelegate?.onAccept?.({});
  }
  reject(opts: { requestDelegate?: Delegate }, code: number) {
    opts.requestDelegate?.onReject?.({ message: { statusCode: code, reasonPhrase: 'Forbidden' } });
  }
  async unregister() {}
  async dispose() {}
}
vi.mock('sip.js', () => ({
  Registerer: FakeRegisterer,
  RegistererState: { Registered: 'Registered', Unregistered: 'Unregistered' },
  Inviter: class {},
  UserAgent: class {
    static makeURI(s: string) { return { toString: () => s }; }
    transport = {};
    async start() {}
    async stop() {}
    isConnected() { return true; }
  },
}));

const { SipClient } = await import('../../src/sip/sip-client');

function client() {
  const events = { onConnected: vi.fn(), onDisconnected: vi.fn(), onRegistered: vi.fn(), onUnregistered: vi.fn(), onRegistrationFailed: vi.fn(), onInvite: vi.fn() };
  const c = new SipClient({ registerExpires: 300, iceGatheringTimeoutMs: 1000, iceServers: [] } as never,
    { extension: '1003', domain: 'pbx.example', password: 'test-only', wssUrl: 'wss://cc.example/api/sip-relay?ticket=T' } as never, events);
  return { c, events, reg: registerers[registerers.length - 1] };
}

describe('registration status after a reconnect', () => {
  it('first REGISTER → registered', async () => {
    const { c, events } = client();
    await c.register();
    expect(events.onRegistered).toHaveBeenCalled();
  });

  it('re-REGISTER while SIP.js is still "Registered" (after a reconnect) → registered is reported again', async () => {
    const { c, events } = client();
    await c.register();
    events.onRegistered.mockClear();
    await c.register();                                // no state change inside SIP.js
    expect(events.onRegistered).toHaveBeenCalledTimes(1);
  });

  it('a refused REGISTER still reports the failure, never "registered"', async () => {
    const { c, events, reg } = client();
    const spy = vi.spyOn(reg, 'register').mockImplementation(async (opts) => reg.reject(opts as never, 403));
    await c.register();
    expect(events.onRegistrationFailed).toHaveBeenCalledWith(403, 'Forbidden');
    expect(events.onRegistered).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
