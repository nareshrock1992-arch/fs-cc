import { query } from '../db/pool.js';
import { cc } from './eslService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Wrap-up dispositions and notes (M1 / CC-1).
//
// • A disposition is the agent's outcome for an ANSWERED QUEUE call. It lives in
//   call_wrapups; calls.disposition (answered/abandoned/…) is the call state and is
//   never touched here.
// • Codes come from the global disposition_codes catalog. A queue offers the codes
//   assigned to it in queue_disposition_codes; a queue with none assigned offers all
//   active codes. System codes (is_system) are never offered to agents.
// • Wrap-up timing stays with FreeSWITCH mod_callcenter: an agent is offered the next
//   call only when last_bridge_end < now − wrap_up_time. "Ready now" ends wrap-up early
//   by setting this agent's LIVE wrap_up_time to 0 (the only key that affects that
//   check) and moving Idle → Waiting. The configured value (agents.wrap_up_time, never
//   changed here) is pushed back on the agent's next call, status change or logout;
//   a backend restart re-pushes it too (eslService.pushToFreeSWITCH).
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_DISCONNECTED = 'SYSTEM_DISCONNECTED';
export const NOTES_MAX = 2000;
export const WINDOW_HOURS = 24;          // agents may (re)save outcomes for this long
export const SYSTEM_WINDOW_MINUTES = 10; // phone-drop outcome applies to a call this recent
const IN_CALL_STATES = new Set(['Receiving', 'In a queue call']);

// Answered queue calls of this agent inside the window, newest first. Calls that ended
// before this feature was installed (migration 015) are left out, so the first
// deployment does not ask agents for outcomes of old calls. A missing outcome stays
// on the desk across sign-out / sign-in until the window passes.
const RECENT_CALLS_SQL = `
  SELECT c.call_uuid, c.queue_name, c.ani, c.cid_name AS caller_name,
         c.agent_answer_time, c.end_time,
         w.disposition_code, w.disposition_name, w.notes, w.source, w.updated_at AS wrapup_at
    FROM calls c
    LEFT JOIN call_wrapups w ON w.call_uuid = c.call_uuid
   WHERE c.agent_id = $1
     AND c.agent_answer_time IS NOT NULL
     AND c.queue_name IS NOT NULL
     AND COALESCE(c.end_time, c.agent_answer_time) > now() - make_interval(hours => ${WINDOW_HOURS})
     AND COALESCE(c.end_time, now()) >= COALESCE(
           (SELECT min(m.applied_at) FROM schema_migrations m WHERE m.version LIKE '015\\_%'),
           '-infinity'::timestamptz)
   ORDER BY c.agent_answer_time DESC
   LIMIT $2`;

function toWrapup(row) {
  if (!row.disposition_code) return null;
  return { code: row.disposition_code, name: row.disposition_name, notes: row.notes ?? null,
           source: row.source, saved_at: row.wrapup_at ?? null };
}

/** Codes a queue offers to agents (active, non-system; all active when none assigned). */
export async function offeredCodes(queueName) {
  const { rows } = await query(
    `WITH assigned AS (
       SELECT qdc.disposition_code_id AS id
         FROM queue_disposition_codes qdc
         JOIN queues q ON q.id = qdc.queue_id
        WHERE q.name = $1)
     SELECT d.code, d.name, d.description
       FROM disposition_codes d
      WHERE d.active = true AND d.is_system = false
        AND (NOT EXISTS (SELECT 1 FROM assigned) OR d.id IN (SELECT id FROM assigned))
      ORDER BY d.display_order ASC, d.name ASC`,
    [queueName ?? null]
  );
  return rows;
}

