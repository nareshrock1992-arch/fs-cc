/**
 * Phase 8 — queue/tier validation: validateTier() + queue no-answer-status + tier states.
 * Pure exports; deps mocked so the controller loads without DB/ESL.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: { queueAdd: vi.fn(), queueDel: vi.fn(), queueSetParam: vi.fn(),
        tierAdd: vi.fn(), tierDel: vi.fn(), tierSetLevel: vi.fn(), tierSetPosition: vi.fn(), tierSetState: vi.fn() },
}));

const mod = await import('../../../controllers/queuesController.js');
const { validateTier, TIER_STATES, QUEUE_NO_ANSWER_STATUSES, setTier, addTier, removeTier } = mod;

describe('validateTier', () => {
  it('accepts valid level/position/state', () => {
    expect(validateTier({ level: 1, position: 1, state: 'Ready' })).toEqual([]);
    expect(validateTier({ level: 10, position: 100, state: 'Standby' })).toEqual([]);
    expect(validateTier({})).toEqual([]); // all optional
  });
  it('rejects out-of-range level', () => {
    expect(validateTier({ level: 0 })).toHaveLength(1);
    expect(validateTier({ level: 11 })).toHaveLength(1);
    expect(validateTier({ level: 2.5 })).toHaveLength(1);
  });
  it('rejects out-of-range position', () => {
    expect(validateTier({ position: 0 })).toHaveLength(1);
    expect(validateTier({ position: 101 })).toHaveLength(1);
  });
  it('rejects an unknown tier state (no invented states)', () => {
    expect(validateTier({ state: 'Coffee' })).toHaveLength(1);
    expect(validateTier({ state: 'Active' })).toHaveLength(1); // not in the admin-settable set
  });
  it('collects multiple errors', () => {
    expect(validateTier({ level: 0, position: 0, state: 'x' })).toHaveLength(3);
  });
});

describe('constants (no invented values / no On Demand)', () => {
  it('tier states are the conservative admin-settable set', () => {
    expect(TIER_STATES).toEqual(['Ready', 'Standby', 'No Answer']);
  });
  it('queue no-answer statuses are the 3 in-scope statuses (no On Demand)', () => {
    expect(QUEUE_NO_ANSWER_STATUSES).toEqual(['Available', 'On Break', 'Logged Out']);
    expect(QUEUE_NO_ANSWER_STATUSES).not.toContain('Available (On Demand)');
  });
});

describe('controller exports the tier operations', () => {
  it('addTier / setTier / removeTier are functions', () => {
    expect(typeof addTier).toBe('function');
    expect(typeof setTier).toBe('function');
    expect(typeof removeTier).toBe('function');
  });
});
