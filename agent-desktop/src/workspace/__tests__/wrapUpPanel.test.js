/**
 * M1 — wrap-up panel: outcome required before "Ready now", notes optional, outcomes
 * limited to what the call's queue offers, reminder when wrap-up time ran out first,
 * earlier calls without an outcome, and no panel during a call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../../api/client.js', () => ({
  api: { wrapups: vi.fn(), saveWrapup: vi.fn(), readyNow: vi.fn() },
}));

const { api } = await import('../../api/client.js');
const { default: WrapUpPanel } = await import('../WrapUpPanel.jsx');

let host; let root;
const q = (sel) => host.querySelector(sel);
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const SUPPORT_OPTIONS = [{ code: 'RESOLVED', name: 'Resolved' }, { code: 'CALLBACK', name: 'Callback needed' }];
const call = (over = {}) => ({
  call_uuid: 'c-1', queue_name: 'support@default', ani: '0501234567', caller_name: 'Customer A',
  answered_at: new Date().toISOString(), ended_at: null, wrapup: null, options: SUPPORT_OPTIONS, ...over,
});

async function renderPanel(props) {
  await act(async () => { root.render(createElement(WrapUpPanel, { agentStatus: 'Available', wrapUpSeconds: 30, ...props })); });
  await flush();
}
// The desk saw a queue call and then its end: In a queue call → Waiting.
async function callEnds(extra = {}) {
  await renderPanel({ agentState: 'In a queue call', ...extra });
  await renderPanel({ agentState: 'Waiting', ...extra });
}

function setSelect(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function setText(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('wrap-up panel', () => {
  it('is hidden during a call', async () => {
    api.wrapups.mockResolvedValue({ calls: [call()] });
    await renderPanel({ agentState: 'In a queue call' });
    expect(q('[aria-label="Wrap-up"]')).toBeNull();
  });

  it('after a call: outcome required, only the queue\'s outcomes, no Ready now until saved', async () => {
    api.wrapups.mockResolvedValue({ calls: [call()] });
    await callEnds();
    expect(q('[aria-label="Wrap-up"]')).not.toBeNull();
    const opts = [...q('#wrapup-outcome').options].map((o) => o.value);
    expect(opts).toEqual(['', 'RESOLVED', 'CALLBACK']);
    expect(button('Ready now')).toBeUndefined();
    // Saving without an outcome is refused in the panel; nothing is sent.
    await act(async () => { button('Save outcome').click(); });
    expect(api.saveWrapup).not.toHaveBeenCalled();
    expect(q('[role="alert"]').textContent).toContain('Choose an outcome');
    expect(q('[aria-label="Wrap-up time left"]')).not.toBeNull();
  });

  it('saves outcome + optional notes, then Ready now ends wrap-up and hides the panel', async () => {
    api.wrapups.mockResolvedValueOnce({ calls: [call()] }).mockResolvedValueOnce({ calls: [call()] });
    await callEnds();
    api.wrapups.mockResolvedValue({ calls: [call({ wrapup: { code: 'CALLBACK', name: 'Callback needed', notes: 'wants a call at 5', source: 'agent' } })] });
    api.saveWrapup.mockResolvedValue({});
    api.readyNow.mockResolvedValue({ ready: true });
    await act(async () => { setSelect(q('#wrapup-outcome'), 'CALLBACK'); });
    await act(async () => { setText(q('#wrapup-notes'), '  wants a call at 5 '); });
    await act(async () => { button('Save outcome').click(); });
    await flush();
    expect(api.saveWrapup).toHaveBeenCalledWith('c-1', 'CALLBACK', 'wants a call at 5');
    expect(q('[aria-label="Wrap-up"]').textContent).toContain('Callback needed');
    await act(async () => { button('Ready now').click(); });
    await flush();
    expect(api.readyNow).toHaveBeenCalledTimes(1);
    expect(q('[aria-label="Wrap-up"]')).toBeNull();
  });

  it('notes are optional', async () => {
    api.wrapups.mockResolvedValue({ calls: [call()] });
    api.saveWrapup.mockResolvedValue({});
    await callEnds();
    await act(async () => { setSelect(q('#wrapup-outcome'), 'RESOLVED'); });
    await act(async () => { button('Save outcome').click(); });
    expect(api.saveWrapup).toHaveBeenCalledWith('c-1', 'RESOLVED', '');
  });

  it('shows the server refusal of Ready now', async () => {
    api.wrapups.mockResolvedValue({ calls: [call({ wrapup: { code: 'RESOLVED', name: 'Resolved', source: 'agent' } })] });
    api.readyNow.mockRejectedValue(Object.assign(new Error('Save the call outcome first'), { status: 409 }));
    await callEnds();
    await act(async () => { button('Ready now').click(); });
    await flush();
    expect(q('[role="alert"]').textContent).toContain('Save the call outcome first');
    expect(q('[aria-label="Wrap-up"]')).not.toBeNull();
  });

  it('when wrap-up time ran out first: still requires the outcome, no Ready now', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.wrapups.mockResolvedValue({ calls: [call()] });
    await callEnds({ wrapUpSeconds: 5 });
    await act(async () => { vi.advanceTimersByTime(6_000); });
    expect(q('[aria-label="Wrap-up"]').textContent).toContain('Wrap-up time is over');
    expect(q('#wrapup-outcome')).not.toBeNull();
    expect(button('Ready now')).toBeUndefined();
  });

  it('after a page reload, an older call without an outcome is still offered', async () => {
    api.wrapups.mockResolvedValue({ calls: [call({ ended_at: new Date(Date.now() - 3_600_000).toISOString() })] });
    await renderPanel({ agentState: 'Waiting' });
    expect(q('[aria-label="Wrap-up"]')).not.toBeNull();
    expect(q('#wrapup-outcome')).not.toBeNull();
    expect(button('Ready now')).toBeUndefined();
  });

  it('lists earlier calls without an outcome and lets the agent pick one (queue-specific options)', async () => {
    const billing = call({ call_uuid: 'c-0', queue_name: 'billing@default', caller_name: 'Customer B',
      ended_at: new Date(Date.now() - 600_000).toISOString(), options: [{ code: 'PAID', name: 'Payment taken' }] });
    api.wrapups.mockResolvedValue({ calls: [call(), billing] });
    await callEnds();
    expect(q('[aria-label="Wrap-up"]').textContent).toContain('1 earlier call needs an outcome');
    const link = [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Customer B'));
    await act(async () => { link.click(); });
    expect([...q('#wrapup-outcome').options].map((o) => o.value)).toEqual(['', 'PAID']);
  });

  it('a system outcome (phone dropped) can be replaced by the agent', async () => {
    api.wrapups.mockResolvedValue({ calls: [call({ ended_at: new Date().toISOString(),
      wrapup: { code: 'SYSTEM_DISCONNECTED', name: 'Disconnected unexpectedly', source: 'system' } })] });
    await callEnds();
    expect(q('[aria-label="Wrap-up"]').textContent).toContain('by the system');
    expect(q('#wrapup-outcome')).not.toBeNull();
  });

  it('nothing to show when every recent call has an outcome and wrap-up is over', async () => {
    api.wrapups.mockResolvedValue({ calls: [call({ ended_at: new Date(Date.now() - 120_000).toISOString(),
      wrapup: { code: 'RESOLVED', name: 'Resolved', source: 'agent' } })] });
    await renderPanel({ agentState: 'Waiting' });
    expect(q('[aria-label="Wrap-up"]')).toBeNull();
  });
});

describe('call history outcome text', () => {
  it('saved outcome, system outcome, "Not set" for answered queue calls, dash otherwise', async () => {
    const { outcomeText } = await import('../../components/CallHistory.jsx');
    expect(outcomeText({ outcome_name: 'Resolved', outcome_source: 'agent' })).toBe('Resolved');
    expect(outcomeText({ outcome_name: 'Disconnected unexpectedly', outcome_source: 'system' })).toBe('Disconnected unexpectedly (system)');
    expect(outcomeText({ queue_name: 'support@default', agent_answer_time: 't', missed: false })).toBe('Not set');
    expect(outcomeText({ queue_name: 'support@default', agent_answer_time: null, missed: true })).toBe('—');
    expect(outcomeText({ direction: 'outbound', queue_name: null })).toBe('—');
  });
});
