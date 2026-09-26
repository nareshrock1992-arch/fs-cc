/**
 * Session/state lifecycle tests for agentSessionService — the fix for the Live
 * Agents timer carrying a previous session's duration.
 *
 * Verifies: login reconciliation (startLoginSession) closes stale session/event
 * and opens a fresh session; handleStatusTransition is session-scoped (never
 * dedups against an event from a different session); logout closes both;
 * same-session dedup and different-status transitions still work.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/agentSessionLifecycle.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/pool.js', () => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  return { pool: { connect: vi.fn().mockResolvedValue(mockClient) }, __mockClient: mockClient };
});

import { __mockClient as client } from '../../../db/pool.js';
import { handleStatusTransition, startLoginSession } from '../../../services/agentSessionService.js';

// openSession = the current open agent_sessions row (or null)
// openEvent   = the current open agent_state_events row (or null); include session_id
function setup({ openSession = null, openEvent = null, newSessionId = 99 } = {}) {
  client.query.mockImplementation(async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT id, login_at FROM agent_sessions') || (s.includes('agent_sessions') && s.includes('logout_at IS NULL') && s.startsWith('SELECT id, login_at')))
      return { rows: openSession ? [openSession] : [] };
    if (s.includes('agent_state_events') && s.includes('ended_at IS NULL') && s.startsWith('SELECT'))
      return { rows: openEvent ? [openEvent] : [] };
    if (s.includes('INSERT INTO agent_sessions') && s.includes('RETURNING id'))
      return { rows: [{ id: newSessionId }] };
    return { rows: [] };
  });
}

const norm = c => c[0].replace(/\s+/g, ' ');
const closeEvents   = () => client.query.mock.calls.filter(c => /UPDATE agent_state_events SET ended_at/.test(norm(c)));
const closeSessions = () => client.query.mock.calls.filter(c => /UPDATE agent_sessions SET logout_at/.test(norm(c)));
const openEvents    = () => client.query.mock.calls.filter(c => /INSERT INTO agent_state_events/.test(norm(c)));
const newSessions   = () => client.query.mock.calls.filter(c => /INSERT INTO agent_sessions/.test(norm(c)));
const commits       = () => client.query.mock.calls.filter(c => /^COMMIT/.test(norm(c).trim()));
const locks         = () => client.query.mock.calls.filter(c => /pg_advisory_xact_lock/.test(norm(c)));

beforeEach(() => { vi.clearAllMocks(); });

describe('startLoginSession — session boundary at login', () => {
  it('unclean re-login: closes the stale open event + stale session, opens a NEW session', async () => {
    setup({ openSession: { id: 1, login_at: 't0' }, openEvent: { id: 9, status: 'Available', session_id: 1 }, newSessionId: 77 });
    const id = await startLoginSession('alice');
    expect(closeEvents()).toHaveLength(1);                 // stale E1 closed
    expect(closeSessions()).toHaveLength(1);               // stale S1 closed
    expect(closeSessions()[0][1]).toEqual([1, 'relogin']); // with duration + reason
    expect(newSessions()).toHaveLength(1);                 // fresh session created
    expect(id).toBe(77);
    expect(locks()).toHaveLength(1);                       // per-agent advisory lock
  });

  it('clean login (no stale state): just opens a new session', async () => {
    setup({ openSession: null, openEvent: null, newSessionId: 50 });
    const id = await startLoginSession('alice');
    expect(closeEvents()).toHaveLength(0);
    expect(closeSessions()).toHaveLength(0);
    expect(newSessions()).toHaveLength(1);
    expect(id).toBe(50);
  });
});

describe('handleStatusTransition — session-scoped', () => {
  it('stale S1 event + current S2 → Available: closes the cross-session event and opens a fresh one (NOT a no-op)', async () => {
    setup({ openSession: { id: 2, login_at: 't' }, openEvent: { id: 9, status: 'Available', session_id: 1 } });
    await handleStatusTransition('alice', 'Available', 'agent_self');
    expect(closeEvents()).toHaveLength(1);   // E1 (session 1) closed
    expect(openEvents()).toHaveLength(1);     // fresh Available opened in session 2
    expect(commits()).toHaveLength(1);
  });

  it('same session + same status → no-op (true duplicate)', async () => {
    setup({ openSession: { id: 2, login_at: 't' }, openEvent: { id: 9, status: 'Available', session_id: 2 } });
    await handleStatusTransition('alice', 'Available', 'fs_event');
    expect(closeEvents()).toHaveLength(0);
    expect(openEvents()).toHaveLength(0);
    expect(commits()).toHaveLength(1);
  });

  it('Available → On Break (same session, different status): closes then opens', async () => {
    setup({ openSession: { id: 2, login_at: 't' }, openEvent: { id: 9, status: 'Available', session_id: 2 } });
    await handleStatusTransition('alice', 'On Break', 'agent_self');
    expect(closeEvents()).toHaveLength(1);
    expect(openEvents()).toHaveLength(1);
    expect(openEvents()[0][1][2]).toBe('On Break');
  });

  it('Logged Out: closes the open event AND the open session', async () => {
    setup({ openSession: { id: 2, login_at: 't' }, openEvent: { id: 9, status: 'Available', session_id: 2 } });
    await handleStatusTransition('alice', 'Logged Out', 'agent_self');
    expect(closeEvents()).toHaveLength(1);
    expect(closeSessions()).toHaveLength(1);
    expect(openEvents()).toHaveLength(0);
  });

  it('every transition takes the per-agent advisory lock inside a transaction', async () => {
    setup({ openSession: { id: 2, login_at: 't' }, openEvent: null });
    await handleStatusTransition('alice', 'Available', 'agent_self');
    expect(locks()).toHaveLength(1);
    expect(commits()).toHaveLength(1);
  });
});