/** Recent answered queue calls with their outcome and the codes each one may use. */
export async function recentWrapups(agentId, limit = 10) {
  const { rows } = await query(RECENT_CALLS_SQL, [agentId, limit]);
  const optionsByQueue = new Map();
  const calls = [];
  for (const r of rows) {
    if (!optionsByQueue.has(r.queue_name)) optionsByQueue.set(r.queue_name, await offeredCodes(r.queue_name));
    calls.push({
      call_uuid: r.call_uuid, queue_name: r.queue_name, ani: r.ani, caller_name: r.caller_name,
      answered_at: r.agent_answer_time, ended_at: r.end_time,
      wrapup: toWrapup(r), options: optionsByQueue.get(r.queue_name),
    });
  }
  return calls;
}

function fail(status, error, code) { return { ok: false, status, error, ...(code ? { code } : {}) }; }

/** Validate and save (or replace) the agent's outcome for one of their own calls. */
export async function saveWrapup({ agentId, callUuid, code, notes }) {
  const uuid = String(callUuid ?? '').trim();
  if (!uuid || uuid.length > 64) return fail(400, 'call id is required');
  const dispositionCode = String(code ?? '').trim().toUpperCase();
  if (!dispositionCode) return fail(400, 'Choose an outcome for the call', 'DISPOSITION_REQUIRED');
  let cleanNotes = null;
  if (notes !== undefined && notes !== null) {
    if (typeof notes !== 'string') return fail(400, 'notes must be text');
    cleanNotes = notes.trim() || null;
    if (cleanNotes && cleanNotes.length > NOTES_MAX) return fail(400, `notes must be at most ${NOTES_MAX} characters`);
  }

  const { rows: callRows } = await query(
    `SELECT call_uuid, queue_name, agent_answer_time, end_time,
            COALESCE(end_time, agent_answer_time, start_time) > now() - make_interval(hours => ${WINDOW_HOURS}) AS in_window
       FROM calls WHERE call_uuid = $1 AND agent_id = $2`,
    [uuid, agentId]
  );
  const call = callRows[0];
  if (!call) return fail(404, 'Call not found');
  if (!call.agent_answer_time || !call.queue_name) return fail(409, 'Only answered queue calls take an outcome');
  if (!call.in_window) return fail(409, `Outcomes can be saved for ${WINDOW_HOURS} hours after a call`);

  const option = (await offeredCodes(call.queue_name)).find((o) => o.code === dispositionCode);
  if (!option) return fail(400, 'That outcome is not available for this queue');

  const { rows } = await query(
    `INSERT INTO call_wrapups (call_uuid, agent_id, queue_name, disposition_code, disposition_name, notes, source)
     VALUES ($1,$2,$3,$4,$5,$6,'agent')
     ON CONFLICT (call_uuid) DO UPDATE SET
       agent_id         = EXCLUDED.agent_id,
       disposition_code = EXCLUDED.disposition_code,
       disposition_name = EXCLUDED.disposition_name,
       notes            = EXCLUDED.notes,
       source           = 'agent'
     RETURNING call_uuid, disposition_code, disposition_name, notes, source, updated_at`,
    [uuid, agentId, call.queue_name, option.code, option.name, cleanNotes]
  );
  const w = rows[0];
  return { ok: true, wrapup: { call_uuid: w.call_uuid, code: w.disposition_code, name: w.disposition_name,
                               notes: w.notes, source: w.source, saved_at: w.updated_at } };
}

// agentId -> true while this backend has set the agent's live wrap_up_time to 0.
const overrides = new Map();
export function hasReadyOverride(agentId) { return overrides.has(agentId); }

