// BUG-007: after a transfer REFER is accepted, the agent's leg(s) must be released
// even when FreeSWITCH never sends the final NOTIFY — otherwise a held leg stays
// up for hours and mod_callcenter keeps the agent "In a queue call".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionState } from 'sip.js';

vi.mock('../../src/audio/devices', () => ({
  audioConstraints: () => ({ audio: true }), describeMediaError: String, isSinkSupported: () => false,
  listAudioDevices: async () => ({ inputs: [], outputs: [] }), onDeviceChange: () => undefined,
  requestMicrophonePermission: async () => undefined,
}));
vi.mock('../../src/audio/remote-audio', () => ({ RemoteAudio: class { attach() {} detach() {} } }));
vi.mock('../../src/audio/ringtone', () => ({ Ringtone: class { stop() {} startRingback() {} startIncoming() {} } }));
vi.mock('../../src/sip/sip-client', () => ({ SipClient: class {} }));
vi.mock('../../src/sip/call-session', () => ({
  applyHoldMedia: () => undefined, applyMute: () => undefined, remoteStreamOf: () => undefined,
  sendDtmf: async () => undefined, sendHoldReInvite: async () => undefined, switchMicrophone: async () => undefined,
}));

const { PhoneService, CONSULT_RELEASE_FALLBACK_MS } = await import('../../src/services/phone-service');

type ReferOpts = {
  requestDelegate: { onAccept?: () => void; onReject?: (r: { message: { statusCode: number } }) => void };
  onNotify?: (n: { accept: () => Promise<void>; request: { body: string } }) => void;
};

function fakeSession(id: string) {
  const s = {
    id,
    state: SessionState.Established as SessionState,
    referOpts: undefined as ReferOpts | undefined,
    refer: vi.fn(async (_target: unknown, opts: ReferOpts) => { s.referOpts = opts; }),
    bye: vi.fn(async () => { s.state = SessionState.Terminated; }),
    stateChange: { addListener: () => undefined },
  };
  return s;
}

function setup() {
  const svc = new PhoneService({} as never);
  // test-only access to private fields (fake SIP client/session, no network)
  const priv = svc as unknown as Record<string, unknown>;
  const main = fakeSession('main');
  priv.client = { makeTarget: () => 'sip:1002@test' };
  priv.creds = { extension: '1003', domain: 'test', password: 'x', wssUrl: 'wss://x' };
  priv.session = main;
  svc.store.update({ call: { id: 'main', direction: 'inbound', remoteIdentity: '1002', status: 'active', muted: false, held: false } });
  return { svc, priv, main };
}
const notify = (code: number) => ({ accept: async () => undefined, request: { body: `SIP/2.0 ${code} X` } });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('blind transfer release fallback', () => {
  it('hangs up the agent leg after the fallback when no final NOTIFY arrives', async () => {
    const { svc, main } = setup();
    await svc.transfer('1002');
    main.referOpts!.requestDelegate.onAccept!();
    await vi.advanceTimersByTimeAsync(CONSULT_RELEASE_FALLBACK_MS - 100);
    expect(main.bye).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(main.bye).toHaveBeenCalledTimes(1);
  });

  it('keeps the customer when the transfer fails before the fallback', async () => {
    const { svc, main } = setup();
    await svc.transfer('1002');
    main.referOpts!.requestDelegate.onAccept!();
    main.referOpts!.onNotify!(notify(486));
    await vi.advanceTimersByTimeAsync(CONSULT_RELEASE_FALLBACK_MS + 1000);
    expect(main.bye).not.toHaveBeenCalled();
  });
});

describe('consult transfer release fallback', () => {
  function withConsult() {
    const { svc, priv, main } = setup();
    const consult = fakeSession('consult');
    priv.consultSession = consult;
    svc.store.update({ consult: { id: 'consult', target: '1004', status: 'active', held: false, completing: false } });
    return { svc, main, consult };
  }

  it('releases both legs when FreeSWITCH accepts but never confirms', async () => {
    const { svc, main, consult } = withConsult();
    await svc.completeConsult();
    main.referOpts!.requestDelegate.onAccept!();
    await vi.advanceTimersByTimeAsync(CONSULT_RELEASE_FALLBACK_MS + 2500);
    expect(main.bye).toHaveBeenCalled();
    expect(consult.bye).toHaveBeenCalled();
  });

  it('keeps both calls when the transfer is rejected', async () => {
    const { svc, main, consult } = withConsult();
    await svc.completeConsult();
    main.referOpts!.requestDelegate.onAccept!();
    main.referOpts!.onNotify!(notify(603));
    await vi.advanceTimersByTimeAsync(CONSULT_RELEASE_FALLBACK_MS + 2500);
    expect(main.bye).not.toHaveBeenCalled();
    expect(consult.bye).not.toHaveBeenCalled();
  });
});
