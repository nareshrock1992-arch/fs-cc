import { pool } from '../db/pool.js';

// ─────────────────────────────────────────────────────────────────────────────
// Agent Session Service
//
// Maintains two tables:
//   agent_sessions      — one row per contiguous login period
//   agent_state_events  — one row per contiguous status segment (Available | On Break)
//
// State machine (per agent):
//   NO_SESSION  ──[Available|On Break]──►  ACTIVE (session + state event opened)
//   ACTIVE      ──[same status]──────────►  ACTIVE (dedup: no-op)
//   ACTIVE      ──[different status, non-Logout]──► ACTIVE (close event, open new)
//   ACTIVE      ──[Logged Out]──────────►  NO_SESSION (close event + session)
//
// Deduplication rule:
//   If the currently open agent_state_events row already has status == newStatus,
//   the call is a no-op regardless of source or elapsed time. This silently
//   absorbs the duplicate that arrives when both the REST handler and the
//   FreeSWITCH ESL event fire for the same user action within ~200ms.
//
// Every transition (and login reconciliation) runs inside a transaction guarded
// by a per-agent advisory lock (pg_advisory_xact_lock), so the check-then-act
// sequence is atomic even across concurrent requests / processes. State events
// are session-scoped: an open event is only ever a "duplicate" within its own
// session — a stale event from a previous login is closed, never reused.
// ─────────────────────────────────────────────────────────────────────────────

// ── Internal helpers ─────────────────────────────────────────────────────────

async function getOpenSession(client, agentId) {
  const { rows } = await client.query(
    `SELECT id, login_at FROM agent_sessions
     WHERE agent_id = $1 AND logout_at IS NULL
     LIMIT 1`,
    [agentId]
  );
  return rows[0] || null;
}

async function getOpenEvent(client, agentId) {
  const { rows } = await client.query(
    `SELECT id, status, started_at, break_code, session_id FROM agent_state_events
     WHERE agent_id = $1 AND ended_at IS NULL
     LIMIT 1`,
    [agentId]
  );
  return rows[0] || null;
}

async function openSession(client, agentId) {
  // ON CONFLICT handles the race where two concurrent status events (e.g. agent_self
  // from the REST handler + fs_event from ESL ~200ms later) both see no open session
  // and both try to INSERT.  If the conflict fires, the UNION ALL falls through to
  // SELECT so we always return a valid session id.
  const { rows } = await client.query(
    `WITH ins AS (
       INSERT INTO agent_sessions (agent_id, login_at)
       VALUES ($1, now())
       ON CONFLICT (agent_id) WHERE logout_at IS NULL DO NOTHING
       RETURNING id
     )
     SELECT id FROM ins
     UNION ALL
     SELECT id FROM agent_sessions
       WHERE agent_id = $1 AND logout_at IS NULL
     LIMIT 1`,
    [agentId]
  );
  return rows[0].id;
}

async function closeSession(client, sessionId, reason) {
  await client.query(
    `UPDATE agent_sessions
     SET logout_at        = now(),
         duration_seconds = EXTRACT(EPOCH FROM (now() - login_at))::INT,
         logout_reason    = $2
     WHERE id = $1`,
    [sessionId, reason]
  );
}

async function openEvent(client, agentId, sessionId, status, source, breakInfo = null) {
  // ON CONFLICT handles the same dual-trigger race as openSession.
  // idx_ase_one_open (partial: agent_id WHERE ended_at IS NULL) enforces at most
  // one open event per agent.
  //
  // break_code / break_name are snapshotted here (only meaningful when
  // status === 'On Break' and the caller supplied a resolved break code).
  // The snapshot is intentionally frozen: historical rows keep the name that
  // was configured at break time, even if the code is later renamed/disabled.
  //
  // Race fix (break codes): the agent_self transition carries the break code,
  // while the FreeSWITCH echo (fs_event, ~200ms later) carries none. Both open
  // the single On Break segment; whichever INSERT commits first wins. With the
  // old DO NOTHING, when the codeless fs_event won, the coded agent_self INSERT
  // was silently dropped and the persisted history row kept break_code = NULL.
  // We now DO UPDATE to *upgrade* a codeless open row with a supplied code — but
  // only NULL → code, never code → NULL and never across statuses, so a codeless
  // fs_event can never erase an existing snapshot and the one-open-event
  // invariant is preserved.
  const breakCode = status === 'On Break' ? (breakInfo?.break_code ?? null) : null;
  const breakName = status === 'On Break' ? (breakInfo?.break_name ?? null) : null;
  await client.query(
    `INSERT INTO agent_state_events
       (agent_id, session_id, status, started_at, source, break_code, break_name)
     VALUES ($1, $2, $3, now(), $4, $5, $6)
     ON CONFLICT (agent_id) WHERE ended_at IS NULL
     DO UPDATE SET
       break_code = EXCLUDED.break_code,
       break_name = EXCLUDED.break_name
     WHERE agent_state_events.status      = EXCLUDED.status
       AND agent_state_events.break_code IS NULL
       AND EXCLUDED.break_code           IS NOT NULL`,
    [agentId, sessionId, status, source, breakCode, breakName]
  );
}

async function closeEvent(client, eventId) {
  await client.query(
    `UPDATE agent_state_events
     SET ended_at         = now(),
         duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::INT
     WHERE id = $1`,
    [eventId]
  );
}

// ── Public: handle a single status transition ────────────────────────────────

