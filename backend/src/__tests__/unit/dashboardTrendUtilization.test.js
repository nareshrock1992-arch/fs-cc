/**
 * Dashboard wallboard endpoints:
 *   • GET /api/stats/calls-trend       — today's hourly offered/answered/abandoned
 *                                        aggregated across queues from queue_stats_hourly
 *   • GET /api/stats/utilization-today — floor-level period utilization reusing the
 *                                        canonical (ring+talk)/available occupancy
 *
 * pg is mocked; agentReportService (the canonical occupancy source) is mocked so we
 * verify statsController AGGREGATES its outputs correctly without duplicating logic.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/dashboardTrendUtilization.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured = [];
let MOCK_ROWS = [];
vi.mock('../../../db/pool.js', () => ({
  query: vi.fn(async (sql, params) => { captured.push({ sql: String(sql), params }); return { rows: MOCK_ROWS }; }),
  pool: {}, warmPool: vi.fn(),
}));
vi.mock('../../../services/eslService.js', () => ({ isConnected: () => true }));
vi.mock('../../../config/index.js', () => ({ config: { businessTimezone: 'Asia/Riyadh' } }));
vi.mock('../../../utils/timezone.js', () => ({
  businessTodayRange: () => ({
    fromUTC: new Date('2026-10-01T21:00:00Z'),
    toUTC:   new Date('2026-10-02T21:00:00Z'),
  }),
  businessToday: () => '2026-10-02',
}));

let STATE_ROWS = [];
let CALL_ROWS = [];
vi.mock('../../../services/agentReportService.js', () => ({
  getStateDurations: vi.fn(async () => STATE_ROWS),
  getCallMetrics:    vi.fn(async () => CALL_ROWS),
}));

const stats = await import('../../../controllers/statsController.js');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const req = () => ({ query: {}, params: {} });

beforeEach(() => { captured.length = 0; MOCK_ROWS = []; STATE_ROWS = []; CALL_ROWS = []; });

// ── Calls trend ───────────────────────────────────────────────────────────────
describe('getCallsTrend — hourly aggregation from queue_stats_hourly', () => {
  it('aggregates across queues, projects buckets to the business timezone, scopes to today', async () => {
    await stats.getCallsTrend(req(), mockRes());
    const { sql, params } = captured[0];
    expect(sql).toMatch(/FROM queue_stats_hourly/);
    expect(sql).toMatch(/SUM\(offered\)/i);
    expect(sql).toMatch(/SUM\(answered\)/i);
    expect(sql).toMatch(/SUM\(abandoned\)/i);
    // business-timezone projection + half-open today range (not raw UTC date)
    expect(sql).toMatch(/AT TIME ZONE \$3/);
    expect(sql).toMatch(/hour_bucket >= \$1 AND hour_bucket < \$2/);
    expect(params[2]).toBe('Asia/Riyadh');
  });

  it('maps rows to {hour, offered, answered, abandoned}', async () => {
    MOCK_ROWS = [
      { hour: '09:00', local_hour: 't', offered: 10, answered: 8, abandoned: 2 },
      { hour: '10:00', local_hour: 't', offered: 4,  answered: 4, abandoned: 0 },
    ];
    const res = mockRes();
    await stats.getCallsTrend(req(), res);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual([
      { hour: '09:00', offered: 10, answered: 8, abandoned: 2 },
      { hour: '10:00', offered: 4,  answered: 4, abandoned: 0 },
    ]);
  });

  it('returns [] for an empty day', async () => {
    MOCK_ROWS = [];
    const res = mockRes();
    await stats.getCallsTrend(req(), res);
    expect(res.json.mock.calls[0][0]).toEqual([]);
  });
});

// ── Utilization today ─────────────────────────────────────────────────────────
describe('getUtilizationToday — floor aggregation of canonical occupancy', () => {
  it('computes SUM(ring+talk)/SUM(available)×100 across agents, Available-only denominator', async () => {
    STATE_ROWS = [
      { agent_id: 'a', status: 'Available', total_seconds: 3000 },
      { agent_id: 'b', status: 'Available', total_seconds: 1000 },
      { agent_id: 'a', status: 'On Break',  total_seconds: 9999 }, // must NOT count
    ];
    CALL_ROWS = [
      { agent_id: 'a', total_ring_seconds: 200, total_talk_seconds: 1800 },
      { agent_id: 'b', total_ring_seconds: 100, total_talk_seconds: 100 },
    ];
    const res = mockRes();
    await stats.getUtilizationToday(req(), res);
    const b = res.json.mock.calls[0][0];
    // engaged = (200+1800)+(100+100)=2200 ; available = 3000+1000=4000 ; 55.0%
    expect(b.available_seconds).toBe(4000);
    expect(b.engaged_seconds).toBe(2200);
    expect(b.pct).toBe(55);
    expect(b.window).toBe('today');
    expect(b.formula).toMatch(/ring_seconds \+ talk_seconds\) \/ available_seconds/);
  });

  it('returns pct = null when there is no Available time (no divide-by-zero)', async () => {
    STATE_ROWS = [{ agent_id: 'a', status: 'On Break', total_seconds: 500 }];
    CALL_ROWS  = [{ agent_id: 'a', total_ring_seconds: 50, total_talk_seconds: 50 }];
    const res = mockRes();
    await stats.getUtilizationToday(req(), res);
    const b = res.json.mock.calls[0][0];
    expect(b.available_seconds).toBe(0);
    expect(b.pct).toBeNull();
  });

  it('handles an empty day (no agents) as pct null, zero seconds', async () => {
    const res = mockRes();
    await stats.getUtilizationToday(req(), res);
    const b = res.json.mock.calls[0][0];
    expect(b.pct).toBeNull();
    expect(b.engaged_seconds).toBe(0);
    expect(b.available_seconds).toBe(0);
  });
});
