/**
 * CP3-E — Agent Desktop integration of the browser phone with customer modes,
 * CP3-D phone presence and the agent lifecycle. Presentation level (Desk); the
 * phone object is a fake with the real usePhone() shape. Controlled clocks where
 * timing matters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { LayoutDashboard, ListOrdered } from 'lucide-react';

vi.mock('../../api/client.js', () => ({
  api: { callHistory: vi.fn(async () => ({ data: [] })), breakHistory: vi.fn(async () => ({ data: [] })), setStatus: vi.fn(),
         wrapups: vi.fn(async () => ({ calls: [] })), saveWrapup: vi.fn(), readyNow: vi.fn() },
}));

const { default: Desk } = await import('../Desk.jsx');

let host; let root;
const render = (el) => act(() => root.render(el));
const q = (sel) => host.querySelector(sel);
const buttons = (text) => [...host.querySelectorAll('button')].filter((b) => b.textContent.trim().startsWith(text));

const NAV = [{ key: 'dashboard', label: 'Workspace', Icon: LayoutDashboard }, { key: 'queues', label: 'Queues', Icon: ListOrdered }];
const THEME = { isDark: false, toggle: () => {} };

function makePhone(state = {}) {
  const p = {};
  for (const m of ['answer', 'reject', 'hangup', 'toggleMute', 'toggleHold', 'sendDtmf', 'refreshDevices', 'clearError', 'login', 'dial']) p[m] = vi.fn();
  p.logout = vi.fn(async () => {});
  return {
    ...p,
    configError: null,
    eligibility: { eligible: true, extension: '1000' },
    indicator: { level: 'ok', label: 'Phone ready' },
    state: { account: { extension: '1000' }, connection: 'connected', registration: 'registered', devices: { inputs: [], outputs: [], selectedInput: '', selectedOutput: '', sinkSupported: false }, ...state },
  };
}
const ringing = { id: 's1', direction: 'inbound', remoteIdentity: '0501234567 <0501234567>', status: 'ringing-in', muted: false, held: false };
const talking = { ...ringing, status: 'active', answeredAt: new Date().toISOString() };

function desk({ phone = null, agent = {}, data = {}, actions = {} } = {}) {
  return createElement(Desk, {
    phone, theme: THEME, nav: NAV,
    data: {
      agent: { agent_id: 'alice', full_name: 'Alice', status: 'Available', contact: '{sip_cid_type=pid}user/1000@pbx.example', ...agent },
      agentStatus: agent.status || 'Available', view: 'dashboard', queues: [], perf: null, perfLoading: false, callState: null,
      apiOk: true, socketUp: true, eslConn: true, breakCodes: [], currentBreakCfg: null, toast: null,
      recentCalls: [], recentLoading: false, dialRequest: null, ...data,
    },
    actions: { setView: vi.fn(), setToast: vi.fn(), setDialRequest: vi.fn(), onLogout: vi.fn(), onStatusChange: vi.fn(), onReturnFromBreak: vi.fn(), onPhoneDisabled: vi.fn(), ...actions },
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('customer modes', () => {
  it('EXTERNAL_PBX / desk-phone agent: no browser phone anywhere, no phone warnings', () => {
    render(desk({ data: { webrtcAllowed: false } }));
    expect(q('[data-phone]')).toBeNull();                  // no phone pill
    expect(q('section[aria-label="Phone"]')).toBeNull();   // no dial pad / console
    expect(host.textContent).not.toMatch(/Phone signed out|Phone offline|not registered/);
  });

  it('gateway agent (HYBRID): same as desk phone — nothing phone-related, Available not blocked', () => {
    render(desk({ agent: { contact: 'sofia/gateway/gw/0501', status: 'On Break' }, data: { webrtcAllowed: false } }));
    act(() => q('button[aria-haspopup="menu"]').click());
    const available = [...host.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes('Available'));
    expect(available.disabled).toBe(false);
  });

  it('HYBRID / FREESWITCH_WEBRTC allowed agent: phone pill + console', () => {
    render(desk({ phone: makePhone(), data: { webrtcAllowed: true, serverPhone: 'online' } }));
    expect(q('[data-phone]').getAttribute('data-phone')).toBe('registered');
    expect(q('[data-phone]').textContent).toContain('Phone ready');
    expect(q('section[aria-label="Phone"]')).not.toBeNull();
  });
});

describe('phone state is shown separately from agent state', () => {
  it.each([
    ['connecting', { connection: 'connecting', registration: 'unregistered' }, 'none', 'Phone connecting'],
    ['reconnecting', { connection: 'reconnecting', registration: 'unregistered' }, 'grace', 'Phone reconnecting'],
    ['offline', { account: undefined, connection: 'disconnected', registration: 'unregistered' }, 'offline', 'Phone offline'],
    ['signed out', { account: undefined, connection: 'disconnected', registration: 'unregistered' }, 'none', 'Phone signed out'],
  ])('%s', (_n, state, server, label) => {
    render(desk({ phone: makePhone(state), agent: { status: 'On Break', break_name: 'Coffee Break' }, data: { webrtcAllowed: true, serverPhone: server } }));
    expect(q('[data-phone]').textContent).toContain(label);
    // agent status selector keeps showing the agent's own status
    expect(q('button[aria-haspopup="menu"]').textContent).toContain('On Break · Coffee Break');
  });
});

describe('PHONE_OFFLINE rules', () => {
  function openMenu() { act(() => q('button[aria-haspopup="menu"]').click()); }
  const availableItem = () => [...host.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes('Available'));

  it('Available is disabled with the reason while the phone is offline', () => {
    render(desk({ phone: makePhone({ account: undefined, registration: 'unregistered', connection: 'disconnected' }),
      agent: { status: 'On Break', break_code: 'PHONE_OFFLINE', break_name: 'Phone offline' }, data: { webrtcAllowed: true, serverPhone: 'offline' } }));
    openMenu();
    expect(availableItem().disabled).toBe(true);
    expect(host.textContent).toContain('Your browser phone is offline');
  });

  it('PHONE_OFFLINE is never offered as a break the agent can choose', () => {
    render(desk({ phone: makePhone(), agent: { status: 'Available' },
      data: { webrtcAllowed: true, serverPhone: 'online', breakCodes: [{ code: 'COFFEE', name: 'Coffee Break' }] } }));
    openMenu();
    const items = [...host.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
    expect(items.some((t) => /Phone offline/.test(t))).toBe(false);
  });

  it('phone recovered while on PHONE_OFFLINE: prompt only, agent stays on break until they choose', () => {
    const onReturnFromBreak = vi.fn();
    render(desk({ phone: makePhone(), agent: { status: 'On Break', break_code: 'PHONE_OFFLINE', break_name: 'Phone offline' },
      data: { webrtcAllowed: true, serverPhone: 'online' }, actions: { onReturnFromBreak } }));
    expect(q('[aria-label="Phone reconnected"]')).not.toBeNull();
    expect(onReturnFromBreak).not.toHaveBeenCalled();
    act(() => buttons('Set Available')[0].click());
    expect(onReturnFromBreak).toHaveBeenCalledTimes(1);
  });

  it('short interruption (reconnecting) does not block Available', () => {
    render(desk({ phone: makePhone({ connection: 'reconnecting', registration: 'unregistered' }), agent: { status: 'On Break' },
      data: { webrtcAllowed: true, serverPhone: 'grace' } }));
    act(() => q('button[aria-haspopup="menu"]').click());
    expect(availableItem().disabled).toBe(false);
  });
});

describe('supervisor turns the browser phone off', () => {
  it('during a call: notice says the call continues; phone signs out only after the call ends', async () => {
    const onPhoneDisabled = vi.fn();
    const phone = makePhone({ call: talking });
    render(desk({ phone, data: { webrtcAllowed: true, serverPhone: 'online', webrtcRevoked: true }, actions: { onPhoneDisabled } }));
    expect(host.textContent).toContain('It will sign out when this call ends');
    expect(phone.logout).not.toHaveBeenCalled();
    // the agent keeps the call controls until the call is over
    expect(q('section[aria-label="Phone"]')).not.toBeNull();
    expect(buttons('End call')).toHaveLength(1);
    const ended = { ...phone, state: { ...phone.state, call: undefined } };
    await act(async () => { root.render(desk({ phone: ended, data: { webrtcAllowed: true, serverPhone: 'online', webrtcRevoked: true }, actions: { onPhoneDisabled } })); });
    expect(phone.logout).toHaveBeenCalledTimes(1);
    expect(onPhoneDisabled).toHaveBeenCalledTimes(1);
  });

  it('when idle: phone signs out at once and the console is hidden', async () => {
    const onPhoneDisabled = vi.fn();
    const phone = makePhone();
    await act(async () => { root.render(desk({ phone, data: { webrtcAllowed: true, webrtcRevoked: true }, actions: { onPhoneDisabled } })); });
    expect(phone.logout).toHaveBeenCalled();
    expect(onPhoneDisabled).toHaveBeenCalled();
    expect(q('section[aria-label="Phone"]')).toBeNull();
  });
});

describe('incoming call notification', () => {
  it('on another page: one alert with Answer (focused) and Reject; no duplicate buttons', () => {
    const phone = makePhone({ call: ringing });
    render(desk({ phone, data: { webrtcAllowed: true, serverPhone: 'online', view: 'queues' } }));
    const dlg = q('[role="alertdialog"]');
    expect(dlg).not.toBeNull();
    expect(dlg.textContent).toContain('0501234567');
    expect(buttons('Answer')).toHaveLength(1);
    expect(document.activeElement.textContent).toContain('Answer');
    act(() => buttons('Answer')[0].click());
    expect(phone.answer).toHaveBeenCalledTimes(1);
    act(() => buttons('Reject')[0].click());
    expect(phone.reject).toHaveBeenCalledTimes(1);
  });

  it('not shown for agents without the browser phone', () => {
    render(desk({ data: { webrtcAllowed: false, view: 'queues', callState: { phase: 'ringing', callUuid: 'u1', ani: '0501' } } }));
    expect(q('[role="alertdialog"]')).toBeNull();
  });

  it('active call: in-call controls (mute, hold, transfer, conference) are real engine actions', () => {
    const phone = makePhone({ call: talking });
    render(desk({ phone, data: { webrtcAllowed: true, serverPhone: 'online' } }));
    const toolbar = q('[role="toolbar"][aria-label="Call controls"]');
    const tile = (l) => [...toolbar.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === l);
    act(() => tile('Mute').click());
    act(() => tile('Hold').click());
    expect(phone.toggleMute).toHaveBeenCalled();
    expect(phone.toggleHold).toHaveBeenCalled();
    expect(tile('Transfer').disabled).toBe(false);
    expect(tile('Conference').disabled).toBe(false);
  });
});

describe('wrap-up on the desk (M1: follows the latest answered call, not an Idle state)', () => {
  it('after a queue call ends (state returns to Waiting) the desk shows the outcome form', async () => {
    const { api } = await import('../../api/client.js');
    api.wrapups.mockResolvedValue({ calls: [{ call_uuid: 'c-1', queue_name: 'support@default', ani: '0501234567',
      caller_name: null, ended_at: null, wrapup: null, options: [{ code: 'RESOLVED', name: 'Resolved' }] }] });
    const base = { phone: makePhone(), data: { webrtcAllowed: true, serverPhone: 'online', wrapUpSeconds: 20 } };
    await act(async () => { root.render(desk({ ...base, agent: { status: 'Available', state: 'In a queue call' } })); });
    expect(q('[aria-label="Wrap-up"]')).toBeNull();
    await act(async () => { root.render(desk({ ...base, agent: { status: 'Available', state: 'Waiting' } })); });
    await act(async () => { await Promise.resolve(); });
    expect(q('[aria-label="Wrap-up"]')).not.toBeNull();
    expect(q('#wrapup-outcome')).not.toBeNull();
    api.wrapups.mockResolvedValue({ calls: [] });
  });

  it('no wrap-up panel right after login when there is no call to wrap up', async () => {
    await act(async () => { root.render(desk({ phone: makePhone(), agent: { status: 'Available', state: 'Waiting' }, data: { webrtcAllowed: true, wrapUpSeconds: 20 } })); });
    expect(q('[aria-label="Wrap-up"]')).toBeNull();
  });
});

describe('one phone status, calm during short interruptions', () => {
  it('reconnecting while Available: no "Not reachable" alarm; console and top bar agree', () => {
    render(desk({ phone: makePhone({ connection: 'reconnecting', registration: 'unregistered' }), agent: { status: 'Available' },
      data: { webrtcAllowed: true, serverPhone: 'grace' } }));
    expect(host.textContent).not.toContain('Not reachable');
    expect(q('[data-phone]').textContent).toContain('Phone reconnecting');
    expect(q('[aria-label="Phone status"]').textContent).toContain('Phone reconnecting');
  });

  it('signed out (or offline) while Available: the "Not reachable" warning is shown', () => {
    render(desk({ phone: makePhone({ account: undefined, connection: 'disconnected', registration: 'unregistered' }), agent: { status: 'Available' },
      data: { webrtcAllowed: true, serverPhone: 'none' } }));
    expect(host.textContent).toContain('Not reachable');
  });
});

describe('break panel respects the phone', () => {
  it('"Return to Available" is disabled with the reason while the phone is offline', () => {
    render(desk({ phone: makePhone({ account: undefined, connection: 'disconnected', registration: 'unregistered' }),
      agent: { status: 'On Break', break_code: 'PHONE_OFFLINE', break_name: 'Phone offline', break_started_at: new Date().toISOString() },
      data: { webrtcAllowed: true, serverPhone: 'offline' } }));
    const btn = buttons('Return to Available')[0];
    expect(btn.disabled).toBe(true);
    expect(q('#return-blocked-reason').textContent).toMatch(/offline/);
  });
  it('desk-phone agent: break panel unchanged (return allowed)', () => {
    render(desk({ agent: { status: 'On Break', break_code: 'COFFEE', break_name: 'Coffee', break_started_at: new Date().toISOString() }, data: { webrtcAllowed: false } }));
    expect(buttons('Return to Available')[0].disabled).toBe(false);
  });
});
