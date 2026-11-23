/**
 * Admin portal — Agents page, browser phone setting (CP3, see CONFIGURATION_GUIDE.md §2).
 * The box is shown only when the installation allows WebRTC AND the agent is internal;
 * webrtcEnabled is sent to the backend only in that case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const api = vi.hoisted(() => ({
  telephony: { mode: 'HYBRID', webrtc_available: true },
  agents: [],
  update: vi.fn(async () => ({})),
}));

vi.mock('../../api/client.js', () => ({
  Telephony: { config: vi.fn(async () => api.telephony) },
  Agents: {
    list: vi.fn(async () => api.agents),
    update: api.update,
    create: vi.fn(async () => ({})),
    remove: vi.fn(), setStatus: vi.fn(), setState: vi.fn(), setPin: vi.fn(),
  },
}));
vi.mock('../../api/socket.js', () => ({ useSocketEvent: () => {} }));
vi.mock('../../hooks/useAuth.js', () => ({ useAuth: () => ({ user: { role: 'admin', username: 'admin' } }) }));

const { default: Agents } = await import('../Agents.jsx');

const INTERNAL = {
  agent_id: 'wednesday@default', full_name: 'Wednesday', avaya_extension: '1003',
  agent_type: 'internal', contact: '{sip_cid_type=pid}user/1003@192.168.1.124',
  fs_agent_type: 'callback', webrtc_enabled: false, status: 'Available', state: 'Waiting',
  max_no_answer: 3, wrap_up_time: 20, reject_delay_time: 2, busy_delay_time: 60, no_answer_delay_time: 10,
};
const GATEWAY = {
  ...INTERNAL, agent_id: 'avaya1@default', full_name: 'Avaya One', avaya_extension: '5001',
  agent_type: 'gateway', contact: '{sip_cid_type=pid}sofia/gateway/avaya/5001',
};

let host, root;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function renderPage() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(Agents)); });
  await flush();
}

async function openEdit(agentId) {
  const rows = [...document.querySelectorAll('[aria-label="Edit agent"]')];
  const idx = api.agents.findIndex((a) => a.agent_id === agentId);
  await act(async () => { rows[idx].click(); });
}

const phoneBox = () => [...document.querySelectorAll('label')].find((l) => /Enable browser phone/.test(l.textContent))?.querySelector('input');

async function save() {
  const form = document.getElementById('agent-form');
  await act(async () => { form.requestSubmit(); });
  await flush();
}

beforeEach(() => {
  api.telephony = { mode: 'HYBRID', webrtc_available: true };
  api.agents = [INTERNAL, GATEWAY];
  api.update.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Agents page — browser phone setting', () => {
  it('HYBRID + internal agent: box shown; ticking it sends webrtcEnabled=true', async () => {
    await renderPage();
    await openEdit('wednesday@default');
    const box = phoneBox();
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
    await act(async () => { box.click(); });
    await save();
    expect(api.update).toHaveBeenCalledTimes(1);
    const [id, payload] = api.update.mock.calls[0];
    expect(id).toBe('wednesday@default');
    expect(payload).toMatchObject({ agentType: 'internal', extension: '1003', webrtcEnabled: true });
  });

  it('gateway (Avaya) agent: no box, and webrtcEnabled is never sent', async () => {
    await renderPage();
    await openEdit('avaya1@default');
    expect(phoneBox()).toBeUndefined();
    await save();
    const [, payload] = api.update.mock.calls[0];
    expect(payload).toMatchObject({ agentType: 'gateway', gateway: 'avaya', destination: '5001' });
    expect(payload).not.toHaveProperty('webrtcEnabled');
  });

  it('EXTERNAL_PBX: no box for anyone, and webrtcEnabled is never sent', async () => {
    api.telephony = { mode: 'EXTERNAL_PBX', webrtc_available: false };
    await renderPage();
    await openEdit('wednesday@default');
    expect(phoneBox()).toBeUndefined();
    await save();
    expect(api.update.mock.calls[0][1]).not.toHaveProperty('webrtcEnabled');
  });

  it('telephony mode cannot be loaded: box hidden (safe default)', async () => {
    const { Telephony } = await import('../../api/client.js');
    Telephony.config.mockRejectedValueOnce(new Error('network'));
    await renderPage();
    await openEdit('wednesday@default');
    expect(phoneBox()).toBeUndefined();
  });
});
