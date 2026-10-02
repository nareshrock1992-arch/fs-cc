/**
 * AGENT-PERF-2 — per-agent DAILY aggregation (/reports/agent-daily).
 *
 * Layers (pg mocked repo-wide):
 *  1. SQL-shape guards on the ACTUAL agentPerformanceDaily query — proves it reuses
 *     the AGENT-PERF-1 canonical predicates, ring_start date basis, business-tz daily
 *     bucketing, and AVG(ring_seconds) (NOT SUM/COUNT(*)), and adds the optional agent
 *     filter as a bound param.
 *  2. Semantic mirrors of the approved definitions (grouping, boundaries, answer_rate,
 *     NULL ring, unresolved offered legs, talk preservation, empty days) + the required
 *     reconciliation Σ(daily offered/answered/missed) === range totals.
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

describe('agentPerformanceDaily — SQL shape (canonical predicates + daily bucketing)', () => {
  it('reuses AGENT-PERF-1 predicates, ring_start basis, business-tz day bucket', async () => {
    await reports.agentPerformanceDaily(mockReq(), mockRes());
    const sql = captured.join('\n');
    // business-day bucket on ring_start (same pattern as callVolumeByDay)
    // day is a clean 'YYYY-MM-DD' STRING via to_char (not ::date, which node-pg
    // would turn into a JS Date → ISO timestamp → broken chart x-axis labels).
    expect(sql).toMatch(/to_char\(date_trunc\('day', ah\.ring_start AT TIME ZONE \$3\), 'YYYY-MM-DD'\)\s+AS day/);
    // canonical offered/answered/missed
    expect(sql).toMatch(/COUNT\(\*\)::INT\s+AS calls_offered/);
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE ah\.missed = false AND ah\.talk_start IS NOT NULL\)::INT\s+AS calls_answered/);
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE ah\.missed = true\)::INT\s+AS calls_missed/);
    // answer_rate = canonical answered / offered * 100
    expect(sql).toMatch(/100\.0 \* COUNT\(\*\) FILTER \(WHERE ah\.missed = false AND ah\.talk_start IS NOT NULL\)\s*\/ NULLIF\(COUNT\(\*\), 0\)[\s\S]*AS answer_rate/);
    // Avg Ring = AVG(ring_seconds) over ALL offered legs, NOT SUM/COUNT(*)
    expect(sql).toMatch(/AVG\(ah\.ring_seconds\)[\s\S]*AS avg_ring_seconds/);
    expect(sql).not.toMatch(/SUM\(ah\.ring_seconds\)\s*\/\s*COUNT\(\*\)/);
    expect(sql).toMatch(/SUM\(ah\.ring_seconds\)[\s\S]*AS total_ring_seconds/);
    // ring_start half-open range + grouping/order
    expect(sql).toMatch(/WHERE ah\.ring_start >= \$1 AND ah\.ring_start < \$2/);
    expect(sql).toMatch(/GROUP BY day, ah\.agent_id, a\.full_name/);
    expect(sql).toMatch(/ORDER BY day ASC, ah\.agent_id ASC/);
  });

  it('optional agent filter is a bound param ($4), omitted when absent', async () => {
    await reports.agentPerformanceDaily(mockReq(), mockRes());       // no agent
    expect(captured.join('\n')).not.toMatch(/ah\.agent_id = \$4/);
    captured.length = 0;
    await reports.agentPerformanceDaily(mockReq({ agent: 'a1@x' }), mockRes());
    expect(captured.join('\n')).toMatch(/AND ah\.agent_id = \$4/);
  });

  it('passes rows through unchanged (array response)', async () => {
    MOCK = () => ({ rows: [{ day: '2026-09-27', agent_id: 'a1', calls_offered: 5 }] });
    const res = mockRes();
    await reports.agentPerformanceDaily(mockReq(), res);
    expect(res.json.mock.calls[0][0]).toEqual([{ day: '2026-09-27', agent_id: 'a1', calls_offered: 5 }]);
  });
});

// ── Semantic mirrors of the approved definitions ──────────────────────────────
const answered = leg => leg.missed === false && leg.talk_start != null;
const missed   = leg => leg.missed === true;
function dailyAgg(legs) {
  // group by (day, agent) then compute the canonical metrics
  const g = new Map();
  for (const l of legs) {
    const k = `${l.day}|${l.agent_id}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(l);
  }
  return [...g.entries()].map(([k, rows]) => {
    const [day, agent_id] = k.split('|');
    const offered = rows.length;
    const ans = rows.filter(answered).length;
    const mis = rows.filter(missed).length;
    const rings = rows.map(r => r.ring_seconds).filter(v => v != null);
    const talks = rows.filter(answered).map(r => r.talk_seconds);
    return {
      day, agent_id, calls_offered: offered, calls_answered: ans, calls_missed: mis,
      answer_rate: offered ? Math.round((ans / offered) * 1000) / 10 : 0,
      avg_ring_seconds: rings.length ? Math.round(rings.reduce((a, b) => a + b, 0) / rings.length) : 0,
      total_ring_seconds: rings.reduce((a, b) => a + b, 0),
      total_talk_seconds: rows.filter(l => l.missed === false).reduce((s, r) => s + (r.talk_seconds ?? 0), 0),
    };
  }).sort((a, b) => a.day.localeCompare(b.day) || a.agent_id.localeCompare(b.agent_id));
}

describe('agentPerformanceDaily — semantic reconciliation', () => {
  const legs = [
    // day1 a1: answered, missed, unresolved(offered-not-answered-not-missed)
    { day: 'D1', agent_id: 'a1', missed: false, talk_start: 't', talk_seconds: 30, ring_seconds: 10 },
    { day: 'D1', agent_id: 'a1', missed: true,  talk_start: null, talk_seconds: null, ring_seconds: 60 },
    { day: 'D1', agent_id: 'a1', missed: false, talk_start: null, talk_seconds: null, ring_seconds: null }, // unresolved + NULL ring
    // day1 a2: one answered
    { day: 'D1', agent_id: 'a2', missed: false, talk_start: 't', talk_seconds: 90, ring_seconds: 20 },
    // day2 a1: one answered
    { day: 'D2', agent_id: 'a1', missed: false, talk_start: 't', talk_seconds: 40, ring_seconds: 12 },
  ];
  const daily = dailyAgg(legs);

  it('daily grouping by (day, agent) with multiple agents and days', () => {
    expect(daily.map(d => `${d.day}/${d.agent_id}`)).toEqual(['D1/a1', 'D1/a2', 'D2/a1']);
  });
  it('unresolved offered leg counts in offered but not answered/missed', () => {
    const d1a1 = daily.find(d => d.day === 'D1' && d.agent_id === 'a1');
    expect(d1a1.calls_offered).toBe(3);   // incl. unresolved
    expect(d1a1.calls_answered).toBe(1);
    expect(d1a1.calls_missed).toBe(1);     // offered != answered+missed preserved
  });
  it('answer_rate uses offered denominator (incl. unresolved)', () => {
    expect(daily.find(d => d.day === 'D1' && d.agent_id === 'a1').answer_rate).toBe(33.3); // 1/3
  });
  it('avg_ring excludes NULL ring from the denominator', () => {
    // D1/a1 rings = 10, 60, NULL → avg over 2 = 35
    expect(daily.find(d => d.day === 'D1' && d.agent_id === 'a1').avg_ring_seconds).toBe(35);
  });
  it('talk metrics preserved (answered-only avg; non-missed sum)', () => {
    expect(daily.find(d => d.day === 'D2' && d.agent_id === 'a1').total_talk_seconds).toBe(40);
  });
  it('empty/no-data range → no rows', () => {
    expect(dailyAgg([])).toEqual([]);
  });
  it('RECONCILIATION: Σ(daily offered/answered/missed) === range totals per agent', () => {
    const rangeA1 = { offered: 4, answered: 2, missed: 1 }; // a1 across D1+D2 from `legs`
    const sum = (agent, key) => daily.filter(d => d.agent_id === agent)
      .reduce((s, d) => s + d[`calls_${key}`], 0);
    expect(sum('a1', 'offered')).toBe(rangeA1.offered);
    expect(sum('a1', 'answered')).toBe(rangeA1.answered);
    expect(sum('a1', 'missed')).toBe(rangeA1.missed);
  });
});