/**
 * Process one agent status change from any source.
 *
 * @param {string} agentId   - FreeSWITCH agent name (e.g. 'alice@domain')
 * @param {string} newStatus - 'Available' | 'On Break' | 'Logged Out'
 * @param {string} source    - 'fs_event' | 'agent_self' | 'manual'
 * @param {{break_code: string, break_name: string}|null} [breakInfo]
 *        Optional resolved break code + snapshot name. Only meaningful when
 *        newStatus === 'On Break'. Omitted by the FreeSWITCH / reconciliation
 *        paths (which have no break reason) — those keep the existing behavior.
 */
export async function handleStatusTransition(agentId, newStatus, source, breakInfo = null) {
  const client = await pool.connect();
  try {
    // Serialize all transitions for this agent (login/logout/status/fs_event/manual)
    // so the read-decide-write sequence is atomic, and wrap it in a transaction.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [agentId]);

    const openSession_ = await getOpenSession(client, agentId);
    const openEvent_   = await getOpenEvent(client, agentId);

    if (newStatus === 'Logged Out') {
      if (openEvent_)   await closeEvent(client, openEvent_.id);
      if (openSession_) await closeSession(client, openSession_.id, source);
      await client.query('COMMIT');
      return;
    }

    // newStatus is 'Available' or 'On Break' — ensure a current session exists.
    const sessionId = openSession_ ? openSession_.id : await openSession(client, agentId);

    // Session-scoped dedup: a no-op ONLY when the open event belongs to the
    // CURRENT session AND has the same status. An open event from a previous
    // session (e.g. an unclean logout that left it open) is NEVER treated as a
    // duplicate — it is closed and a fresh event is opened in the current
    // session, so the live timer anchors to this session, not the old one.
    if (openEvent_ && openEvent_.status === newStatus && openEvent_.session_id === sessionId) {
      // Special case: an explicit NEW break code closes the old break segment and
      // opens a fresh one so each break reason is a distinct history row.
      const switchingReason =
        newStatus === 'On Break' &&
        breakInfo?.break_code &&
        breakInfo.break_code !== openEvent_.break_code;
      if (!switchingReason) { await client.query('COMMIT'); return; }
      await closeEvent(client, openEvent_.id);
      await openEvent(client, agentId, sessionId, newStatus, source, breakInfo);
      await client.query('COMMIT');
      return;
    }

    // Different status, cross-session, or stale open event → close it, then open
    // a fresh event bound to the current session.
    if (openEvent_) await closeEvent(client, openEvent_.id);
    await openEvent(client, agentId, sessionId, newStatus, source, breakInfo);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Establish a fresh session boundary at agent login. Atomically (per-agent
 * advisory lock + transaction) closes any stale open state event and stale open
 * session left behind by an unclean logout (browser close, crash, network
 * loss), then opens a brand-new session. This guarantees every login starts a
 * distinct session and the previous session's state timer can never carry over.
 * Stale rows are properly closed (ended_at/logout_at + duration) so historical
 * reporting stops at the abandoned session.
 *
 * @returns {Promise<number>} the new session id
 */
export async function startLoginSession(agentId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [agentId]);

    const openEvent_   = await getOpenEvent(client, agentId);
    if (openEvent_) await closeEvent(client, openEvent_.id);
    const openSession_ = await getOpenSession(client, agentId);
    if (openSession_) await closeSession(client, openSession_.id, 'relogin');

    const { rows } = await client.query(
      `INSERT INTO agent_sessions (agent_id, login_at) VALUES ($1, now()) RETURNING id`,
      [agentId]
    );
    await client.query('COMMIT');
    return rows[0].id;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── Public: startup reconciliation ──────────────────────────────────────────

/**
 * Called once after ESL reconnects and cc.agentList() succeeds.
 * Closes open sessions for agents that FreeSWITCH reports as Logged Out
 * or that are absent from the FS agent list (removed from FS).
 * If agentList() threw (ESL unavailable), this function must NOT be called —
 * the caller is responsible for guarding.
 *
 * @param {Array<{name: string, status: string}>} agentList - result of cc.agentList()
 */
export async function reconcileOnStartup(agentList) {
  // Build a map from agentId → FS-reported status
  const fsMap = new Map();
  for (const a of agentList) {
    if (a.name) fsMap.set(a.name, a.status || 'Logged Out');
  }

  // Find all agents with open sessions
  const client = await pool.connect();
  try {
    const { rows: openSessions } = await client.query(
      `SELECT id, agent_id FROM agent_sessions WHERE logout_at IS NULL`
    );

    for (const session of openSessions) {
      const { id: sessionId, agent_id: agentId } = session;
      const fsStatus = fsMap.get(agentId);

      if (fsStatus === 'Logged Out' || fsStatus === undefined) {
        // Agent is logged out in FS or was removed — close the session
        const openEvent_ = await getOpenEvent(client, agentId);
        if (openEvent_) {
          await closeEvent(client, openEvent_.id);
        }
        await closeSession(client, sessionId, 'reconciliation');
        console.log(`[sessions] reconciled: ${agentId} closed (FS status: ${fsStatus ?? 'absent'})`);

      } else {
        // Agent is still active — check if open event status matches FS
        const openEvent_ = await getOpenEvent(client, agentId);

        if (!openEvent_) {
          // No open event — open one matching current FS status
          await openEvent(client, agentId, sessionId, fsStatus, 'reconciliation');
          console.log(`[sessions] reconciled: ${agentId} re-opened ${fsStatus} event`);

        } else if (openEvent_.status !== fsStatus) {
          // FS shows different status than what was open before restart
          // (missed a status change during the restart window)
          await closeEvent(client, openEvent_.id);
          await openEvent(client, agentId, sessionId, fsStatus, 'reconciliation');
          console.log(`[sessions] reconciled: ${agentId} corrected ${openEvent_.status} → ${fsStatus}`);
        }
        // openEvent_.status === fsStatus → no change needed
      }
    }
  } finally {
    client.release();
  }
}
