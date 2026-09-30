/**
 * Phase 3B-A — additive API metric normalization tests.
 *
 * Proves the four APPROVED additive fields are present and correct, WITHOUT
 * changing any existing field, formula, or SQL:
 *   • /reports/queue-performance : avg_talk_seconds === aht_seconds (unchanged)
 *   • /reports/agent-performance : avg_talk_seconds === avg_talk_min*60,
 *                                  total_talk_seconds === total_talk_min*60
 *   • /reports/cdr               : queue_wait_seconds (answered = answer-enter),
 *                                  ring_seconds SQL unchanged
 *   • /stats/dashboard           : sla_pct === slaPct (name-only alias)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured = [];
let MOCK = () => ({ rows: [{}] });
vi.mock('../../../db/pool.js', () => ({
  query: vi.fn(async (sql) => { captured.push(String(sql)); return MOCK(String(sql)); }),
  pool: {}, warmPool: vi.fn(),
}));
vi.mock('../../../services/eslService.js', () => ({ isConnected: () => true }));

const reports = await import('../../../controllers/reportsController.js');
const stats   = await import('../../../controllers/statsController.js');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json   = vi.fn(() => res);
  res.send   = vi.fn(() => res);
  res.setHeader = vi.fn(() => res);
  return res;
}
const mockReq = (query = {}) => ({ query, params: {} });
beforeEach(() => { captured.length = 0; MOCK = () => ({ rows: [{}] }); });

describe('queue-performance — avg_talk_seconds additive alias', () => {
  it('avg_talk_seconds equals the existing aht_seconds value; aht_seconds retained', async () => {
    MOCK = () => ({ rows: [{ queue_name: 'q', offered: 10, answered: 8, aht_seconds: 42, asa_seconds: 5, sla_pct: 80 }] });
    const res = mockRes();
    await reports.queuePerformance(mockReq(), res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.aht_seconds).toBe(42);            // unchanged
    expect(row.avg_talk_seconds).toBe(42);        // additive, exact
  });
});

describe('agent-performance — talk-time seconds are integer, straight from the query', () => {
  // Duration-bug fix: seconds are no longer reconstructed as avg_talk_min*60
  // (which produced fractional floats like 14.4). They come from the SQL as
  // ROUND(AVG(talk_seconds))::INT / SUM(talk_seconds)::INT and pass through as-is.
  it('passes integer avg_talk_seconds/total_talk_seconds through; minute fields retained', async () => {
    MOCK = () => ({ rows: [{
      agent_id: 'a1', avg_talk_min: 2.5, total_talk_min: 10, calls_answered: 3,
      avg_talk_seconds: 150, total_talk_seconds: 600,
    }] });
    const res = mockRes();
    await reports.agentPerformance(mockReq(), res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.avg_talk_min).toBe(2.5);            // unchanged
    expect(row.total_talk_min).toBe(10);           // unchanged
    expect(row.avg_talk_seconds).toBe(150);
    expect(row.total_talk_seconds).toBe(600);
    expect(Number.isInteger(row.avg_talk_seconds)).toBe(true);
    expect(Number.isInteger(row.total_talk_seconds)).toBe(true);
  });
  it('no float reconstruction: a 0.24-min row would have shown 14.4 under the old path', async () => {
    MOCK = () => ({ rows: [{
      agent_id: 'a2', avg_talk_min: 0.24, total_talk_min: 0.95,
      avg_talk_seconds: 14, total_talk_seconds: 57,
    }] });
    const res = mockRes();
    await reports.agentPerformance(mockReq(), res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.avg_talk_seconds).toBe(14);
    expect(row.total_talk_seconds).toBe(57);
    expect(String(row.avg_talk_seconds)).not.toMatch(/\./);
  });
});

describe('cdr — queue_wait_seconds additive column; ring_seconds unchanged', () => {
  it('SQL adds queue_wait_seconds (answered = answer - enter) and keeps ring_seconds', async () => {
    MOCK = () => ({ rows: [{ call_uuid: 'x', ring_seconds: 7, queue_wait_seconds: 7 }] });
    const res = mockRes();
    await reports.getCDRReport(mockReq(), res);
    const sql = captured.join('\n');
    expect(sql).toMatch(/AS queue_wait_seconds/);
    // answered-branch derivation present
    expect(sql).toMatch(/ch\.disposition = 'answered'[\s\S]*ch\.agent_answer_time - ch\.queue_enter_time[\s\S]*AS queue_wait_seconds/);
    // legacy ring_seconds column still present and not renamed
    expect(sql).toMatch(/END AS ring_seconds,/);
    // passthrough
    const row = res.json.mock.calls[0][0][0];
    expect(row.ring_seconds).toBe(7);
    expect(row.queue_wait_seconds).toBe(7);
  });
});

describe('dashboard — sla_pct name-only alias', () => {
  it('sla_pct equals slaPct exactly; SLA SQL unchanged', async () => {
    MOCK = (sql) => {
      if (/GROUP BY status/.test(sql)) return { rows: [] };            // agentCounts
      if (/AS sla_pct[\s\S]*FROM calls c[\s\S]*JOIN queues q/.test(sql)) return { rows: [{ sla_pct: 87 }] };
      return { rows: [{}] };
    };
    const res = mockRes();
    await stats.getDashboardStats(mockReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body.slaPct).toBe(87);   // unchanged
    expect(body.sla_pct).toBe(87);  // additive, exact
    // dashboard SLA SQL still the INNER-JOIN ::INT global form (unchanged)
    const all = captured.join('\n');
    expect(all).toMatch(/\)::INT AS sla_pct[\s\S]*FROM calls c[\s\S]*JOIN queues q ON q\.name = c\.queue_name/);
  });
});
