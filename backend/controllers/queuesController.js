import { query } from '../db/pool.js';
import { cc } from '../services/eslService.js';
import { writeAudit, staffActor } from '../services/auditService.js';

// Activity log (M2 follow-up): the queue settings an admin can change, in a fixed order.
export const QUEUE_AUDIT_FIELDS = ['display_name', 'strategy', 'max_wait_time', 'max_queue_size',
  'agent_no_answer_status', 'sla_seconds', 'active'];
const pickQueue = (row) => Object.fromEntries(QUEUE_AUDIT_FIELDS.map((k) => [k, row?.[k] ?? null]));

/** Only the fields whose value changed; null when nothing changed. */
export function queueChanges(before, after) {
  const oldV = {}, newV = {};
  for (const k of QUEUE_AUDIT_FIELDS) {
    if (JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null)) {
      oldV[k] = before?.[k] ?? null; newV[k] = after?.[k] ?? null;
    }
  }
  return Object.keys(newV).length ? { oldValue: oldV, newValue: newV } : null;
}

// Queue auto-action after max-no-answer → mod_callcenter `agent-no-answer-status`.
// Must be one of the in-scope application statuses (NO "Available (On Demand)").
export const QUEUE_NO_ANSWER_STATUSES = ['Available', 'On Break', 'Logged Out'];

// mod_callcenter tier states settable via `callcenter_config tier set state`.
// Conservative set — UNVERIFIED against the installed FreeSWITCH version
// (LIVE FREESWITCH TEST REQUIRED). Not invented: these are the standard
// admin-settable mod_callcenter tier states.
export const TIER_STATES = ['Ready', 'Standby', 'No Answer'];

export function validateTier({ level, position, state }) {
  const errors = [];
  if (level !== undefined && level !== null && (!Number.isInteger(level) || level < 1 || level > 10)) {
    errors.push('tier level must be an integer between 1 and 10');
  }
  if (position !== undefined && position !== null && (!Number.isInteger(position) || position < 1 || position > 100)) {
    errors.push('tier position must be an integer between 1 and 100');
  }
  if (state !== undefined && state !== null && !TIER_STATES.includes(state)) {
    errors.push(`tier state must be one of: ${TIER_STATES.join(', ')}`);
  }
  return errors;
}

export async function listQueues(req, res) {
  const { rows } = await query(`SELECT * FROM queues ORDER BY display_name ASC`);
  res.json(rows);
}

export async function getQueue(req, res) {
  const { rows } = await query(`SELECT * FROM queues WHERE name = $1`, [req.params.queueName]);
  if (!rows[0]) return res.status(404).json({ error: 'Queue not found' });

  const tiers = await query(
    `SELECT t.level, t.position, a.agent_id, a.full_name, a.status, a.state
     FROM agent_tiers t JOIN agents a ON a.id = t.agent_id
     WHERE t.queue_id = (SELECT id FROM queues WHERE name = $1)
     ORDER BY t.level ASC, t.position ASC`,
    [req.params.queueName]
  );

  res.json({ ...rows[0], agents: tiers.rows });
}
/** Service level target in whole seconds, 1–3600. Returns an error string or null. */
export function validateSlaSeconds(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 3600 ? null : 'slaSeconds must be a whole number of seconds between 1 and 3600';
}

export async function createQueue(req, res) {
  let { name, displayName, strategy = 'longest-idle-agent',
        maxWaitTime = 300, maxQueueSize = 50, mohSound,
        agentNoAnswerStatus = 'On Break', slaSeconds = 20 } = req.body;

  if (!name || !displayName) {
    return res.status(400).json({ error: 'name and displayName are required' });
  }
  const slaErr = validateSlaSeconds(slaSeconds);
  if (slaErr) return res.status(400).json({ error: slaErr });
  if (!QUEUE_NO_ANSWER_STATUSES.includes(agentNoAnswerStatus)) {
    return res.status(400).json({ error: `agentNoAnswerStatus must be one of: ${QUEUE_NO_ANSWER_STATUSES.join(', ')}` });
  }

  // Normalize + sanitize queue name
  if (!name.includes('@')) name = `${name}@default`;
  name = name.replace(/[^a-zA-Z0-9_\-@.]/g, '');

  const { rows } = await query(
    `INSERT INTO queues (name, display_name, strategy, max_wait_time, max_queue_size, moh_sound, agent_no_answer_status, sla_seconds)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6, 'local_stream://moh'),$7,$8) RETURNING *`,
    [name, displayName, strategy, maxWaitTime, maxQueueSize, mohSound, agentNoAnswerStatus, Number(slaSeconds)]
  );

  try {
    await cc.queueAdd(name);
    await cc.queueSetParam(name, 'strategy',      strategy);
    await cc.queueSetParam(name, 'moh-sound',     rows[0].moh_sound);
    await cc.queueSetParam(name, 'max-wait-time', maxWaitTime);
    await cc.queueSetParam(name, 'agent-no-answer-status', agentNoAnswerStatus);
    // max-queue-size is NOT settable via callcenter_config queue set (not a valid FS param)
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on create:', err.message);
  }

  await writeAudit({ ...staffActor(req), action: 'QUEUE_CREATED', entityType: 'queue', entityId: name,
                     newValue: pickQueue(rows[0]) });
  res.status(201).json(rows[0]);
}



