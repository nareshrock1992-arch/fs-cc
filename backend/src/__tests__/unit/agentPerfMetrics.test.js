/**
 * AGENT-PERF-1 — additive per-agent metrics on /reports/agent-performance.
 *
 * Two layers (pg is mocked repo-wide, so SQL is verified by shape, not execution):
 *  1. SQL-shape guards on the ACTUAL agentPerformance query — proves answer_rate,
 *     avg_ring_seconds (AVG, NOT SUM/COUNT(*)) and total_ring_seconds are added with
 *     the approved formulas/population, and existing fields/date-basis are unchanged.
 *  2. Response passthrough + a semantic mirror of the approved definitions covering
 *     answer_rate, NULL ring handling, zero-offered, and talk-metric preservation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured = [];
let MOCK = () => ({ rows: [{}] });
vi.mock('../../../db/pool.js', () => ({
  query: vi.fn(async (sql) => { captured.push(String(sql)); return MOCK(String(sql)); }),
  pool: {}, warmPool: vi.fn(),
}));
const reports = await import('../../../controllers/reportsController.js');
const mockRes = () => ({ json: vi.fn(), status: vi.fn(function () { return this; }), send: vi.fn(), setHeader: vi.fn() });
const mockReq = (query = {}) => ({ query, params: {} });
beforeEach(() => { captured.length = 0; MOCK = () => ({ rows: [{}] }); });

describe('agentPerformance — SQL shape (approved AGENT-PERF-1 formulas)', () => {
  it('adds answer_rate / avg_ring_seconds / total_ring_seconds with the correct expressions', async () => {
    await reports.agentPerformance(mockReq(), mockRes());
    const sql = captured.join('\n');

    // answer_rate = canonical answered / offered * 100 (offered = COUNT(*))
    expect(sql).toMatch(/100\.0 \* COUNT\(\*\) FILTER \(WHERE ah\.missed = false AND ah\.talk_start IS NOT NULL\)\s*\/ NULLIF\(COUNT\(\*\), 0\)[\s\S]*AS answer_rate/);
    // Avg Ring = AVG(ring_seconds) over ALL offered legs (NULLs excluded by AVG)
    expect(sql).toMatch(/AVG\(ah\.ring_seconds\)[\s\S]*AS avg_ring_seconds/);
    // must NOT compute avg ring as SUM/COUNT(*) (that would wrongly include NULL legs)
    expect(sql).not.toMatch(/SUM\(ah\.ring_seconds\)\s*\/\s*COUNT\(\*\)/);
    // Total Ring = SUM(ring_seconds)
    expect(sql).toMatch(/SUM\(ah\.ring_seconds\)[\s\S]*AS total_ring_seconds/);
    // date basis unchanged (ring_start, half-open)
    expect(sql).toMatch(/WHERE ah\.ring_start >= \$1 AND ah\.ring_start < \$2/);
    // existing minute fields unchanged
    expect(sql).toMatch(/AS avg_talk_min/);
    expect(sql).toMatch(/AS total_talk_min/);
  });
});

describe('agentPerformance — response passthrough + talk preservation', () => {
  it('surfaces the new fields and keeps avg/total talk seconds derivation', async () => {
    MOCK = () => ({ rows: [{
      agent_id: 'a1', calls_offered: 10, calls_answered: 8, calls_missed: 2,
      avg_talk_min: 2.5, total_talk_min: 10,
      answer_rate: 80.0, avg_ring_seconds: 21, total_ring_seconds: 420,
    }] });
    const res = mockRes();
    await reports.agentPerformance(mockReq(), res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.answer_rate).toBe(80.0);
    expect(row.avg_ring_seconds).toBe(21);
    expect(row.total_ring_seconds).toBe(420);
    expect(row.avg_talk_min).toBe(2.5);           // unchanged
    expect(row.avg_talk_seconds).toBe(150);        // 3B-A derivation intact
    expect(row.total_talk_seconds).toBe(600);
  });
});

// ── Semantic mirror of the approved definitions (documents intent) ─────────────
const answerRate = (answered, offered) => offered > 0 ? Math.round((answered / offered) * 1000) / 10 : 0;
const avgRingAllOffered = legs => {
  const vals = legs.map(l => l.ring_seconds).filter(v => v != null); // NULL excluded
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
};
const totalRing = legs => legs.reduce((s, l) => s + (l.ring_seconds ?? 0), 0);

describe('agentPerformance — semantic reconciliation', () => {
  it('answer_rate = answered/offered*100 (offered legs)', () => {
    expect(answerRate(8, 10)).toBe(80);
    expect(answerRate(0, 0)).toBe(0);       // zero-offered guard
    expect(answerRate(1, 3)).toBe(33.3);
  });
  it('avg_ring excludes NULL ring_seconds from the denominator', () => {
    // 3 offered legs: rings 21, 63, NULL → avg over the 2 populated = 42
    expect(avgRingAllOffered([{ ring_seconds: 21 }, { ring_seconds: 63 }, { ring_seconds: null }])).toBe(42);
    expect(avgRingAllOffered([{ ring_seconds: null }])).toBe(0);
    expect(avgRingAllOffered([])).toBe(0);
  });
  it('total_ring = SUM(ring_seconds) with NULLs ignored', () => {
    expect(totalRing([{ ring_seconds: 21 }, { ring_seconds: 63 }, { ring_seconds: null }])).toBe(84);
  });
});