/** "Ready now": end wrap-up early — only after the latest call's outcome is saved. */
export async function readyNow(agentId) {
  const { rows: agentRows } = await query(
    `SELECT status, state, wrap_up_time FROM agents WHERE agent_id = $1`, [agentId]);
  const agent = agentRows[0];
  if (!agent) return fail(404, 'Agent not found');
  if (agent.status !== 'Available') return fail(409, 'Set yourself Available to take the next call', 'NOT_AVAILABLE');
  if (IN_CALL_STATES.has(agent.state)) return fail(409, 'You are on a call', 'ON_CALL');

  const [latest] = (await query(RECENT_CALLS_SQL, [agentId, 1])).rows;
  if (!latest) return fail(409, 'There is no call to wrap up', 'NO_CALL');
  if (!latest.disposition_code) return fail(409, 'Save the call outcome first', 'DISPOSITION_REQUIRED');

  const wrapUp = Number(agent.wrap_up_time) || 0;
  const endedMs = latest.end_time ? new Date(latest.end_time).getTime() : Date.now();
  if (wrapUp <= 0 || Date.now() - endedMs >= wrapUp * 1000) {
    return { ok: true, alreadyReady: true };                 // FreeSWITCH already ended wrap-up
  }

  try {
    await cc.agentSetParam(agentId, 'wrap_up_time', 0);
  } catch {
    // Nothing changed in FreeSWITCH; wrap-up simply ends on its own timer.
    return fail(503, 'The phone system is not reachable right now. Your next call will be offered when wrap-up time ends.', 'PHONE_SYSTEM_UNAVAILABLE');
  }
  overrides.set(agentId, true);            // only after FreeSWITCH accepted the change
  if (agent.state === 'Idle') {
    try { await cc.agentSetState(agentId, 'Waiting'); } catch { /* wrap_up_time 0 already lets Waiting agents through */ }
  }
  return { ok: true, alreadyReady: false };
}

/** Push the configured wrap_up_time back after a "Ready now" (no-op otherwise). */
export async function restoreWrapUpTime(agentId) {
  if (!overrides.has(agentId)) return false;
  overrides.delete(agentId);
  const { rows } = await query(`SELECT wrap_up_time FROM agents WHERE agent_id = $1`, [agentId]);
  const configured = rows[0]?.wrap_up_time;
  if (configured == null) return false;
  await cc.agentSetParam(agentId, 'wrap_up_time', configured);
  return true;
}

/** ESL hooks: restore on the next call (offer/answer) or any status change. */
export function attachWrapupRestore(ccEvents, logger = console) {
  const restore = (agentId, why) => {
    if (!agentId || !overrides.has(agentId)) return;
    restoreWrapUpTime(agentId)
      .then((done) => done && logger.log(`[wrapup] ${agentId} wrap_up_time restored (${why})`))
      .catch((err) => logger.error(`[wrapup] restore ${agentId}: ${err.message}`));
  };
  ccEvents.on('agent:state', ({ agentId, state }) => { if (IN_CALL_STATES.has(state)) restore(agentId, state); });
  ccEvents.on('agent:status', ({ agentId }) => restore(agentId, 'status change'));
  ccEvents.on('agent:offering', ({ agentId }) => restore(agentId, 'call offered'));
}

/** The agent's phone dropped during their latest call: record the system outcome. */
export async function recordSystemDisconnect(agentId) {
  const { rows: callRows } = await query(
    `SELECT call_uuid, queue_name FROM calls
      WHERE agent_id = $1 AND agent_answer_time IS NOT NULL AND queue_name IS NOT NULL
        AND COALESCE(end_time, now()) > now() - make_interval(mins => ${SYSTEM_WINDOW_MINUTES})
      ORDER BY agent_answer_time DESC LIMIT 1`,
    [agentId]
  );
  const call = callRows[0];
  if (!call) return false;
  const { rows: codeRows } = await query(
    `SELECT name FROM disposition_codes WHERE code = $1`, [SYSTEM_DISCONNECTED]);
  const name = codeRows[0]?.name || 'Disconnected unexpectedly';
  // Never overwrite an outcome the agent already saved.
  const { rows } = await query(
    `INSERT INTO call_wrapups (call_uuid, agent_id, queue_name, disposition_code, disposition_name, source)
     VALUES ($1,$2,$3,$4,$5,'system')
     ON CONFLICT (call_uuid) DO NOTHING
     RETURNING call_uuid`,
    [call.call_uuid, agentId, call.queue_name, SYSTEM_DISCONNECTED, name]
  );
  return rows.length > 0;
}

// Test hook.
export function _resetOverrides() { overrides.clear(); }
