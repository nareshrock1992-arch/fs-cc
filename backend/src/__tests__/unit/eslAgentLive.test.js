/**
 * Phase 3 — ESL: normalizeAgentLive() + live/tier helpers.
 * normalizeAgentLive maps a parsed `callcenter_config agent list` row to a LIVE
 * snapshot (runtime only). Deps mocked so the real eslService loads without a
 * FreeSWITCH/DB connection.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('modesl', () => ({ default: { Connection: vi.fn() } }));
vi.mock('../../../config/index.js', () => ({
  config: { esl: { host: 'localhost', port: 8021, password: 'x', reconnectMs: 3000 }, fs: {} },
}));
vi.mock('../../../db/pool.js', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../../../services/agentSessionService.js', () => ({
  handleStatusTransition: vi.fn(), reconcileOnStartup: vi.fn(),
}));

const { normalizeAgentLive, cc } = await import('../../../services/eslService.js');

describe('normalizeAgentLive — LIVE snapshot mapping', () => {
  const row = {
    name: 'agent_1001', type: 'callback', contact: '{sip_cid_type=pid}user/1001@d',
    status: 'Available', state: 'Waiting', uuid: 'abc-123',
    no_answer_count: '2', calls_answered: '5', talk_time: '120', ready_time: '600',
    external_calls_count: '1', last_offered_call: '1700000000', last_bridge_start: '1700000100',
    last_bridge_end: '1700000200', last_status_change: '1700000050',
  };
  it('maps identity + runtime fields', () => {
    const s = normalizeAgentLive(row);
    expect(s.name).toBe('agent_1001');
    expect(s.fs_type).toBe('callback');
    expect(s.status).toBe('Available');
    expect(s.state).toBe('Waiting');
    expect(s.uuid).toBe('abc-123');
  });
  it('coerces numeric counters', () => {
    const s = normalizeAgentLive(row);
    expect(s.calls_answered).toBe(5);
    expect(s.talk_time).toBe(120);
    expect(s.no_answer_count).toBe(2);
    expect(s.external_calls_count).toBe(1);
    expect(s.last_bridge_start).toBe(1700000100);
  });
  it('missing/blank columns → null (version-drift safe)', () => {
    const s = normalizeAgentLive({ name: 'a', type: 'uuid-standby' });
    expect(s.fs_type).toBe('uuid-standby');
    expect(s.calls_answered).toBeNull();
    expect(s.talk_time).toBeNull();
    expect(s.uuid).toBeNull();
  });
  it('non-numeric counter → null', () => {
    expect(normalizeAgentLive({ name: 'a', calls_answered: 'N/A' }).calls_answered).toBeNull();
  });
  it('preserves the raw row for troubleshooting', () => {
    expect(normalizeAgentLive(row)._raw).toBe(row);
  });
  it('null/invalid input → null', () => {
    expect(normalizeAgentLive(null)).toBeNull();
    expect(normalizeAgentLive(undefined)).toBeNull();
  });
});

describe('ESL tier + live helpers exist', () => {
  it('tierSetLevel / tierSetPosition / agentLive are functions', () => {
    expect(typeof cc.tierSetLevel).toBe('function');
    expect(typeof cc.tierSetPosition).toBe('function');
    expect(typeof cc.agentLive).toBe('function');
  });
});