export async function updateQueue(req, res) {
  const { queueName } = req.params;
  const { displayName, strategy, maxWaitTime, maxQueueSize, active, agentNoAnswerStatus, slaSeconds } = req.body;
  const slaErr = validateSlaSeconds(slaSeconds);
  if (slaErr) return res.status(400).json({ error: slaErr });

  if (agentNoAnswerStatus !== undefined && !QUEUE_NO_ANSWER_STATUSES.includes(agentNoAnswerStatus)) {
    return res.status(400).json({ error: `agentNoAnswerStatus must be one of: ${QUEUE_NO_ANSWER_STATUSES.join(', ')}` });
  }

  // previous_values: the row as it was, read in the same statement (no extra round trip).
  const { rows } = await query(
    `WITH prev AS (SELECT * FROM queues WHERE name = $1)
     UPDATE queues SET
       display_name = COALESCE($2, display_name),
       strategy = COALESCE($3, strategy),
       max_wait_time = COALESCE($4, max_wait_time),
       max_queue_size = COALESCE($5, max_queue_size),
       active = COALESCE($6, active),
       agent_no_answer_status = COALESCE($7, agent_no_answer_status),
       sla_seconds = COALESCE($8, sla_seconds)
     WHERE name = $1 RETURNING queues.*, (SELECT row_to_json(prev) FROM prev) AS previous_values`,
    [queueName, displayName, strategy, maxWaitTime, maxQueueSize, active, agentNoAnswerStatus ?? null, slaSeconds == null ? null : Number(slaSeconds)]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Queue not found' });

  try {
    if (strategy)                  await cc.queueSetParam(queueName, 'strategy',      strategy);
    if (maxWaitTime !== undefined) await cc.queueSetParam(queueName, 'max-wait-time', maxWaitTime);
    if (agentNoAnswerStatus !== undefined) await cc.queueSetParam(queueName, 'agent-no-answer-status', agentNoAnswerStatus);
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on update:', err.message);
  }

  const { previous_values: before, ...updated } = rows[0];
  const changes = queueChanges(before, updated);
  if (changes) {
    await writeAudit({ ...staffActor(req), action: 'QUEUE_UPDATED', entityType: 'queue', entityId: queueName,
                       oldValue: { display_name: before?.display_name ?? null, ...changes.oldValue },
                       newValue: { display_name: updated.display_name, ...changes.newValue } });
  }
  res.json(updated);
}

export async function deleteQueue(req, res) {
  const { queueName } = req.params;
  const { rows: deleted } = await query(`DELETE FROM queues WHERE name = $1 RETURNING *`, [queueName]);
  if (!deleted?.[0]) return res.status(404).json({ error: 'Queue not found' });
  await writeAudit({ ...staffActor(req), action: 'QUEUE_DELETED', entityType: 'queue', entityId: queueName,
                     oldValue: pickQueue(deleted[0]) });
  try {
    await cc.queueDel(queueName);
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on delete:', err.message);
  }
  res.status(204).end();
}

// ---- Tiers (agent <-> queue assignment) ----

export async function addTier(req, res) {
  const { queueName } = req.params;
  const { agentId, level = 1, position = 1 } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId is required' });

  const tierErrors = validateTier({ level, position });
  if (tierErrors.length) return res.status(400).json({ error: tierErrors.join('; ') });

  const queue = await query(`SELECT id FROM queues WHERE name = $1`, [queueName]);
  const agent = await query(`SELECT id FROM agents WHERE agent_id = $1`, [agentId]);
  if (!queue.rows[0]) return res.status(404).json({ error: 'Queue not found' });
  if (!agent.rows[0]) return res.status(404).json({ error: 'Agent not found' });

  const prevTier = await query(
    `SELECT level, position FROM agent_tiers WHERE agent_id = $1 AND queue_id = $2`,
    [agent.rows[0].id, queue.rows[0].id]
  );
  await query(
    `INSERT INTO agent_tiers (agent_id, queue_id, level, position) VALUES ($1,$2,$3,$4)
     ON CONFLICT (agent_id, queue_id) DO UPDATE SET level = $3, position = $4`,
    [agent.rows[0].id, queue.rows[0].id, level, position]
  );
  const was = prevTier.rows?.[0];
  if (!was) {
    await writeAudit({ ...staffActor(req), action: 'QUEUE_AGENT_ADDED', entityType: 'queue', entityId: queueName,
                       newValue: { agent_id: agentId, level, position } });
  } else if (was.level !== level || was.position !== position) {
    await writeAudit({ ...staffActor(req), action: 'QUEUE_AGENT_UPDATED', entityType: 'queue', entityId: queueName,
                       oldValue: { agent_id: agentId, level: was.level, position: was.position },
                       newValue: { agent_id: agentId, level, position } });
  }

  // FreeSWITCH sync: add (idempotent) then enforce level/position so a re-add of
  // an EXISTING tier still live-updates its level/position (tierAdd alone no-ops).
  let fsSynced = true, fsError = null;
  try {
    await cc.tierAdd(queueName, agentId, level, position);
    await cc.tierSetLevel(queueName, agentId, level);
    await cc.tierSetPosition(queueName, agentId, position);
  } catch (err) {
    fsSynced = false; fsError = err.message;
    console.error('[queues] FreeSWITCH sync failed on tier add:', err.message);
  }

  // DB is saved; fs_synced tells the caller whether FreeSWITCH also updated.
  res.status(201).json({ queueName, agentId, level, position, fs_synced: fsSynced, ...(fsError ? { fs_error: fsError } : {}) });
}

// PUT /:queueName/tiers/:agentId — change tier level / position / state.
// level & position persist to agent_tiers; state is a mod_callcenter RUNTIME
// value (applied via ESL, not persisted — no schema change, no drift).
export async function setTier(req, res) {
  const { queueName, agentId } = req.params;
  const { level, position, state } = req.body;

  const tierErrors = validateTier({ level, position, state });
  if (tierErrors.length) return res.status(400).json({ error: tierErrors.join('; ') });
  if (level === undefined && position === undefined && state === undefined) {
    return res.status(400).json({ error: 'provide at least one of: level, position, state' });
  }

  const queue = await query(`SELECT id FROM queues WHERE name = $1`, [queueName]);
  const agent = await query(`SELECT id FROM agents WHERE agent_id = $1`, [agentId]);
  if (!queue.rows[0]) return res.status(404).json({ error: 'Queue not found' });
  if (!agent.rows[0]) return res.status(404).json({ error: 'Agent not found' });

  // Persist level/position (state is runtime-only).
  if (level !== undefined || position !== undefined) {
    const { rows: tierRows } = await query(
      `WITH prev AS (SELECT level, position FROM agent_tiers WHERE queue_id = $1 AND agent_id = $2)
       UPDATE agent_tiers SET level = COALESCE($3, level), position = COALESCE($4, position)
       WHERE queue_id = $1 AND agent_id = $2
       RETURNING level, position, (SELECT level FROM prev) AS prev_level, (SELECT position FROM prev) AS prev_position`,
      [queue.rows[0].id, agent.rows[0].id, level ?? null, position ?? null]
    );
    const t = tierRows?.[0];
    if (!t) return res.status(404).json({ error: 'Tier not found (agent is not a member of this queue)' });
    if (t.prev_level !== t.level || t.prev_position !== t.position) {
      await writeAudit({ ...staffActor(req), action: 'QUEUE_AGENT_UPDATED', entityType: 'queue', entityId: queueName,
                         oldValue: { agent_id: agentId, level: t.prev_level, position: t.prev_position },
                         newValue: { agent_id: agentId, level: t.level, position: t.position } });
    }
  }
  if (state !== undefined) {
    await writeAudit({ ...staffActor(req), action: 'QUEUE_AGENT_STATE_SET', entityType: 'queue', entityId: queueName,
                       newValue: { agent_id: agentId, state } });
  }

  let fsSynced = true, fsError = null;
  try {
    if (level    !== undefined) await cc.tierSetLevel(queueName, agentId, level);
    if (position !== undefined) await cc.tierSetPosition(queueName, agentId, position);
    if (state    !== undefined) await cc.tierSetState(queueName, agentId, state);   // UNVERIFIED states — see TIER_STATES
  } catch (err) {
    fsSynced = false; fsError = err.message;
    console.error('[queues] FreeSWITCH sync failed on tier set:', err.message);
  }

  res.json({
    queueName, agentId, level, position, state,
    tier_state_persisted: false,   // state is runtime-only
    fs_synced: fsSynced, ...(fsError ? { fs_error: fsError } : {}),
  });
}

export async function removeTier(req, res) {
  const { queueName, agentId } = req.params;
  const queue = await query(`SELECT id FROM queues WHERE name = $1`, [queueName]);
  const agent = await query(`SELECT id FROM agents WHERE agent_id = $1`, [agentId]);
  if (queue.rows[0] && agent.rows[0]) {
    const { rows: removed } = await query(
      `DELETE FROM agent_tiers WHERE queue_id = $1 AND agent_id = $2 RETURNING level, position`,
      [queue.rows[0].id, agent.rows[0].id]
    );
    if (removed?.[0]) {
      await writeAudit({ ...staffActor(req), action: 'QUEUE_AGENT_REMOVED', entityType: 'queue', entityId: queueName,
                         oldValue: { agent_id: agentId, level: removed[0].level, position: removed[0].position } });
    }
  }
  try {
    await cc.tierDel(queueName, agentId);
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on tier del:', err.message);
  }
  res.status(204).end();
}
