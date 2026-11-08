import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Store } from '../engine/src/services/store';

const constructed = [];
vi.mock('../engine/src/services/phone-service', () => {
  class FakePhoneService {
    constructor(config) {
      this.config = config;
      this.store = new Store({ connection: 'disconnected', registration: 'unregistered', online: true });
      for (const m of ['login', 'logout', 'answer', 'reject', 'hangup', 'toggleMute', 'unlockAudio',
        'dial', 'toggleHold', 'sendDtmf', 'refreshDevices', 'selectInput', 'selectOutput', 'clearError']) {
        this[m] = vi.fn(async () => {});
      }
      constructed.push(this);
    }
  }
  return { PhoneService: FakePhoneService };
});

const { __resetPhoneServiceForTests, getPhoneService } = await import('../phoneSingleton');
const { PhoneProvider } = await import('../PhoneProvider');
const { SoftphoneCard, formatDuration, displayNumber } = await import('../ui/SoftphonePanel');
const { stopSoftphoneIfActive } = await import('../index');

const ENV = { VITE_SIP_DOMAIN: '192.168.1.124', VITE_SIP_WSS_URL: 'wss://192.168.1.124:7443' };
const AGENT = { contact: '{sip_cid_type=pid}user/1000@172.21.20.57', full_name: 'Agent One' };

let host;
let root;

function render(agent, env = ENV) {
  act(() => root.render(createElement(PhoneProvider, { agent, env }, createElement(SoftphoneCard))));
}
const q = (sel) => host.querySelector(sel);
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));

function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  __resetPhoneServiceForTests();
  constructed.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SoftphonePanel', () => {
  it('shows the extension from the contact and a password-only sign-in', () => {
    render(AGENT);
    expect(host.textContent).toContain('1000');
    const input = q('input[type="password"]');
    expect(input).not.toBeNull();
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(host.querySelectorAll('input').length).toBe(1); // no extension/domain/WSS fields
    expect(button('Sign in').disabled).toBe(true);
  });

  it('signs in with the typed password, then clears the field', async () => {
    render(AGENT);
    act(() => type(q('input[type="password"]'), 'dummy-test-value'));
    expect(button('Sign in').disabled).toBe(false);
    await act(async () => {
      q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(constructed[0].login).toHaveBeenCalledWith(
      expect.objectContaining({ extension: '1000', password: 'dummy-test-value', domain: '192.168.1.124' }),
    );
    expect(q('input[type="password"]').value).toBe('');
  });

  it('gateway agent sees an explanation and no password field', () => {
    render({ contact: 'sofia/gateway/gw/0501234567' });
    expect(q('input')).toBeNull();
    expect(host.textContent).toMatch(/Gateway agents/);
  });

  it('missing configuration is reported', () => {
    render(AGENT, {});
    expect(q('input')).toBeNull();
    expect(host.textContent).toMatch(/not configured/);
  });

  it('incoming call shows Answer / Reject, active call shows Mute / Hang up', () => {
    render(AGENT);
    const svc = constructed[0];
    const account = { extension: '1000', domain: 'd', wssUrl: 'wss://d' };
    act(() =>
      svc.store.update({
        account,
        connection: 'connected',
        registration: 'registered',
        call: { id: 'c1', direction: 'inbound', remoteIdentity: '2000', status: 'ringing-in', muted: false, held: false },
      }),
    );
    act(() => button('Answer').click());
    expect(svc.answer).toHaveBeenCalled();
    expect(button('Reject')).toBeDefined();

    act(() => svc.store.update({ call: { ...svc.store.get().call, status: 'active' } }));
    act(() => button('Hang up').click());
    expect(svc.hangup).toHaveBeenCalled();
    expect(button('Mute')).toBeDefined();
  });
});

