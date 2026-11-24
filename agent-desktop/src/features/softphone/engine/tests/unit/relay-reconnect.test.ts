// CP3-E: with the FS-CC relay, every reconnect must use a NEW single-use ticket.
// The same SIP.js UserAgent is kept (live call dialogs survive); only its server
// URL changes. Controlled clock (fake timers), fake SIP client, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/audio/devices', () => ({
  audioConstraints: () => ({ audio: true }), describeMediaError: String, isSinkSupported: () => false,
  listAudioDevices: async () => ({ inputs: [], outputs: [] }), onDeviceChange: () => undefined,
  requestMicrophonePermission: async () => undefined,
}));
vi.mock('../../src/audio/remote-audio', () => ({ RemoteAudio: class { attach() {} detach() {} } }));
vi.mock('../../src/audio/ringtone', () => ({ Ringtone: class { stop() {} startRingback() {} startIncoming() {} } }));

type Events = { onConnected(): void; onDisconnected(e?: Error): void; onRegistered(): void };
const clients: FakeClient[] = [];
class FakeClient {
  events: Events;
  creds: { wssUrl: string };
  reconnects: (string | undefined)[] = [];
  stop = vi.fn(async () => undefined);
  constructor(_config: unknown, creds: { wssUrl: string }, events: Events) { this.creds = creds; this.events = events; clients.push(this); }
  async start() { this.events.onConnected(); }
  async reconnect(url?: string) { this.reconnects.push(url); }
  isConnected() { return false; }
  async register() { this.events.onRegistered(); }
}
vi.mock('../../src/sip/sip-client', () => ({ SipClient: FakeClient }));
vi.mock('../../src/sip/call-session', () => ({
  applyHoldMedia: () => undefined, applyMute: () => undefined, remoteStreamOf: () => undefined,
  sendDtmf: async () => undefined, sendHoldReInvite: async () => undefined, switchMicrophone: async () => undefined,
}));

const { PhoneService } = await import('../../src/services/phone-service');
const { TicketError } = await import('../../src/types/phone');

const BASE = { extension: '1000', domain: 'pbx.example', password: 'test-only', wssUrl: 'wss://cc.example/api/sip-relay?ticket=FIRST' };

async function signedIn(provider: (k: 'connect' | 'reconnect') => Promise<string>) {
  const svc = new PhoneService({ registerExpires: 300, iceGatheringTimeoutMs: 1000, iceServers: [] } as never);
  await svc.login({ ...BASE, ticketProvider: provider });
  return { svc, client: clients[clients.length - 1] };
}

beforeEach(() => { clients.length = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('relay reconnect with fresh tickets', () => {
  it('each reconnect asks for a NEW ticket and points the same UserAgent at it', async () => {
    let n = 0;
    const provider = vi.fn(async () => `wss://cc.example/api/sip-relay?ticket=NEW${++n}`);
    const { svc, client } = await signedIn(provider);
    expect(svc.store.get().registration).toBe('registered');

    client.events.onDisconnected(new Error('WebSocket closed wss://cc.example/api/sip-relay?ticket=FIRST (code: 1006)'));
    expect(svc.store.get().connection).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(provider).toHaveBeenCalledWith('reconnect');
    expect(client.reconnects).toEqual(['wss://cc.example/api/sip-relay?ticket=NEW1']);

    client.events.onDisconnected();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(client.reconnects[1]).toBe('wss://cc.example/api/sip-relay?ticket=NEW2');
    expect(client.reconnects).not.toContain(BASE.wssUrl); // the spent first ticket is never reused
    expect(clients).toHaveLength(1);                     // same UserAgent (dialogs survive)
  });

  it('temporary ticket failure (e.g. 429) is retried with back-off', async () => {
    const provider = vi.fn()
      .mockRejectedValueOnce(new TicketError('Too many phone connection attempts.', false))
      .mockResolvedValue('wss://cc.example/api/sip-relay?ticket=OK');
    const { client } = await signedIn(provider);
    client.events.onDisconnected();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(client.reconnects).toEqual([]);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(client.reconnects).toEqual(['wss://cc.example/api/sip-relay?ticket=OK']);
  });

  it('permission removed (fatal) with no call → stop retrying, sign the phone out, explain why', async () => {
    const provider = vi.fn(async () => { throw new TicketError('The browser phone is not enabled for you.', true); });
    const { svc, client } = await signedIn(provider);
    client.events.onDisconnected();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(client.stop).toHaveBeenCalled();
    expect(svc.store.get().account).toBeUndefined();
    expect(svc.store.get().error).toMatch(/not enabled/);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('permission removed (fatal) DURING a call → the call is not cut; retries stop', async () => {
    const provider = vi.fn(async () => { throw new TicketError('The browser phone is not enabled for you.', true); });
    const { svc, client } = await signedIn(provider);
    (svc as unknown as Record<string, unknown>).session = { id: 'call-1', state: 'Established', bye: vi.fn() };
    client.events.onDisconnected();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(client.stop).not.toHaveBeenCalled();
    expect(svc.store.get().error).toMatch(/not enabled/);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('phone locked after refused passwords → stop knocking, sign out, show the lock message (lab 2026-11-24)', async () => {
    const msg = 'Too many failed phone sign-ins. Check your phone password and try again in 5 minutes.';
    const provider = vi.fn(async () => { throw new TicketError(msg, true); });
    const { svc, client } = await signedIn(provider);
    client.events.onDisconnected(new Error('WebSocket closed (code: 4429)'));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(svc.store.get().account).toBeUndefined();
    expect(svc.store.get().error).toBe(msg);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(provider).toHaveBeenCalledTimes(1);                   // no retry storm while locked
  });

  it('connect failure explains both causes, never only "certificate"', async () => {
    const svc = new PhoneService({ registerExpires: 300, iceGatheringTimeoutMs: 1000, iceServers: [] } as never);
    const start = vi.spyOn(FakeClient.prototype, 'start').mockRejectedValueOnce(new Error('WebSocket error'));
    await svc.login({ ...BASE });
    start.mockRestore();
    const err = svc.store.get().error ?? '';
    expect(err).toMatch(/^Could not connect the browser phone to the server \(wss:\/\/cc\.example\/api\/sip-relay\?ticket=\*\*\*\)\./);
    expect(err).toMatch(/try again in a minute/);
    expect(err).toMatch(/certificate warning/);
    expect(err).not.toContain('FIRST');
  });

  it('the ticket never appears in UI state', async () => {
    const { svc } = await signedIn(async () => 'wss://x?ticket=NEW');
    expect(svc.store.get().account?.wssUrl).toBe('wss://cc.example/api/sip-relay?ticket=***');
    expect(JSON.stringify(svc.store.get())).not.toContain('FIRST');
  });

  it('browser back online → immediate reconnect with a fresh ticket', async () => {
    const provider = vi.fn(async () => 'wss://cc.example/api/sip-relay?ticket=ONLINE');
    const { client } = await signedIn(provider);
    client.events.onDisconnected();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(10);
    expect(client.reconnects).toContain('wss://cc.example/api/sip-relay?ticket=ONLINE');
  });
});
