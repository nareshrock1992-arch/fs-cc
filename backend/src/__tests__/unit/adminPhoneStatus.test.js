// Owner 2026-11-25: show "browser phone registered or not" next to Available / Break in the
// admin portal (Agents page and live views). Both agent lists carry phone_status.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cfg = vi.hoisted(() => ({ config: { telephony: { mode: 'HYBRID' }, fs: {}, jwt: { secret: 't' } } }));
vi.mock('../../../config/index.js', () => cfg);
let ROWS = [];
vi.mock('../../../db/pool.js', () => ({ query: vi.fn(async () => ({ rows: ROWS })), pool: {}, warmPool: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({ isConnected: () => true, cc: {} }));

const presenceMod = await import('../../../services/phonePresenceService.js');
const { phoneStatusOf, setPhonePresence } = presenceMod;
const stats = await import('../../../controllers/statsController.js');
const agentsCtrl = await import('../../../controllers/agentsController.js');

const browser = { agent_id: 'wednesday@default', agent_type: 'internal', webrtc_enabled: true, active: true, contact: '{sip_cid_type=pid}user/1003@pbx' };
const desk    = { agent_id: 'sunday@default',    agent_type: 'internal', webrtc_enabled: false, active: true, contact: '{sip_cid_type=pid}user/1001@pbx' };
const gateway = { agent_id: 'avaya@default',     agent_type: 'gateway',  webrtc_enabled: false, active: true, contact: 'sofia/gateway/avaya/5001' };
const status = { 'wednesday@default': 'online' };
const presence = { getPhoneStatus: (id) => status[id] ?? 'none' };

function res() { const r = {}; r.status = vi.fn(() => r); r.json = vi.fn((b) => { r.body = b; return r; }); return r; }

beforeEach(() => { cfg.config.telephony.mode = 'HYBRID'; setPhonePresence(presence); status['wednesday@default'] = 'online'; });

describe('phoneStatusOf', () => {
  it('browser-phone agent → live phone state', () => {
    expect(phoneStatusOf(browser, 'HYBRID', presence)).toBe('online');
    for (const s of ['grace', 'offline']) { status['wednesday@default'] = s; expect(phoneStatusOf(browser, 'HYBRID', presence)).toBe(s); }
  });
  it('browser-phone agent never signed in → none', () => {
    expect(phoneStatusOf({ ...browser, agent_id: 'new@default' }, 'HYBRID', presence)).toBe('none');
    expect(phoneStatusOf(browser, 'HYBRID', null)).toBe('none');
  });
  it('desk phone, gateway agent, inactive agent or mode without browser phones → null (show nothing)', () => {
    expect(phoneStatusOf(desk, 'HYBRID', presence)).toBeNull();
    expect(phoneStatusOf(gateway, 'HYBRID', presence)).toBeNull();
    expect(phoneStatusOf({ ...browser, active: false }, 'HYBRID', presence)).toBeNull();
    expect(phoneStatusOf(browser, 'EXTERNAL_PBX', presence)).toBeNull();
  });
});

describe('agent lists carry phone_status', () => {
  it('GET /api/stats/live-agents: phone_status per agent; helper fields never sent', async () => {
    ROWS = [
      { agent_id: browser.agent_id, status: 'Available', operational_state: 'Idle', _agent_type: 'internal', _webrtc_enabled: true, _contact: browser.contact },
      { agent_id: desk.agent_id, status: 'On Break', operational_state: 'On Break', _agent_type: 'internal', _webrtc_enabled: false, _contact: desk.contact },
    ];
    const r = res();
    await stats.getLiveAgents({}, r);
    const [w, s] = r.body.agents;
    expect(w.phone_status).toBe('online');
    expect(s.phone_status).toBeNull();
    for (const a of r.body.agents) {
      expect(a).not.toHaveProperty('_contact');
      expect(a).not.toHaveProperty('_agent_type');
      expect(a).not.toHaveProperty('_webrtc_enabled');
    }
  });

  it('GET /api/agents: phone_status per agent', async () => {
    status['wednesday@default'] = 'offline';
    ROWS = [{ ...browser }, { ...desk }];
    const r = res();
    await agentsCtrl.listAgents({}, r);
    expect(r.json.mock.calls[0][0].map((a) => [a.agent_id, a.phone_status]))
      .toEqual([['wednesday@default', 'offline'], ['sunday@default', null]]);
  });

  it('mode without browser phones → every agent null', async () => {
    cfg.config.telephony.mode = 'EXTERNAL_PBX';
    ROWS = [{ ...browser }];
    const r = res();
    await agentsCtrl.listAgents({}, r);
    expect(r.json.mock.calls[0][0][0].phone_status).toBeNull();
  });
});
