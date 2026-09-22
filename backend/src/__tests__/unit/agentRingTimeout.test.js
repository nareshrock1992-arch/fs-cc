/**
 * Phase 4 — buildContact() per-agent ring timeout (leg_timeout) with PAI preserved.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/index.js', () => ({
  config: { fs: { sipDomain: 'fs.example.com' }, esl: { host: 'localhost', port: 8021, password: 'x', reconnectMs: 3000 } },
}));
vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: { agentAdd: vi.fn(), agentSetParam: vi.fn(), agentSetContact: vi.fn(), agentDel: vi.fn(), agentSetStatus: vi.fn(), agentSetState: vi.fn(), agentLive: vi.fn() },
  isConnected: vi.fn(() => false),
}));
vi.mock('../../../services/agentSessionService.js', () => ({ handleStatusTransition: vi.fn(), reconcileOnStartup: vi.fn() }));

const { buildContact } = await import('../../../controllers/agentsController.js');

describe('buildContact — ring timeout (leg_timeout)', () => {
  it('no ringTimeout → unchanged PAI-only contact (backward compatible)', () => {
    expect(buildContact({ agentType: 'internal', extension: '1002' }))
      .toBe('{sip_cid_type=pid}user/1002@fs.example.com');
  });
  it('internal + ringTimeout embeds leg_timeout in the SAME var block', () => {
    expect(buildContact({ agentType: 'internal', extension: '1002', ringTimeout: 12 }))
      .toBe('{sip_cid_type=pid,leg_timeout=12}user/1002@fs.example.com');
  });
  it('gateway + ringTimeout', () => {
    expect(buildContact({ agentType: 'gateway', gateway: 'gw1', destination: '5551234', ringTimeout: 30 }))
      .toBe('{sip_cid_type=pid,leg_timeout=30}sofia/gateway/gw1/5551234');
  });
  it('ringTimeout null/empty → no leg_timeout', () => {
    expect(buildContact({ agentType: 'internal', extension: '1002', ringTimeout: null }))
      .toBe('{sip_cid_type=pid}user/1002@fs.example.com');
    expect(buildContact({ agentType: 'internal', extension: '1002', ringTimeout: '' }))
      .toBe('{sip_cid_type=pid}user/1002@fs.example.com');
  });
  it('PAI is never duplicated — never two {…} blocks', () => {
    const c = buildContact({ agentType: 'internal', extension: '1002', ringTimeout: 10 });
    expect((c.match(/\{/g) || []).length).toBe(1);
    expect((c.match(/sip_cid_type=pid/g) || []).length).toBe(1);
  });
  it('idempotent rebuild from an existing contact (strip old block, re-prefix with new leg_timeout)', () => {
    // Simulates the ring-only update path: pass the current full contact + new ringTimeout.
    const existing = '{sip_cid_type=pid,leg_timeout=10}user/1002@fs.example.com';
    expect(buildContact({ contact: existing, ringTimeout: 20 }))
      .toBe('{sip_cid_type=pid,leg_timeout=20}user/1002@fs.example.com');
    // Clearing the override:
    expect(buildContact({ contact: existing, ringTimeout: null }))
      .toBe('{sip_cid_type=pid}user/1002@fs.example.com');
  });
});
