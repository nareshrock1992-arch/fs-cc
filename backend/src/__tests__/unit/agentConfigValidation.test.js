/**
 * Phase 2 — validateAgentConfig(): fs_agent_type + ring_timeout + timing validation.
 * Pure function; no DB/ESL needed. Mirrors the migration 008 CHECK constraints.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/index.js', () => ({
  config: { fs: { sipDomain: 'fs.example.com' }, esl: { host: 'localhost', port: 8021, password: 'x', reconnectMs: 3000 } },
}));
vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: { agentAdd: vi.fn(), agentSetParam: vi.fn(), agentSetContact: vi.fn(), agentDel: vi.fn(), agentSetStatus: vi.fn(), agentSetState: vi.fn() },
}));
vi.mock('../../../services/agentSessionService.js', () => ({ handleStatusTransition: vi.fn(), reconcileOnStartup: vi.fn() }));

const { validateAgentConfig, FS_AGENT_TYPES } = await import('../../../controllers/agentsController.js');

describe('validateAgentConfig — fs_agent_type', () => {
  it('accepts callback and uuid-standby', () => {
    expect(validateAgentConfig({ fsAgentType: 'callback' })).toEqual([]);
    expect(validateAgentConfig({ fsAgentType: 'uuid-standby' })).toEqual([]);
  });
  it('exposes the exact FS type list', () => {
    expect(FS_AGENT_TYPES).toEqual(['callback', 'uuid-standby']);
  });
  it('rejects an unknown fs_agent_type', () => {
    expect(validateAgentConfig({ fsAgentType: 'internal' })).toHaveLength(1);
    expect(validateAgentConfig({ fsAgentType: 'gateway' })[0]).toMatch(/fs_agent_type/);
  });
  it('treats undefined/null as no-op (field optional)', () => {
    expect(validateAgentConfig({})).toEqual([]);
    expect(validateAgentConfig({ fsAgentType: null })).toEqual([]);
  });
});

describe('validateAgentConfig — ring_timeout', () => {
  it('accepts null / undefined / empty (no override)', () => {
    expect(validateAgentConfig({ ringTimeout: null })).toEqual([]);
    expect(validateAgentConfig({ ringTimeout: undefined })).toEqual([]);
    expect(validateAgentConfig({ ringTimeout: '' })).toEqual([]);
  });
  it('accepts 1..600', () => {
    expect(validateAgentConfig({ ringTimeout: 1 })).toEqual([]);
    expect(validateAgentConfig({ ringTimeout: 30 })).toEqual([]);
    expect(validateAgentConfig({ ringTimeout: 600 })).toEqual([]);
  });
  it('rejects out-of-range or non-integer', () => {
    expect(validateAgentConfig({ ringTimeout: 0 })).toHaveLength(1);
    expect(validateAgentConfig({ ringTimeout: 601 })).toHaveLength(1);
    expect(validateAgentConfig({ ringTimeout: 12.5 })).toHaveLength(1);
  });
});

describe('validateAgentConfig — timing fields', () => {
  it('accepts non-negative integers', () => {
    expect(validateAgentConfig({ maxNoAnswer: 3, wrapUpTime: 20, rejectDelayTime: 2, busyDelayTime: 60, noAnswerDelayTime: 10 })).toEqual([]);
    expect(validateAgentConfig({ maxNoAnswer: 0 })).toEqual([]);
  });
  it('rejects negatives / non-integers', () => {
    expect(validateAgentConfig({ wrapUpTime: -1 })).toHaveLength(1);
    expect(validateAgentConfig({ busyDelayTime: 3.3 })).toHaveLength(1);
    expect(validateAgentConfig({ noAnswerDelayTime: -5 })).toHaveLength(1);
  });
  it('collects multiple errors', () => {
    expect(validateAgentConfig({ fsAgentType: 'x', ringTimeout: 0, wrapUpTime: -1 })).toHaveLength(3);
  });
});