describe('SoftphonePanel — Step 1 telephony controls', () => {
  const account = { extension: '1000', domain: 'd', wssUrl: 'wss://d' };
  const DEVICES = {
    inputs: [{ deviceId: 'mic-1', label: 'Headset mic' }],
    outputs: [{ deviceId: 'spk-1', label: 'Headset speaker' }],
    selectedInput: '',
    selectedOutput: '',
    sinkSupported: true,
  };
  const registered = (extra = {}) => ({
    account, connection: 'connected', registration: 'registered', devices: DEVICES, ...extra,
  });
  const activeCall = (extra = {}) => ({
    id: 'c1', direction: 'inbound', remoteIdentity: 'sip:1001@192.168.1.124', status: 'active',
    muted: false, held: false, answeredAt: Date.now() - 65_000, ...extra,
  });
  const svc = () => constructed[0];

  it('formats durations and remote numbers', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(displayNumber('sip:1001@192.168.1.124')).toBe('1001');
    expect(displayNumber('"Agent" <sip:2000@d;transport=ws>')).toBe('2000');
    expect(displayNumber('0501234567')).toBe('0501234567');
    expect(displayNumber(undefined)).toBe('Unknown');
  });

  it('dial pad: no dial pad until registered', () => {
    render(AGENT);
    act(() => svc().store.update(registered({ registration: 'registering' })));
    expect(q('input[aria-label="Number to call"]')).toBeNull();
  });

  it('dial pad: typing strips invalid characters, keypad appends, Call dials and clears', async () => {
    render(AGENT);
    act(() => svc().store.update(registered()));
    const input = q('input[aria-label="Number to call"]');
    expect(button('Call').disabled).toBe(true);
    act(() => type(input, '10a0'));
    expect(input.value).toBe('100');
    act(() => q('button[aria-label="Show keypad"]').click());
    const keypad = q('[aria-label="Dial keypad"]');
    expect(keypad.querySelectorAll('button')).toHaveLength(12);
    act(() => [...keypad.querySelectorAll('button')].find((b) => b.textContent === '1').click());
    expect(input.value).toBe('1001');
    await act(async () => {
      q('form[aria-label="Dial pad"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(svc().dial).toHaveBeenCalledWith('1001');
    expect(input.value).toBe('');
  });

  it('outgoing ringing shows the number and a Cancel button that hangs up', () => {
    render(AGENT);
    act(() => svc().store.update(registered({
      call: activeCall({ direction: 'outbound', status: 'ringing-out', remoteIdentity: '1001', answeredAt: undefined }),
    })));
    expect(q('[aria-label="Remote number"]').textContent).toContain('1001');
    expect(host.textContent).toContain('Ringing');
    expect(q('[aria-label="Call duration"]')).toBeNull();
    expect(button('Hold')).toBeUndefined();
    act(() => button('Cancel').click());
    expect(svc().hangup).toHaveBeenCalled();
  });

  it('active call: shows caller number and running timer; hold/resume and mute call the engine', () => {
    render(AGENT);
    act(() => svc().store.update(registered({ call: activeCall() })));
    expect(q('[aria-label="Remote number"]').textContent).toContain('1001');
    expect(q('[aria-label="Call duration"]').textContent).toMatch(/^01:0[5-9]$/);
    act(() => button('Hold').click());
    expect(svc().toggleHold).toHaveBeenCalledTimes(1);
    act(() => svc().store.update({ call: activeCall({ held: true }) }));
    expect(host.textContent).toContain('On hold');
    act(() => button('Resume').click());
    expect(svc().toggleHold).toHaveBeenCalledTimes(2);
    act(() => button('Mute').click());
    expect(svc().toggleMute).toHaveBeenCalled();
    expect(q('form[aria-label="Dial pad"]')).toBeNull(); // no second call while one is up
  });

  it('call timer ticks and stops when the call ends', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
      render(AGENT);
      act(() => svc().store.update(registered({ call: activeCall({ answeredAt: Date.now() }) })));
      expect(q('[aria-label="Call duration"]').textContent).toBe('00:00');
      act(() => vi.advanceTimersByTime(3000));
      expect(q('[aria-label="Call duration"]').textContent).toBe('00:03');
      act(() => svc().store.update({ call: activeCall({ status: 'ended' }) }));
      expect(q('[aria-label="Call duration"]')).toBeNull();
      expect(q('input[aria-label="Number to call"]')).not.toBeNull(); // back to the dial pad
    } finally {
      vi.useRealTimers();
    }
  });

  it('in-call keypad sends DTMF tones and shows what was sent', () => {
    render(AGENT);
    act(() => svc().store.update(registered({ call: activeCall() })));
    expect(q('[aria-label="In-call keypad"]')).toBeNull();
    act(() => button('Keypad').click());
    const pad = q('[aria-label="In-call keypad"]');
    const key = (k) => [...pad.querySelectorAll('button')].find((b) => b.textContent === k);
    act(() => key('1').click());
    act(() => key('#').click());
    expect(svc().sendDtmf).toHaveBeenNthCalledWith(1, '1');
    expect(svc().sendDtmf).toHaveBeenNthCalledWith(2, '#');
    expect(q('[aria-label="Tones sent"]').textContent).toBe('1#');
  });

  it('audio devices: lists devices and selects microphone and speaker', () => {
    render(AGENT);
    act(() => svc().store.update(registered()));
    act(() => button('Audio devices').click());
    expect(svc().refreshDevices).toHaveBeenCalled();
    const mic = q('select[aria-label="Microphone"]');
    const spk = q('select[aria-label="Speaker"]');
    expect(mic.textContent).toContain('Headset mic');
    expect(spk.textContent).toContain('Headset speaker');
    act(() => { mic.value = 'mic-1'; mic.dispatchEvent(new Event('change', { bubbles: true })); });
    act(() => { spk.value = 'spk-1'; spk.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(svc().selectInput).toHaveBeenCalledWith('mic-1');
    expect(svc().selectOutput).toHaveBeenCalledWith('spk-1');
  });

  it('speaker choice is disabled with an explanation when the browser cannot route audio', () => {
    render(AGENT);
    act(() => svc().store.update(registered({ devices: { ...DEVICES, sinkSupported: false } })));
    act(() => button('Audio devices').click());
    expect(q('select[aria-label="Speaker"]').disabled).toBe(true);
    expect(host.textContent).toMatch(/can't choose the speaker/);
  });

  it('never writes to browser storage', async () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    render(AGENT);
    act(() => type(q('input[type="password"]'), 'dummy-test-value'));
    await act(async () => {
      q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    act(() => svc().store.update(registered({ call: activeCall() })));
    act(() => button('Keypad').click());
    expect(setLocal).not.toHaveBeenCalled();
    expect(host.innerHTML).not.toContain('dummy-test-value');
    setLocal.mockRestore();
  });
});

describe('stopSoftphoneIfActive', () => {
  it('does nothing (and creates nothing) when the phone was never started', async () => {
    await stopSoftphoneIfActive();
    expect(constructed).toHaveLength(0);
  });

  it('logs out an existing phone and swallows errors', async () => {
    const svc = getPhoneService({ defaultDomain: 'd' });
    svc.logout.mockRejectedValueOnce(new Error('already gone'));
    await expect(stopSoftphoneIfActive()).resolves.toBeUndefined();
    expect(svc.logout).toHaveBeenCalledTimes(1);
  });
});
