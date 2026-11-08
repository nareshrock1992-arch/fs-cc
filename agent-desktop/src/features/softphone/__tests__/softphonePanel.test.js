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
      for (const m of ['login', 'logout', 'answer', 'reject', 'hangup', 'toggleMute', 'unlockAudio']) {
        this[m] = vi.fn(async () => {});
      }
      constructed.push(this);
    }
  }
  return { PhoneService: FakePhoneService };
});

const { __resetPhoneServiceForTests, getPhoneService } = await import('../phoneSingleton');
const { PhoneProvider } = await import('../PhoneProvider');
const { SoftphoneCard } = await import('../ui/SoftphonePanel');
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
