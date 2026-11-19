/**
 * CP3-B — admin per-agent browser-phone setting and the PHONE_OFFLINE guard.
 * Scenarios 2, 6, 14.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/webrtcAdminSettings.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cfg = vi.hoisted(() => ({
  config: { fs: { sipDomain: 'pbx.example' }, telephony: { mode: 'EXTERNAL_PBX' } },
}));
vi.mock('../../../config/index.js', () => cfg);
vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: { agentAdd: vi.fn(), agentSetParam: vi.fn(), agentSetStatus: vi.fn() },
  isConnected: vi.fn(() => true),
}));
vi.mock('../../../services/agentSessionService.js', () => ({ handleStatusTransition: vi.fn() }));
vi.mock('../../../services/auditService.js', () => ({
  writeAudit: vi.fn().mockResolvedValue(1),
  staffActor: vi.fn(() => ({ actor: 'admin@x', actorRole: 'admin' })),
}));

import { query } from '../../../db/pool.js';
import { writeAudit } from '../../../services/auditService.js';
import { createAgent, updateAgent, validateWebrtcSetting } from '../../../controllers/agentsController.js';
import { updateBreakCode, setBreakCodeStatus } from '../../../controllers/breakCodesController.js';

function makeRes() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const newInternal = { agentId: 'carol', fullName: 'Carol', avayaExtension: '2001', agentType: 'internal', extension: '1003' };

beforeEach(() => {
  vi.clearAllMocks();
  cfg.config.telephony.mode = 'EXTERNAL_PBX';
  query.mockResolvedValue({ rows: [{ agent_id: 'carol' }] });
});

describe('validateWebrtcSetting', () => {
  it('false / omitted is always accepted', () => {
    expect(validateWebrtcSetting({ webrtcEnabled: false, agentType: 'gateway', mode: 'EXTERNAL_PBX' })).toBeNull();
    expect(validateWebrtcSetting({ agentType: 'internal', mode: 'EXTERNAL_PBX' })).toBeNull();
  });
  it('true is refused in EXTERNAL_PBX (scenario 2) and for gateway agents (scenario 6)', () => {
    expect(validateWebrtcSetting({ webrtcEnabled: true, agentType: 'internal', mode: 'EXTERNAL_PBX' })).toMatch(/EXTERNAL_PBX/);
    expect(validateWebrtcSetting({ webrtcEnabled: true, agentType: 'gateway', mode: 'HYBRID' })).toMatch(/gateway/);
  });
  it('non-boolean is refused', () => {
    expect(validateWebrtcSetting({ webrtcEnabled: 'yes', agentType: 'internal', mode: 'HYBRID' })).toMatch(/boolean/);
  });
  it('true for internal agent in a WebRTC mode is accepted', () => {
    expect(validateWebrtcSetting({ webrtcEnabled: true, agentType: 'internal', mode: 'HYBRID' })).toBeNull();
  });
});

describe('createAgent', () => {
  it('EXTERNAL_PBX: enabling the browser phone is refused with 400, nothing inserted', async () => {
    const res = makeRes();
    await createAgent({ body: { ...newInternal, webrtcEnabled: true } }, res);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it('default (no field) stores webrtc_enabled=false — unchanged behaviour', async () => {
    const res = makeRes();
    await createAgent({ body: newInternal }, res);
    expect(res.statusCode).toBe(201);
    const params = query.mock.calls[0][1];
    expect(params[params.length - 1]).toBe(false);
  });
  it('HYBRID: internal agent can be created enabled', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    const res = makeRes();
    await createAgent({ body: { ...newInternal, webrtcEnabled: true } }, res);
    expect(res.statusCode).toBe(201);
    const params = query.mock.calls[0][1];
    expect(params[params.length - 1]).toBe(true);
  });
  it('HYBRID: gateway agent cannot be created enabled', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    const res = makeRes();
    await createAgent({ body: { agentId: 'g', fullName: 'G', avayaExtension: '3', agentType: 'gateway', gateway: 'sp', destination: '05', webrtcEnabled: true } }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('updateAgent', () => {
  it('HYBRID: enabling an internal agent updates the flag and writes an audit entry', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    query
      .mockResolvedValueOnce({ rows: [{ agent_type: 'internal', webrtc_enabled: false }] }) // current
      .mockResolvedValueOnce({ rows: [{ agent_id: 'carol', webrtc_enabled: true }] });     // UPDATE
    const res = makeRes();
    await updateAgent({ params: { agentId: 'carol' }, body: { webrtcEnabled: true } }, res);
    const updateParams = query.mock.calls[1][1];
    expect(updateParams[updateParams.length - 1]).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'AGENT_WEBRTC_CHANGED', entityId: 'carol',
      oldValue: { webrtc_enabled: false }, newValue: { webrtc_enabled: true },
    }));
  });
  it('EXTERNAL_PBX: enabling is refused (customer mode wins)', async () => {
    query.mockResolvedValueOnce({ rows: [{ agent_type: 'internal', webrtc_enabled: false }] });
    const res = makeRes();
    await updateAgent({ params: { agentId: 'carol' }, body: { webrtcEnabled: true } }, res);
    expect(res.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('switching an agent to gateway always turns the browser phone off', async () => {
    cfg.config.telephony.mode = 'HYBRID';
    query
      .mockResolvedValueOnce({ rows: [{ agent_type: 'internal', webrtc_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ agent_id: 'carol' }] });
    const res = makeRes();
    await updateAgent({ params: { agentId: 'carol' }, body: { agentType: 'gateway', gateway: 'sp', destination: '05' } }, res);
    const updateParams = query.mock.calls[1][1];
    expect(updateParams[updateParams.length - 1]).toBe(false);
  });
  it('an update without the field leaves the flag unchanged (null → COALESCE)', async () => {
    query.mockResolvedValueOnce({ rows: [{ agent_id: 'carol' }] });
    const res = makeRes();
    await updateAgent({ params: { agentId: 'carol' }, body: { fullName: 'Carol B' } }, res);
    const updateParams = query.mock.calls[0][1];
    expect(updateParams[updateParams.length - 1]).toBeNull();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe('PHONE_OFFLINE system break code is protected (scenario 14)', () => {
  const sys = { id: 9, code: 'PHONE_OFFLINE', name: 'Phone offline', active: true, agent_selectable: false };
  it('cannot be edited', async () => {
    query.mockResolvedValueOnce({ rows: [sys] });
    const res = makeRes();
    await updateBreakCode({ params: { id: '9' }, body: { agent_selectable: true }, user: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('SYSTEM_BREAK_CODE');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('cannot be deactivated', async () => {
    query.mockResolvedValueOnce({ rows: [sys] });
    const res = makeRes();
    await setBreakCodeStatus({ params: { id: '9' }, body: { active: false }, user: {} }, res);
    expect(res.statusCode).toBe(403);
  });
  it('another code cannot be renamed to PHONE_OFFLINE', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5, code: 'LUNCH', name: 'Lunch' }] });
    const res = makeRes();
    await updateBreakCode({ params: { id: '5' }, body: { code: 'PHONE_OFFLINE' }, user: {} }, res);
    expect(res.statusCode).toBe(403);
  });
});
