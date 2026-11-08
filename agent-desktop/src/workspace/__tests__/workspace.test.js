import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const callHistory = vi.fn();
vi.mock('../../api/client.js', () => ({ api: { callHistory: (...a) => callHistory(...a) } }));

const { correlate } = await import('../../interactions/correlate.js');
const { default: InteractionWorkspace } = await import('../InteractionWorkspace.jsx');
const { CustomerPanel, shouldWarnNotReachable, NotReachableBanner, ActivityStrip } = await import('../ContextPanels.jsx');

let host;
let root;
const render = (el) => act(() => root.render(el));
const q = (sel) => host.querySelector(sel);
const btn = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));

function makePhone(state = {}) {
  const p = {};
  for (const m of ['answer', 'reject', 'hangup', 'toggleMute', 'toggleHold', 'sendDtmf']) p[m] = vi.fn();
  return {
    ...p,
    configError: null,
    eligibility: { eligible: true, extension: '1000' },
    indicator: { level: 'ok', label: 'Phone ready' },
    state: { account: { extension: '1000' }, registration: 'registered', ...state },
  };
}
const sipCall = (extra = {}) => ({ id: 's1', direction: 'inbound', remoteIdentity: '1001 <1001>', status: 'ringing-in', muted: false, held: false, ...extra });
const ws = (phone, esl = null, extra = {}) =>
  createElement(InteractionWorkspace, {
    result: correlate({ esl, sip: phone?.state?.call || null, phoneSignedIn: phone?.state?.registration === 'registered' }),
    phone, agentStatus: 'Available', ...extra,
  });

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  callHistory.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('call details (beside the phone console)', () => {
  it('idle: readiness and recent calls; a row loads the number', () => {
    const onPickNumber = vi.fn();
    render(ws(makePhone(), null, {
      recentCalls: [{ call_uuid: 'a', direction: 'inbound', ani: '1001', queue_name: 'RadioPAGA', agent_talk_seconds: 10 }],
      onPickNumber,
    }));
    expect(host.textContent).toContain('Waiting for the next interaction');
    act(() => q('[aria-label="Recent calls"] button').click());
    expect(onPickNumber).toHaveBeenCalledWith('1001');
  });

  it('agent not Available is stated', () => {
    render(ws(makePhone(), null, { agentStatus: 'On Break' }));
    expect(host.textContent).toContain('You are On Break');
  });

  it('linked queue call: ONE incoming card with number, name, queue; Answer/Reject call the engine', () => {
    const phone = makePhone({ call: sipCall() });
    render(ws(phone, { phase: 'ringing', callUuid: 'u1', ani: '1001', caller_name: 'Monday', queueName: 'RadioPAGA' }));
    expect(host.querySelectorAll('[aria-label="Incoming call"]')).toHaveLength(1);
    expect(q('[aria-label="Call number"]').textContent).toBe('1001');
    expect(host.textContent).toContain('Monday');
    expect(host.textContent).toContain('Queue · RadioPAGA');
    act(() => btn('Answer').click());
    act(() => btn('Reject').click());
    expect(phone.answer).toHaveBeenCalled();
    expect(phone.reject).toHaveBeenCalled();
  });

  it('queue offer before the browser rings: no Answer, waiting message', () => {
    render(ws(makePhone(), { phase: 'ringing', callUuid: 'u1', ani: '1001', queueName: 'RadioPAGA' }));
    expect(btn('Answer')).toBeUndefined();
    expect(host.textContent).toContain('waiting for it to ring');
  });

  it('conflicting queue + browser calls are not merged', () => {
    const phone = makePhone({ call: sipCall() });
    render(ws(phone, { phase: 'ringing', callUuid: 'u1', ani: '0509999999', queueName: 'Sales' }));
    expect(host.textContent).toContain('could not be confirmed');
    expect(q('[aria-label="Queue call"]').textContent).toContain('0509999999');
  });

  it('active: summary with duration and NO duplicate controls (they are in the console)', () => {
    render(ws(makePhone({ call: sipCall({ status: 'active', answeredAt: Date.now() - 61_000 }) })));
    expect(q('[aria-label="Call duration"]').textContent).toMatch(/^01:0[1-5]$/);
    expect(btn('Mute')).toBeUndefined();
    expect(btn('End call')).toBeUndefined();
    expect(host.textContent).toContain('Use the phone on the left');
  });

  it('ended: result with reason', () => {
    render(ws(makePhone({ call: sipCall({ direction: 'outbound', status: 'ended', endReason: 'Busy', remoteIdentity: '1001' }) })));
    expect(host.textContent).toContain('Call not connected');
    expect(host.textContent).toContain('Busy');
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

  it('customer panel: real fields incl. dialled number and live duration; previous calls exclude the current call', async () => {
    callHistory.mockResolvedValue({ data: [
      { call_uuid: 'now', start_time: '2026-11-08T10:30:00Z', queue_name: 'Sales', agent_talk_seconds: 0 },
      { call_uuid: 'a', start_time: '2026-11-01T10:00:00Z', queue_name: 'Sales', agent_talk_seconds: 75 },
    ] });
    await act(async () => render(createElement(CustomerPanel, { interaction: {
      number: '0501234567', name: 'John', direction: 'inbound', queue: 'Sales', dnis: '8001', callUuid: 'now',
      status: 'connected', answeredAt: Date.now() - 42_000,
    } })));
    expect(callHistory).toHaveBeenCalledWith({ search: '501234567', limit: 6 });
    expect(host.textContent).toContain('John');
    expect(host.textContent).toContain('8001');
    expect(q('[aria-label="Customer call duration"]').textContent).toMatch(/^00:4[2-6]$/);
    expect(host.textContent).toContain('01:15');
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.textContent).toContain('No CRM is connected');
  });

  it('customer panel: outbound call shows the dialled number; idle state', () => {
    callHistory.mockResolvedValue({ data: [] });
    render(createElement(CustomerPanel, { interaction: { number: '1001', direction: 'outbound', status: 'ringing-out' } }));
    expect(host.textContent).toMatch(/Dialled number1001/);
    render(createElement(CustomerPanel, { interaction: null }));
    expect(host.textContent).toContain('appear here during a call');
  });

  it('activity strip is one compact line', () => {
    render(createElement(ActivityStrip, { perf: { calls_handled: 4, calls_missed: 1, avg_talk_seconds: 90, total_talk_seconds: 360 } }));
    expect(host.textContent).toMatch(/4handled/);
    expect(host.textContent).toContain('06:00');
  });
});
