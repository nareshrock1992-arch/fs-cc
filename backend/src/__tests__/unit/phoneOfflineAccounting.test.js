/**
 * CP3-D — PHONE_OFFLINE break-duration accounting through the EXISTING session
 * writer (agentSessionService.handleStatusTransition), same harness style as
 * agentSessionBreak.test.js.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/phoneOfflineAccounting.test.js
 */
import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/pool.js', () => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  return { pool: { connect: vi.fn().mockResolvedValue(mockClient) }, __mockClient: mockClient };
});

import { __mockClient as client } from '../../../db/pool.js';
import { handleStatusTransition } from '../../../services/agentSessionService.js';

const PO = { break_code: 'PHONE_OFFLINE', break_name: 'Phone offline' };

function setup({ openSession = { id: 1 }, openEvent = null } = {}) {
  client.query.mockImplementation(async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('agent_sessions') && s.includes('logout_at IS NULL') && !s.includes('INSERT INTO') && !s.includes('id, agent_id FROM'))
      return { rows: openSession ? [openSession] : [] };
    if (s.includes('agent_state_events') && s.includes('ended_at IS NULL') && s.startsWith('SELECT'))
      return { rows: openEvent ? [{ session_id: openSession?.id, ...openEvent }] : [] };
    if (s.includes('INSERT INTO agent_sessions') && s.includes('RETURNING id'))
      return { rows: [{ id: openSession?.id ?? 1 }] };
    return { rows: [] };
  });
}
const inserts = () => client.query.mock.calls.filter((c) => /INSERT INTO agent_state_events/.test(c[0]));
const closes = () => client.query.mock.calls.filter((c) => /UPDATE agent_state_events SET\s+ended_at/.test(c[0].replace(/\s+/g, ' ')));

beforeEach(() => { vi.clearAllMocks(); });

it('Available → PHONE_OFFLINE closes the Available segment and opens one coded break segment', async () => {
  setup({ openEvent: { id: 5, status: 'Available', break_code: null } });
  await handleStatusTransition('alice', 'On Break', 'phone_offline', PO);
  expect(closes()).toHaveLength(1);
  expect(closes()[0][1]).toEqual([5]);
  const ins = inserts();
  expect(ins).toHaveLength(1);
  expect(ins[0][1][2]).toBe('On Break');
  expect(ins[0][1][3]).toBe('phone_offline');
  expect(ins[0][1][4]).toBe('PHONE_OFFLINE');
  expect(ins[0][1][5]).toBe('Phone offline');
});

it("FreeSWITCH's echoed codeless 'On Break' after PHONE_OFFLINE is a no-op (no duplicate break record)", async () => {
  setup({ openEvent: { id: 6, status: 'On Break', break_code: 'PHONE_OFFLINE' } });
  await handleStatusTransition('alice', 'On Break', 'fs_event');
  expect(closes()).toHaveLength(0);
  expect(inserts()).toHaveLength(0);
});

it('a second PHONE_OFFLINE on the same open PHONE_OFFLINE segment is a no-op', async () => {
  setup({ openEvent: { id: 6, status: 'On Break', break_code: 'PHONE_OFFLINE' } });
  await handleStatusTransition('alice', 'On Break', 'phone_offline', PO);
  expect(closes()).toHaveLength(0);
  expect(inserts()).toHaveLength(0);
});

it('agent returns Available after recovery → the PHONE_OFFLINE segment is closed (duration recorded by the existing writer)', async () => {
  setup({ openEvent: { id: 6, status: 'On Break', break_code: 'PHONE_OFFLINE' } });
  await handleStatusTransition('alice', 'Available', 'agent_self');
  expect(closes()).toHaveLength(1);
  expect(closes()[0][1]).toEqual([6]);
  expect(inserts()[0][1][2]).toBe('Available');
});
