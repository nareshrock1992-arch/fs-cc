// Service level target per queue (migration 012): validation + SQL uses sla_seconds,
// never max_wait_time (the queue exit timer; 0 = no limit).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';

vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({ cc: {} }));
const { validateSlaSeconds } = await import('../../../controllers/queuesController.js');

describe('validateSlaSeconds', () => {
  it('accepts whole seconds 1–3600 and absent values', () => {
    for (const v of [1, 20, '30', 3600, undefined, null]) expect(validateSlaSeconds(v)).toBeNull();
  });
  it('rejects 0, negatives, fractions, text and > 1 hour', () => {
    for (const v of [0, -5, 2.5, 'abc', 3601]) expect(validateSlaSeconds(v)).toMatch(/between 1 and 3600/);
  });
});

describe('SLA formulas use the service level target', () => {
  const src = (f) => readFileSync(new URL(`../../../controllers/${f}`, import.meta.url), 'utf8');
  it.each(['statsController.js', 'agentDeskController.js', 'reportsController.js'])('%s', (f) => {
    const s = src(f);
    expect(s).toMatch(/sla_seconds/);
    expect(s).not.toMatch(/wait_seconds <= q\.max_wait_time/);
    expect(s).not.toMatch(/SELECT max_wait_time FROM queues/);
  });
});
