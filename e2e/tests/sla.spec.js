// M2 Part A — one service level definition on every screen (owner decision 2026-11-23):
//   answered within the queue's target ÷ (answered + ALL abandoned), one decimal, "—" (null) without calls.
// Fixture (e2e/seed.mjs): queue e2e_sla@default, target 20 s, 3 answered ≤ 20 s, 1 answered at 30 s,
// 2 abandoned (3 s and 40 s), 1 still waiting  →  3 / (4 + 2) = 50.0 %.
import { test, expect } from '@playwright/test';

const API = process.env.E2E_API_URL + '/api';
const QUEUE = 'e2e_sla@default';
const EXPECTED = 50;

const rowsOf = (body) => (Array.isArray(body) ? body : body.rows || body.queues || body.data || []);
const pick = (rows, name) => rows.find((r) => (r.queue_name ?? r.name) === name);

let admin, agent;
test.beforeAll(async ({ request }) => {
  const a = await request.post(`${API}/auth/login`, { data: { username: process.env.E2E_ADMIN_USER, password: process.env.E2E_ADMIN_PASS } });
  admin = { headers: { Authorization: `Bearer ${(await a.json()).token}` } };
  const g = await request.post(`${API}/agent-desk/login`, { data: { agent_id: process.env.E2E_AGENT_ID, pin: process.env.E2E_AGENT_PIN } });
  agent = { headers: { Authorization: `Bearer ${(await g.json()).token}` } };
});

test('Queue Stats, queue-performance report, export and Agent Desktop all show 50.0 %', async ({ request }) => {
  const stats = pick(rowsOf(await (await request.get(`${API}/stats/queues`, admin)).json()), QUEUE);
  const report = pick(rowsOf(await (await request.get(`${API}/reports/queue-performance`, admin)).json()), QUEUE);
  const desk = pick(rowsOf(await (await request.get(`${API}/agent-desk/queues`, agent)).json()), QUEUE);
  expect(stats, 'queue stats row').toBeTruthy();
  expect(report, 'report row').toBeTruthy();
  expect(desk, 'agent desk row').toBeTruthy();
  expect(Number(stats.sla_pct_today)).toBe(EXPECTED);
  expect(Number(report.sla_pct)).toBe(EXPECTED);
  expect(Number(desk.sla_pct_today)).toBe(EXPECTED);

  const csv = await (await request.get(`${API}/reports/export?type=queue-performance&format=csv`, admin)).text();
  const line = csv.split('\n').find((l) => l.includes(QUEUE));
  expect(line, 'export row').toBeTruthy();
  expect(line.split(',').pop().trim().replace(/"/g, '')).toBe('50.0');
});

test('dashboard total uses the same formula (only this fixture has finished calls)', async ({ request }) => {
  const d = await (await request.get(`${API}/stats/dashboard`, admin)).json();
  expect(d.slaPct).toBe(EXPECTED);
  expect(d.sla_pct).toBe(EXPECTED);
});

test('a queue with no answered or abandoned calls shows no service level (null → "—")', async ({ request }) => {
  const q = pick(rowsOf(await (await request.get(`${API}/stats/queues`, admin)).json()), 'e2e_q@default');
  expect(q, 'empty queue row').toBeTruthy();
  expect(q.sla_pct_today).toBeNull();
});
