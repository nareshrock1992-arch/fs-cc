import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const { default: CallStrip } = await import('../CallStrip.jsx');
const { default: RecentCalls, callbackNumber } = await import('../RecentCalls.jsx');

let host;
let root;
const render = (el) => act(() => root.render(el));
const q = (sel) => host.querySelector(sel);
const btn = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

function makePhone() {
  const p = {};
  for (const m of ['answer', 'reject', 'hangup', 'toggleMute', 'toggleHold']) p[m] = vi.fn();
  return p;
}
const ix = (extra = {}) => ({
  id: 's1', channel: 'voice', kind: 'queue', direction: 'inbound', number: '1001', name: 'Monday',
  queue: 'RadioPAGA', status: 'connected', muted: false, held: false, answeredAt: Date.now() - 5000,
  controllable: true, ...extra,
});

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('CallStrip', () => {
  it('in call: number, name, queue, timer and real controls; Keypad opens the phone', () => {
    const phone = makePhone();
    const onOpenPhone = vi.fn();
    render(createElement(CallStrip, { interaction: ix(), phone, onOpenPhone }));
    expect(q('[aria-label="Remote number"]').textContent).toBe('1001');
    expect(host.textContent).toContain('Monday · RadioPAGA');
    expect(q('[aria-label="Call duration"]').textContent).toMatch(/^00:0[5-9]$/);
    act(() => btn('Mute').click());
    act(() => btn('Hold').click());
    act(() => btn('Keypad').click());
    act(() => btn('End').click());
    expect(phone.toggleMute).toHaveBeenCalled();
    expect(phone.toggleHold).toHaveBeenCalled();
    expect(onOpenPhone).toHaveBeenCalled();
    expect(phone.hangup).toHaveBeenCalled();
  });

  it('ringing: Answer / Reject and ringing timer', () => {
    const phone = makePhone();
    render(createElement(CallStrip, { interaction: ix({ status: 'ringing', answeredAt: undefined }), phone }));
    expect(q('[aria-label="Ringing for"]')).not.toBeNull();
    act(() => btn('Answer').click());
    act(() => btn('Reject').click());
    expect(phone.answer).toHaveBeenCalled();
    expect(phone.reject).toHaveBeenCalled();
  });

  it('outgoing progress: Cancel only', () => {
    const phone = makePhone();
    render(createElement(CallStrip, { interaction: ix({ status: 'ringing-out', direction: 'outbound', answeredAt: undefined }), phone }));
    expect(btn('Mute')).toBeUndefined();
    act(() => btn('Cancel').click());
    expect(phone.hangup).toHaveBeenCalled();
  });

  it('call on another device: no controls', () => {
    render(createElement(CallStrip, { interaction: ix({ status: 'connected-elsewhere', controllable: false }), phone: makePhone() }));
    expect(btn('End')).toBeUndefined();
    expect(host.textContent).toContain('On another device');
  });
});

describe('RecentCalls', () => {
  const rows = [
    { call_uuid: 'a', direction: 'inbound', ani: '1001', caller_name: 'Monday', queue_name: 'RadioPAGA', start_time: '2026-11-08T10:00:00Z', agent_talk_seconds: 50 },
    { call_uuid: 'b', direction: 'outbound', dnis: '0501234567', ani: '1000', start_time: '2026-11-08T09:00:00Z', talk_seconds: 61 },
    { call_uuid: 'c', direction: 'inbound', ani: '1002', missed: true, start_time: '2026-11-08T08:00:00Z' },
  ];

  it('call-back number follows direction', () => {
    expect(callbackNumber(rows[0])).toBe('1001');
    expect(callbackNumber(rows[1])).toBe('0501234567');
  });

  it('lists real rows with result; click loads the number (never dials)', () => {
    const onPick = vi.fn();
    render(createElement(RecentCalls, { calls: rows, onPick }));
    const items = host.querySelectorAll('[aria-label="Recent calls"] li');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Monday · RadioPAGA');
    expect(items[0].textContent).toContain('00:50');
    expect(items[1].textContent).toContain('01:01');
    expect(items[2].textContent).toContain('Missed');
    act(() => items[1].querySelector('button').click());
    expect(onPick).toHaveBeenCalledWith('0501234567');
  });

  it('empty and loading states', () => {
    render(createElement(RecentCalls, { calls: [], loading: true }));
    expect(host.textContent).toContain('Loading');
    render(createElement(RecentCalls, { calls: [], loading: false }));
    expect(host.textContent).toContain('No calls yet');
  });
});
