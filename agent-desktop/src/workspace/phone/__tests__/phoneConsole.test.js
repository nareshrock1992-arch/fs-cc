import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { correlate } from '../../../interactions/correlate.js';

const { default: PhoneConsole, dialBlockedReason } = await import('../PhoneConsole.jsx');

let host;
let root;
const render = (el) => act(() => root.render(el));
const q = (sel) => host.querySelector(sel);
const btn = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.getAttribute('aria-label') === text);
const key = (k) => q(`[role="group"] button[aria-label="${k}"]`);
function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const DEVICES = {
  inputs: [{ deviceId: 'm1', label: 'Headset mic' }], outputs: [{ deviceId: 's1', label: 'Headset speaker' }],
  selectedInput: '', selectedOutput: '', sinkSupported: true,
};
function makePhone(state = {}) {
  const fns = {};
  for (const m of ['login', 'logout', 'dial', 'answer', 'reject', 'hangup', 'toggleMute', 'toggleHold', 'sendDtmf', 'refreshDevices', 'selectInput', 'selectOutput', 'unlockAudio', 'clearError']) {
    fns[m] = vi.fn(async () => (m === 'login' ? { ok: true } : undefined));
  }
  return {
    ...fns,
    configError: null,
    eligibility: { eligible: true, extension: '1000' },
    indicator: { level: 'ok', label: 'Phone ready' },
    state: { account: { extension: '1000' }, registration: 'registered', connection: 'connected', devices: DEVICES, online: true, ...state },
  };
}
const sip = (extra = {}) => ({ id: 's1', direction: 'inbound', remoteIdentity: '1001 <1001>', status: 'ringing-in', muted: false, held: false, ...extra });
function console_(phone, esl = null, extra = {}) {
  const { interaction } = correlate({ esl, sip: phone?.state?.call || null, phoneSignedIn: phone?.state?.registration === 'registered' });
  return createElement(PhoneConsole, { phone, interaction, ...extra });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('PhoneConsole — idle', () => {
  it('shows a complete keypad (0–9, *, #) without any click', () => {
    render(console_(makePhone()));
    const keys = [...q('[aria-label="Dial keypad"]').querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(keys).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']);
    expect(q('[aria-label="Phone status"]').textContent).toContain('Phone ready');
    expect(host.textContent).toContain('1000');
  });

  it('keypad, backspace and clear edit the number; Call dials once and clears', async () => {
    const phone = makePhone();
    render(console_(phone));
    const input = q('input[aria-label="Number to call"]');
    expect(btn('Call').disabled).toBe(true);
    for (const k of ['1', '0', '0', '2']) act(() => key(k).click());
    expect(input.value).toBe('1002');
    act(() => btn('Delete last digit').click());
    act(() => key('1').click());
    expect(input.value).toBe('1001');
    await act(async () => btn('Call').click());
    expect(phone.dial).toHaveBeenCalledTimes(1);
    expect(phone.dial).toHaveBeenCalledWith('1001');
    expect(input.value).toBe('');
    act(() => type(input, '+97 1-50'));
    expect(input.value).toBe('+97150');
    act(() => btn('Clear number').click());
    expect(input.value).toBe('');
  });

  it('a number picked elsewhere is loaded into the display', () => {
    render(console_(makePhone(), null, { dialRequest: { number: '0501234567', at: 1 } }));
    expect(q('input[aria-label="Number to call"]').value).toBe('0501234567');
  });

  it('not signed in: password sign-in, keypad visible but disabled, reason shown', async () => {
    const phone = makePhone({ account: undefined, registration: 'unregistered' });
    phone.indicator = { level: 'off', label: 'Phone off' };
    render(console_(phone));
    expect(key('5').disabled).toBe(true);
    expect(host.textContent).toContain('Sign in to the phone to make calls');
    act(() => type(q('input[type="password"]'), 'dummy-test-value'));
    await act(async () => q('form[aria-label="Phone sign in"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(phone.login).toHaveBeenCalledWith('dummy-test-value');
    expect(q('input[type="password"]').value).toBe('');
  });

  it('call controls are present but disabled when idle; transfer/conference say why', () => {
    render(console_(makePhone()));
    expect(btn('Mute').disabled).toBe(true);
    expect(btn('Hold').disabled).toBe(true);
    expect(q('button[aria-label="Transfer (not available yet)"]').disabled).toBe(true);
    expect(q('button[aria-label="Conference (not available yet)"]').disabled).toBe(true);
    expect(btn('End call')).toBeUndefined();
  });

  it('devices: selectors use the engine and list labels', () => {
    const phone = makePhone();
    render(console_(phone));
    expect(phone.refreshDevices).toHaveBeenCalled();
    const mic = q('select[aria-label="Microphone"]');
    expect(mic.textContent).toContain('Headset mic');
    act(() => { mic.value = 'm1'; mic.dispatchEvent(new Event('change', { bubbles: true })); });
    const spk = q('select[aria-label="Speaker"]');
    act(() => { spk.value = 's1'; spk.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(phone.selectInput).toHaveBeenCalledWith('m1');
    expect(phone.selectOutput).toHaveBeenCalledWith('s1');
  });

  it('phone not built in', () => {
    render(console_(null));
    expect(host.textContent).toContain('built without the browser phone');
    expect(dialBlockedReason(null)).toMatch(/not enabled/);
  });
});

describe('PhoneConsole — calls', () => {
  it('incoming: number, ringing timer, Answer/Reject; keypad disabled', () => {
    const phone = makePhone({ call: sip() });
    render(console_(phone, { phase: 'ringing', callUuid: 'u1', ani: '1001', caller_name: 'Monday', queueName: 'RadioPAGA' }));
    expect(q('[aria-label="Remote number"]').textContent).toBe('1001');
    expect(host.textContent).toContain('Monday · RadioPAGA');
    expect(q('[aria-label="Ringing for"]')).not.toBeNull();
    expect(key('1').disabled).toBe(true);
    act(() => btn('Answer').click());
    act(() => btn('Reject').click());
    expect(phone.answer).toHaveBeenCalled();
    expect(phone.reject).toHaveBeenCalled();
  });

  it('outgoing progress: Cancel call hangs up, no Call button', () => {
    const phone = makePhone({ call: sip({ direction: 'outbound', status: 'ringing-out', remoteIdentity: '1001' }) });
    render(console_(phone));
    expect(host.textContent).toContain('Ringing…');
    expect(btn('Call')).toBeUndefined();
    act(() => btn('Cancel call').click());
    expect(phone.hangup).toHaveBeenCalled();
  });

  it('in call: timer, mute, hold, DTMF from keypad and keyboard, End call', () => {
    const phone = makePhone({ call: sip({ status: 'active', answeredAt: Date.now() - 30_000 }) });
    render(console_(phone));
    expect(q('[aria-label="Call duration"]').textContent).toMatch(/^00:3[0-4]/);
    act(() => btn('Mute').click());
    act(() => btn('Hold').click());
    expect(phone.toggleMute).toHaveBeenCalled();
    expect(phone.toggleHold).toHaveBeenCalled();
    act(() => q('[aria-label="In-call keypad"] button[aria-label="5"]').click());
    act(() => q('section[aria-label="Phone"]').dispatchEvent(new KeyboardEvent('keydown', { key: '#', bubbles: true })));
    expect(phone.sendDtmf).toHaveBeenNthCalledWith(1, '5');
    expect(phone.sendDtmf).toHaveBeenNthCalledWith(2, '#');
    expect(q('[aria-label="Tones sent"]').textContent).toBe('Tones sent: 5#');
    act(() => btn('End call').click());
    expect(phone.hangup).toHaveBeenCalled();
  });

  it('held and muted states show Resume / Unmute pressed', () => {
    render(console_(makePhone({ call: sip({ status: 'active', held: true, muted: true, answeredAt: Date.now() }) })));
    expect(btn('Resume').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Unmute').getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('On hold');
  });

  it('ended: last-call line with reason, keypad back to dialing', () => {
    render(console_(makePhone({ call: sip({ direction: 'outbound', status: 'ended', endReason: 'Busy', remoteIdentity: '1001' }) })));
    expect(q('[aria-label="Last call"]').textContent).toContain('Busy');
    expect(key('1').disabled).toBe(false);
  });

  it('queue call on another device: no call actions', () => {
    render(console_(makePhone(), { phase: 'talking', callUuid: 'u1', ani: '1001' }));
    expect(btn('End call')).toBeUndefined();
    expect(host.textContent).toContain('Use the device handling this call');
  });
});

describe('PhoneConsole — errors are visible', () => {
  it('microphone missing at sign-in: error at the top, status "Sign-in failed", dismissable', () => {
    const phone = makePhone({ account: undefined, registration: 'unregistered', error: 'No microphone was found. Connect a microphone or headset.' });
    phone.indicator = { level: 'off', label: 'Phone off' };
    render(console_(phone));
    const alert = q('[role="alert"]');
    expect(alert.textContent).toContain('No microphone was found');
    // the alert comes before the keypad in the document (top of the console)
    expect(alert.compareDocumentPosition(q('[aria-label="Dial keypad"]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('[aria-label="Phone status"]').textContent).toContain('Sign-in failed');
    act(() => btn('Dismiss').click());
    expect(phone.clearError).toHaveBeenCalled();
  });

  it('audio notice with Enable audio is shown at the top', () => {
    const phone = makePhone({ notice: 'Click to enable audio' });
    render(console_(phone));
    act(() => btn('Enable audio').click());
    expect(phone.unlockAudio).toHaveBeenCalled();
  });
});
