import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const setStatus = vi.fn();
vi.mock('../../api/client.js', () => ({ api: { setStatus: (...a) => setStatus(...a) } }));

const { buildLamps, overallHealth, default: ConnectionLamps } = await import('../ConnectionLamps.jsx');
const { default: StatusSelector, statusLevel } = await import('../StatusSelector.jsx');
const { default: AppShell } = await import('../AppShell.jsx');

let host;
let root;
const render = (el) => act(() => root.render(el));
const q = (sel) => host.querySelector(sel);
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setStatus.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('buildLamps', () => {
  it('keeps server, live, SIP engine and phone separate', () => {
    const lamps = buildLamps({
      apiOk: true, socketConnected: true, eslConnected: true,
      phone: { level: 'error', label: 'Phone sign-in failed' },
    });
    expect(lamps.map((l) => [l.key, l.level])).toEqual([
      ['api', 'ok'], ['live', 'ok'], ['fs', 'ok'], ['phone', 'error'],
    ]);
  });

  it('reports failures and the unknown first state; no phone lamp when phone is disabled', () => {
    const lamps = buildLamps({ apiOk: null, socketConnected: false, eslConnected: false, phone: null });
    expect(lamps.map((l) => l.level)).toEqual(['warn', 'error', 'error']);
    expect(lamps.find((l) => l.key === 'phone')).toBeUndefined();
    expect(buildLamps({ apiOk: false, socketConnected: true, eslConnected: true })[0].level).toBe('error');
  });

  it('names the call engine "SIP engine", not FreeSWITCH', () => {
    const lamps = buildLamps({ apiOk: true, socketConnected: true, eslConnected: false });
    expect(lamps.find((l) => l.key === 'fs')).toMatchObject({ label: 'SIP engine', level: 'error' });
    expect(JSON.stringify(lamps)).not.toMatch(/FreeSWITCH/);
  });

  it('overall health is the worst component: phone off is never Healthy', () => {
    const ok = buildLamps({ apiOk: true, socketConnected: true, eslConnected: true, phone: { level: 'ok', label: 'Phone ready' } });
    expect(overallHealth(ok)).toEqual({ level: 'ok', label: 'Healthy' });
    expect(overallHealth(buildLamps({ apiOk: true, socketConnected: true, eslConnected: true, phone: { level: 'off', label: 'Phone off' } })).label).toBe('Warning');
    expect(overallHealth(buildLamps({ apiOk: true, socketConnected: true, eslConnected: false })).label).toBe('Unhealthy');
  });

  it('one badge; clicking it lists every component with its detail', () => {
    render(createElement(ConnectionLamps, {
      lamps: buildLamps({ apiOk: true, socketConnected: false, eslConnected: true, phone: { level: 'off', label: 'Phone off' } }),
    }));
    const btn = host.querySelector('button[aria-haspopup="dialog"]');
    expect(btn.textContent).toContain('Unhealthy');
    expect(btn.textContent).toContain('Live updates');
    expect(host.querySelectorAll('li')).toHaveLength(0);
    act(() => btn.click());
    expect(host.querySelectorAll('li')).toHaveLength(4);
    expect(host.textContent).toContain('Live updates disconnected');
    expect(host.textContent).toContain('Phone off');
  });
});

describe('StatusSelector', () => {
  const codes = [{ code: 'LUNCH', name: 'Lunch', max_duration_seconds: 1800 }, { code: 'TRN', name: 'Training' }];
  const props = (extra = {}) => ({
    currentStatus: 'Available', breakCodes: codes, onStatusChange: vi.fn(), onError: vi.fn(), ...extra,
  });

  it('maps statuses to levels', () => {
    expect(statusLevel('Available')).toBe('ok');
    expect(statusLevel('On Break')).toBe('break');
    expect(statusLevel('Logged Out')).toBe('off');
  });

  it('shows current status and offers only backend statuses + configured breaks', () => {
    render(createElement(StatusSelector, props()));
    act(() => q('button[aria-haspopup="menu"]').click());
    const items = [...host.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim());
    expect(items).toEqual(['Available', 'Lunch30m', 'Training', 'Log out of queues']);
    expect(host.textContent).not.toMatch(/Busy|After Call Work/);
    expect(q('[role="menuitem"]').disabled).toBe(true); // "Available" item: already Available
  });

  it('posts a break with its code and reports the new status', async () => {
    setStatus.mockResolvedValue({ status: 'On Break' });
    const p = props();
    render(createElement(StatusSelector, p));
    act(() => q('button[aria-haspopup="menu"]').click());
    await act(async () => button('Lunch').click());
    expect(setStatus).toHaveBeenCalledWith('On Break', 'LUNCH');
    expect(p.onStatusChange).toHaveBeenCalledWith('On Break');
  });

  it('Available is sent without a break code; errors go to onError', async () => {
    setStatus.mockRejectedValue(new Error('ESL down'));
    const p = props({ currentStatus: 'On Break', breakName: 'Lunch' });
    render(createElement(StatusSelector, p));
    expect(host.textContent).toContain('On Break · Lunch');
    act(() => q('button[aria-haspopup="menu"]').click());
    await act(async () => q('[role="menuitem"]').click());
    expect(setStatus).toHaveBeenCalledWith('Available', undefined);
    expect(p.onError).toHaveBeenCalledWith('ESL down');
    expect(p.onStatusChange).not.toHaveBeenCalled();
  });

  it('Log out posts Logged Out', async () => {
    setStatus.mockResolvedValue({ status: 'Logged Out' });
    const p = props();
    render(createElement(StatusSelector, p));
    act(() => q('button[aria-haspopup="menu"]').click());
    await act(async () => button('Log out of queues').click());
    expect(setStatus).toHaveBeenCalledWith('Logged Out', undefined);
    expect(p.onStatusChange).toHaveBeenCalledWith('Logged Out');
  });
});

describe('AppShell', () => {
  const Icon = () => null;
  const nav = [
    { key: 'dashboard', label: 'Workspace', Icon },
    { key: 'calls', label: 'Calls', Icon },
  ];

  it('shows identity, extension, queues and navigates', () => {
    const onNavigate = vi.fn();
    const onLogout = vi.fn();
    render(createElement(AppShell, {
      agent: { full_name: 'Agent One', agent_id: 'a1', avaya_extension: '1000' },
      queueNames: ['Sales', 'Support'],
      lamps: [],
      theme: { isDark: false, toggle: vi.fn() },
      onLogout, nav, activeView: 'dashboard', onNavigate,
      statusSelector: createElement('span', null, 'STATUS'),
    }, createElement('p', null, 'BODY')));
    expect(host.textContent).toContain('Agent One');
    expect(host.textContent).toContain('Ext 1000');
    expect(host.textContent).toContain('Sales, Support');
    expect(host.textContent).toContain('BODY');
    expect(button('Workspace').getAttribute('aria-current')).toBe('page');
    act(() => button('Calls').click());
    expect(onNavigate).toHaveBeenCalledWith('calls');
    act(() => q('button[aria-label="Sign out of Agent Desktop"]').click());
    expect(onLogout).toHaveBeenCalled();
  });
});
