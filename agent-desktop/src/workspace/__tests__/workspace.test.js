import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const callHistory = vi.fn();
vi.mock('../../api/client.js', () => ({ api: { callHistory: (...a) => callHistory(...a) } }));

const { correlate } = await import('../../interactions/correlate.js');
const { default: InteractionWorkspace } = await import('../InteractionWorkspace.jsx');
const { default: PhoneCard } = await import('../PhoneCard.jsx');
const { dialBlockedReason } = await import('../Dialer.jsx');
const { CustomerPanel, shouldWarnNotReachable, NotReachableBanner, ActivityStrip } = await import('../ContextPanels.jsx');

let host;
let root;
const render = (el) => act(() => root.render(el));
const q = (sel) => host.querySelector(sel);
const btn = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const DEVICES = { inputs: [{ deviceId: 'm1', label: 'Headset mic' }], outputs: [{ deviceId: 's1', label: 'Headset' }], selectedInput: '', selectedOutput: '', sinkSupported: true };
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
const sipCall = (extra = {}) => ({ id: 's1', direction: 'inbound', remoteIdentity: 'sip:1001@192.168.1.124', status: 'ringing-in', muted: false, held: false, ...extra });
const ws = (phone, esl = null, extra = {}) =>
  createElement(InteractionWorkspace, {
    result: correlate({ esl, sip: phone?.state?.call || null, phoneSignedIn: phone?.state?.registration === 'registered' }),
    phone, agentStatus: 'Available', recentNumbers: [], ...extra,
  });

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  callHistory.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('idle workspace and dialer', () => {
  it('blocked reasons come from real phone state', () => {
    expect(dialBlockedReason(null)).toMatch(/not enabled/);
    expect(dialBlockedReason(makePhone({ account: undefined }))).toMatch(/Sign in/);
    expect(dialBlockedReason(makePhone({ registration: 'registering' }))).toBe('Phone ready'); // indicator label
    expect(dialBlockedReason(makePhone())).toBeNull();
  });

  it('keypad hidden by default; Call dials once and clears; recent numbers fill the input', async () => {
    const phone = makePhone();
    render(ws(phone, null, { recentNumbers: ['0501234567'] }));
    expect(host.textContent).toContain('Waiting for the next interaction');
    expect(q('[aria-label="Dial keypad"]')).toBeNull();
    act(() => btn('0501234567').click());
    expect(q('input[aria-label="Number to call"]').value).toBe('0501234567');
    act(() => type(q('input[aria-label="Number to call"]'), '10a01'));
    expect(q('input[aria-label="Number to call"]').value).toBe('1001');
    act(() => q('button[aria-label="Show keypad"]').click());
    expect(q('[aria-label="Dial keypad"]').querySelectorAll('button')).toHaveLength(12);
    await act(async () => q('form[aria-label="Dial pad"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(phone.dial).toHaveBeenCalledTimes(1);
    expect(phone.dial).toHaveBeenCalledWith('1001');
    expect(q('input[aria-label="Number to call"]').value).toBe('');
  });

  it('dialer is disabled with the reason when the phone is not signed in', () => {
    render(ws(makePhone({ account: undefined, registration: 'unregistered' })));
    expect(q('input[aria-label="Number to call"]').disabled).toBe(true);
    expect(host.textContent).toContain('Sign in to the browser phone');
  });

  it('agent not Available is stated', () => {
    render(ws(makePhone(), null, { agentStatus: 'On Break' }));
    expect(host.textContent).toContain('You are On Break');
  });
});

describe('incoming call', () => {
  it('linked queue call: one card with number, name, queue; Answer/Reject call the engine', () => {
    const phone = makePhone({ call: sipCall({ remoteIdentity: 'sip:0501234567@d' }) });
    render(ws(phone, { phase: 'ringing', callUuid: 'u1', ani: '0501234567', caller_name: 'John', queueName: 'Sales' }));
    expect(host.querySelectorAll('[aria-label="Incoming call"]')).toHaveLength(1);
    expect(host.textContent).toContain('John');
    expect(host.textContent).toContain('Queue · Sales');
    expect(q('[aria-label="Ringing for"]')).not.toBeNull();
    act(() => btn('Answer').click());
    act(() => btn('Reject').click());
    expect(phone.answer).toHaveBeenCalled();
    expect(phone.reject).toHaveBeenCalled();
  });

  it('queue offer before the browser rings: no Answer button, timing message', () => {
    render(ws(makePhone(), { phase: 'ringing', callUuid: 'u1', ani: '0501234567', queueName: 'Sales' }));
    expect(btn('Answer')).toBeUndefined();
    expect(host.textContent).toContain('waiting for it to ring');
  });

  it('conflicting queue + browser calls are not merged', () => {
    const phone = makePhone({ call: sipCall({ remoteIdentity: 'sip:1001@d' }) });
    render(ws(phone, { phase: 'ringing', callUuid: 'u1', ani: '0509999999', queueName: 'Sales' }));
    expect(host.textContent).toContain('could not be confirmed');
    expect(q('[aria-label="Queue call"]').textContent).toContain('0509999999');
    expect(host.querySelectorAll('[aria-label="Incoming call"]')).toHaveLength(1);
  });
});

describe('outbound and active call', () => {
  it('outbound progress shows destination and Cancel; no call controls yet', () => {
    const phone = makePhone({ call: sipCall({ direction: 'outbound', status: 'ringing-out', remoteIdentity: '1001' }) });
    render(ws(phone));
    expect(host.textContent).toContain('Calling 1001');
    expect(q('[role="toolbar"]')).toBeNull();
    act(() => btn('Cancel').click());
    expect(phone.hangup).toHaveBeenCalled();
  });

  it('connected: timer, mute, hold, keypad DTMF, end; transfer/conference disabled', () => {
    const phone = makePhone({ call: sipCall({ status: 'active', answeredAt: Date.now() - 61_000 }) });
    render(ws(phone));
    expect(q('[aria-label="Call duration"]').textContent).toMatch(/^01:0[1-5]$/);
    act(() => btn('Mute').click());
    act(() => btn('Hold').click());
    expect(phone.toggleMute).toHaveBeenCalled();
    expect(phone.toggleHold).toHaveBeenCalled();
    expect(q('button[aria-label="Transfer (not available yet)"]').disabled).toBe(true);
    expect(q('button[aria-label="Conference (not available yet)"]').disabled).toBe(true);
    act(() => btn('Keypad').click());
    act(() => q('[aria-label="In-call keypad"] button[aria-label="5"]').click());
    expect(phone.sendDtmf).toHaveBeenCalledWith('5');
    expect(q('[aria-label="Tones sent"]').textContent).toBe('5');
    act(() => btn('End call').click());
    expect(phone.hangup).toHaveBeenCalled();
  });

  it('held state shows Resume and On hold', () => {
    render(ws(makePhone({ call: sipCall({ status: 'active', held: true, answeredAt: Date.now() }) })));
    expect(host.textContent).toContain('On hold');
    expect(btn('Resume')).toBeDefined();
  });

  it('queue call connected on another device: no controls', () => {
    render(ws(makePhone(), { phase: 'talking', callUuid: 'u1', ani: '0501234567' }));
    expect(q('[role="toolbar"]')).toBeNull();
    expect(host.textContent).toContain('device handling this call');
  });

  it('ended call shows the termination reason', () => {
    render(ws(makePhone({ call: sipCall({ direction: 'outbound', status: 'ended', endReason: 'Busy', remoteIdentity: '1001' }) })));
    expect(host.textContent).toContain('Call not connected');
    expect(host.textContent).toContain('Busy');
  });
});

describe('phone card', () => {
  it('password-only sign in, cleared after submit, nothing stored', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const phone = makePhone({ account: undefined, registration: 'unregistered' });
    render(createElement(PhoneCard, { phone }));
    act(() => type(q('input[type="password"]'), 'dummy-test-value'));
    await act(async () => q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(phone.login).toHaveBeenCalledWith('dummy-test-value');
    expect(q('input[type="password"]').value).toBe('');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('audio devices select microphone and speaker', () => {
    const phone = makePhone();
    render(createElement(PhoneCard, { phone }));
    act(() => q('button[aria-label="Audio devices"]').click());
    expect(phone.refreshDevices).toHaveBeenCalled();
    const mic = q('select[aria-label="Microphone"]');
    act(() => { mic.value = 'm1'; mic.dispatchEvent(new Event('change', { bubbles: true })); });
    const spk = q('select[aria-label="Speaker"]');
    act(() => { spk.value = 's1'; spk.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(phone.selectInput).toHaveBeenCalledWith('m1');
    expect(phone.selectOutput).toHaveBeenCalledWith('s1');
  });
});

describe('context panels', () => {
  it('Not reachable only when Available and phone not registered', () => {
    expect(shouldWarnNotReachable({ agentStatus: 'Available', phone: makePhone({ registration: 'unregistered' }) })).toBe(true);
    expect(shouldWarnNotReachable({ agentStatus: 'Available', phone: makePhone() })).toBe(false);
    expect(shouldWarnNotReachable({ agentStatus: 'On Break', phone: makePhone({ registration: 'unregistered' }) })).toBe(false);
    expect(shouldWarnNotReachable({ agentStatus: 'Available', phone: null })).toBe(false);
    render(createElement(NotReachableBanner, { extension: '1000' }));
    expect(host.textContent).toContain('Not reachable');
  });

  it('customer panel shows real fields and this agent\'s previous calls', async () => {
    callHistory.mockResolvedValue({ data: [{ call_uuid: 'a', start_time: '2026-11-01T10:00:00Z', queue_name: 'Sales', agent_talk_seconds: 75 }] });
    await act(async () => render(createElement(CustomerPanel, { interaction: { number: '0501234567', name: 'John', direction: 'inbound', queue: 'Sales' } })));
    expect(callHistory).toHaveBeenCalledWith({ search: '501234567', limit: 5 });
    expect(host.textContent).toContain('John');
    expect(host.textContent).toContain('01:15');
    expect(host.textContent).toContain('No CRM is connected');
    expect(host.textContent).not.toMatch(/@|email/i);
  });

  it('customer panel idle state', () => {
    render(createElement(CustomerPanel, { interaction: null }));
    expect(host.textContent).toContain('appear here during a call');
    expect(callHistory).not.toHaveBeenCalled();
  });

  it('activity strip is one compact line', () => {
    render(createElement(ActivityStrip, { perf: { calls_handled: 4, calls_missed: 1, avg_talk_seconds: 90, total_talk_seconds: 360 } }));
    expect(host.textContent).toMatch(/4handled/);
    expect(host.textContent).toContain('06:00');
  });
});
