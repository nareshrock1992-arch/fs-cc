/**
 * CP3-D — controller hooks into phone presence: Available guard, /me phone_status,
 * logout (agent and admin), admin permission changes.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/phonePresenceControllers.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cfg = vi.hoisted(() => ({
  config: { jwt: { secret: 't' }, fs: { sipDomain: 'pbx.example' }, telephony: { mode: 'HYBRID', ticketTtlMs: 30_000, graceMs: 15_000 } },
}));
const presence = vi.hoisted(() => ({
  phone: 'none',
  getPhoneStatus: vi.fn(() => presence.phone),
  agentLoggedOut: vi.fn(),
  permissionChanged: vi.fn().mockResolvedValue(undefined),
  isTracked: vi.fn(() => true),
}));
vi.mock('../../../config/index.js', () => cfg);
vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: { agentSetStatus: vi.fn(), agentSetParam: vi.fn(), agentAdd: vi.fn() },
  isConnected: vi.fn(() => true),
}));
vi.mock('../../../services/agentSessionService.js', () => ({ handleStatusTransition: vi.fn() }));
vi.mock('../../../services/auditService.js', () => ({ writeAudit: vi.fn().mockResolvedValue(1), staffActor: () => ({ actor: 'a', actorRole: 'admin' }) }));
vi.mock('../../../services/phonePresenceService.js', () => ({ getPhonePresence: () => presence, PHONE_OFFLINE_CODE: 'PHONE_OFFLINE' }));

import { query } from '../../../db/pool.js';
import { cc } from '../../../services/eslService.js';
import { agentSetStatus, agentMe } from '../../../controllers/agentDeskController.js';
import { updateAgent, setAgentStatus } from '../../../controllers/agentsController.js';

const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const internal = { agent_id: 'alice', agent_type: 'internal', webrtc_enabled: true, active: true, contact: '{sip_cid_type=pid}user/1001@pbx.example' };

beforeEach(() => {
  vi.clearAllMocks();
  presence.phone = 'none';
  cfg.config.telephony.mode = 'HYBRID';
  query.mockResolvedValue({ rows: [] });
});

describe('agent desk', () => {
  it('Available is refused (409 PHONE_OFFLINE) while the phone is offline; nothing changes', async () => {
    presence.phone = 'offline';
    const r = res();
    await agentSetStatus({ agentId: 'alice', body: { status: 'Available' } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('PHONE_OFFLINE');
    expect(cc.agentSetStatus).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('Available is allowed during the short grace (temporary interruption) and when online', async () => {
    for (const phone of ['grace', 'online', 'none']) {
      presence.phone = phone;
      const r = res();
      await agentSetStatus({ agentId: 'alice', body: { status: 'Available' } }, r);
      expect(r.statusCode).toBe(200);
    }
  });

  it('agents may still take an ordinary break while the phone is offline', async () => {
    presence.phone = 'offline';
    query.mockResolvedValueOnce({ rows: [{ code: 'COFFEE', name: 'Coffee' }] });
    const r = res();
    await agentSetStatus({ agentId: 'alice', body: { status: 'On Break', break_code: 'COFFEE' } }, r);
    expect(r.statusCode).toBe(200);
  });

  it('PHONE_OFFLINE cannot be chosen manually', async () => {
    const r = res();
    await agentSetStatus({ agentId: 'alice', body: { status: 'On Break', break_code: 'PHONE_OFFLINE' } }, r);
    expect(r.statusCode).toBe(400);
  });

  it('Logged Out forgets presence and closes the relay session', async () => {
    const r = res();
    await agentSetStatus({ agentId: 'alice', body: { status: 'Logged Out' } }, r);
    expect(presence.agentLoggedOut).toHaveBeenCalledWith('alice');
  });

  it('/me reports phone_status separately from status/break', async () => {
    presence.phone = 'offline';
    query.mockResolvedValueOnce({ rows: [{ ...internal, status: 'On Break', break_code: 'PHONE_OFFLINE' }] });
    const r = res();
    await agentMe({ agentId: 'alice' }, r);
    expect(r.body).toMatchObject({ status: 'On Break', break_code: 'PHONE_OFFLINE', phone_status: 'offline', webrtc_allowed: true });
  });

  it('/me reports phone_status "none" for agents without the browser phone', async () => {
    presence.phone = 'offline';
    query.mockResolvedValueOnce({ rows: [{ ...internal, webrtc_enabled: false }] });
    const r = res();
    await agentMe({ agentId: 'alice' }, r);
    expect(r.body.phone_status).toBe('none');
  });
});

describe('admin', () => {
  it('disabling the browser phone notifies presence (allowed=false)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ agent_type: 'internal', webrtc_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ ...internal, webrtc_enabled: false }] });
    await updateAgent({ params: { agentId: 'alice' }, body: { webrtcEnabled: false } }, res());
    expect(presence.permissionChanged).toHaveBeenCalledWith('alice', false);
  });

  it('enabling notifies presence (allowed=true)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ agent_type: 'internal', webrtc_enabled: false }] })
      .mockResolvedValueOnce({ rows: [{ ...internal }] });
    await updateAgent({ params: { agentId: 'alice' }, body: { webrtcEnabled: true } }, res());
    expect(presence.permissionChanged).toHaveBeenCalledWith('alice', true);
  });

  it('deactivating a tracked agent revokes the browser phone', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...internal, active: false }] });
    await updateAgent({ params: { agentId: 'alice' }, body: { active: false } }, res());
    expect(presence.permissionChanged).toHaveBeenCalledWith('alice', false);
  });

  it('unrelated edits do not touch presence', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...internal }] });
    await updateAgent({ params: { agentId: 'alice' }, body: { fullName: 'Alice B' } }, res());
    expect(presence.permissionChanged).not.toHaveBeenCalled();
  });

  it('supervisor forcing Logged Out also closes the phone session', async () => {
    await setAgentStatus({ params: { agentId: 'alice' }, body: { status: 'Logged Out' } }, res());
    expect(presence.agentLoggedOut).toHaveBeenCalledWith('alice');
  });
});

describe('page-reload endpoint', () => {
  it('passes the authenticated agent to presence and reports whether it was granted', async () => {
    presence.expectReload = vi.fn(() => true);
    const { agentWebrtcPageReload } = await import('../../../controllers/agentDeskController.js');
    const r = res();
    await agentWebrtcPageReload({ agentId: 'alice', body: { agentId: 'someone-else' } }, r);
    expect(presence.expectReload).toHaveBeenCalledWith('alice');
    expect(r.body).toEqual({ ok: true, granted: true });
  });
});
