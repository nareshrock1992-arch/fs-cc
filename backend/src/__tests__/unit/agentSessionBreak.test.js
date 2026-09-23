/**
 * Unit tests for break-code threading in agentSessionService.handleStatusTransition.
 *
 * Verifies the snapshot write, the break-reason switch (close + reopen), and the
 * guarantee that a codeless FreeSWITCH/reconciliation event never wipes an
 * existing break-code snapshot.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/agentSessionBreak.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/pool.js', () => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  return { pool: { connect: vi.fn().mockResolvedValue(mockClient) }, __mockClient: mockClient };
});

import { __mockClient as client } from '../../../db/pool.js';
import { handleStatusTransition } from '../../../services/agentSessionService.js';

function setup({ openSession = { id: 1 }, openEvent = null } = {}) {
  client.query.mockImplementation(async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('agent_sessions') && s.includes('logout_at IS NULL') && !s.includes('INSERT INTO') && !s.includes('id, agent_id FROM'))
      return { rows: openSession ? [openSession] : [] };
    if (s.includes('agent_state_events') && s.includes('ended_at IS NULL') && s.startsWith('SELECT'))
      return { rows: openEvent ? [openEvent] : [] };
    if (s.includes('INSERT INTO agent_sessions') && s.includes('RETURNING id'))
      return { rows: [{ id: openSession?.id ?? 1 }] };
    return { rows: [] };
  });
}
const inserts = () => client.query.mock.calls.filter(c => /INSERT INTO agent_state_events/.test(c[0]));
const closes  = () => client.query.mock.calls.filter(c => /UPDATE agent_state_events SET\s+ended_at/.test(c[0].replace(/\s+/g, ' ')));

beforeEach(() => { vi.clearAllMocks(); });

it('On Break with a break code snapshots code + name onto the new event', async () => {
  setup({ openSession: { id: 1 }, openEvent: null });
  await handleStatusTransition('alice', 'On Break', 'agent_self', { break_code: 'COFFEE', break_name: 'Coffee Break' });
  const ins = inserts();
  expect(ins).toHaveLength(1);
  // params: [agentId, sessionId, status, source, break_code, break_name]
  expect(ins[0][1][4]).toBe('COFFEE');
  expect(ins[0][1][5]).toBe('Coffee Break');
});

it('switching break reason closes the old segment and opens a new coded one', async () => {
  setup({ openSession: { id: 1 }, openEvent: { id: 9, status: 'On Break', break_code: 'COFFEE' } });
  await handleStatusTransition('alice', 'On Break', 'agent_self', { break_code: 'LUNCH', break_name: 'Lunch Break' });
  expect(closes()).toHaveLength(1);
  expect(closes()[0][1]).toEqual([9]);
  const ins = inserts();
  expect(ins).toHaveLength(1);
  expect(ins[0][1][4]).toBe('LUNCH');
});

it('a codeless event on an existing coded break is a no-op (snapshot preserved)', async () => {
  setup({ openSession: { id: 1 }, openEvent: { id: 9, status: 'On Break', break_code: 'COFFEE' } });
  await handleStatusTransition('alice', 'On Break', 'fs_event'); // no breakInfo
  expect(closes()).toHaveLength(0);
  expect(inserts()).toHaveLength(0);
});

it('Available after On Break closes the open break event', async () => {
  setup({ openSession: { id: 1 }, openEvent: { id: 9, status: 'On Break', break_code: 'COFFEE' } });
  await handleStatusTransition('alice', 'Available', 'agent_self');
  expect(closes()).toHaveLength(1);
  expect(closes()[0][1]).toEqual([9]);
  // a new Available event (no break code) is opened
  const ins = inserts();
  expect(ins).toHaveLength(1);
  expect(ins[0][1][2]).toBe('Available');
  expect(ins[0][1][4]).toBeNull();
});

// ── Fix 1: concurrent fs_event/agent_self race on the single open segment ──────
// The unit mock cannot reproduce a real DB conflict, so these assert the SQL the
// open-event INSERT actually issues — the guarantee lives in the ON CONFLICT rule.
const openInsertSql = () => {
  const call = client.query.mock.calls.find(c => /INSERT INTO agent_state_events/.test(c[0]));
  return call ? call[0].replace(/\s+/g, ' ').trim() : '';
};

it('Test 1 & 5: coded INSERT upgrades a codeless open row (NULL→code) and keeps the one-open-event conflict target', async () => {
  // agent_self runs the INSERT path (its getOpenEvent saw no On Break row yet — the
  // concurrent fs_event row is created between the SELECT and the INSERT).
  setup({ openSession: { id: 1 }, openEvent: null });
  await handleStatusTransition('alice', 'On Break', 'agent_self', { break_code: 'LUNCH', break_name: 'Lunch' });
  const sql = openInsertSql();
  // still targets the partial unique index → one open event per agent (Test 5)
  expect(sql).toMatch(/ON CONFLICT \(agent_id\) WHERE ended_at IS NULL/);
  // upgrades in place instead of dropping the coded write (Test 1)
  expect(sql).toMatch(/DO UPDATE SET break_code = EXCLUDED\.break_code, break_name = EXCLUDED\.break_name/);
  // and no longer silently discards on conflict
  expect(sql).not.toMatch(/DO NOTHING/);
  // params still carry the resolved snapshot
  const ins = inserts()[0][1];
  expect(ins[4]).toBe('LUNCH');
  expect(ins[5]).toBe('Lunch');
});

it('Test 2 & 3 & 4: the upgrade is guarded — only NULL→code, same status, never code→NULL', async () => {
  setup({ openSession: { id: 1 }, openEvent: null });
  await handleStatusTransition('alice', 'On Break', 'agent_self', { break_code: 'DINNER', break_name: 'Dinner' });
  const sql = openInsertSql();
  // existing code is never overwritten (guards Test 2 LUNCH-stays and Test 3 DINNER-stays)
  expect(sql).toMatch(/agent_state_events\.break_code IS NULL/);
  // a codeless (NULL) incoming value can never be applied (Test 2/3: fs_event NULL never erases)
  expect(sql).toMatch(/EXCLUDED\.break_code IS NOT NULL/);
  // and the upgrade never crosses statuses (Test 4: Available rows never gain a break code)
  expect(sql).toMatch(/agent_state_events\.status = EXCLUDED\.status/);
});

it('Test 2 (behavioral): codeless fs_event on an existing coded open break is a no-op — code preserved', async () => {
  setup({ openSession: { id: 1 }, openEvent: { id: 9, status: 'On Break', break_code: 'LUNCH' } });
  await handleStatusTransition('alice', 'On Break', 'fs_event'); // no breakInfo (NULL)
  // dedup path: no close, no insert → the persisted LUNCH row is untouched
  expect(closes()).toHaveLength(0);
  expect(inserts()).toHaveLength(0);
});

it('Test 3 (behavioral): a codeless event when DINNER is open leaves DINNER unchanged', async () => {
  setup({ openSession: { id: 1 }, openEvent: { id: 7, status: 'On Break', break_code: 'DINNER' } });
  await handleStatusTransition('alice', 'On Break', 'fs_event'); // NULL
  expect(closes()).toHaveLength(0);
  expect(inserts()).toHaveLength(0);
});
