import { query } from '../db/pool.js';
import { cc } from '../services/eslService.js';

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
export async function createQueue(req, res) {
  let { name, displayName, strategy = 'longest-idle-agent',
        maxWaitTime = 300, maxQueueSize = 50, mohSound,
        agentNoAnswerStatus = 'On Break' } = req.body;

  if (!name || !displayName) {
    return res.status(400).json({ error: 'name and displayName are required' });
  }
  if (!QUEUE_NO_ANSWER_STATUSES.includes(agentNoAnswerStatus)) {
    return res.status(400).json({ error: `agentNoAnswerStatus must be one of: ${QUEUE_NO_ANSWER_STATUSES.join(', ')}` });
  }

  // Normalize + sanitize queue name
  if (!name.includes('@')) name = `${name}@default`;
  name = name.replace(/[^a-zA-Z0-9_\-@.]/g, '');

  const { rows } = await query(
    `INSERT INTO queues (name, display_name, strategy, max_wait_time, max_queue_size, moh_sound, agent_no_answer_status)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6, 'local_stream://moh'),$7) RETURNING *`,
    [name, displayName, strategy, maxWaitTime, maxQueueSize, mohSound, agentNoAnswerStatus]
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

  res.status(201).json(rows[0]);
}



export async function updateQueue(req, res) {
  const { queueName } = req.params;
  const { displayName, strategy, maxWaitTime, maxQueueSize, active, agentNoAnswerStatus } = req.body;

  if (agentNoAnswerStatus !== undefined && !QUEUE_NO_ANSWER_STATUSES.includes(agentNoAnswerStatus)) {
    return res.status(400).json({ error: `agentNoAnswerStatus must be one of: ${QUEUE_NO_ANSWER_STATUSES.join(', ')}` });
  }

  const { rows } = await query(
    `UPDATE queues SET
       display_name = COALESCE($2, display_name),
       strategy = COALESCE($3, strategy),
       max_wait_time = COALESCE($4, max_wait_time),
       max_queue_size = COALESCE($5, max_queue_size),
       active = COALESCE($6, active),
       agent_no_answer_status = COALESCE($7, agent_no_answer_status)
     WHERE name = $1 RETURNING *`,
    [queueName, displayName, strategy, maxWaitTime, maxQueueSize, active, agentNoAnswerStatus ?? null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Queue not found' });

  try {
    if (strategy)                  await cc.queueSetParam(queueName, 'strategy',      strategy);
    if (maxWaitTime !== undefined) await cc.queueSetParam(queueName, 'max-wait-time', maxWaitTime);
    if (agentNoAnswerStatus !== undefined) await cc.queueSetParam(queueName, 'agent-no-answer-status', agentNoAnswerStatus);
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on update:', err.message);
  }

  res.json(rows[0]);
}

export async function deleteQueue(req, res) {
  const { queueName } = req.params;
  const { rowCount } = await query(`DELETE FROM queues WHERE name = $1`, [queueName]);
  if (!rowCount) return res.status(404).json({ error: 'Queue not found' });
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

  await query(
    `INSERT INTO agent_tiers (agent_id, queue_id, level, position) VALUES ($1,$2,$3,$4)
     ON CONFLICT (agent_id, queue_id) DO UPDATE SET level = $3, position = $4`,
    [agent.rows[0].id, queue.rows[0].id, level, position]
  );

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
    const { rowCount } = await query(
      `UPDATE agent_tiers SET level = COALESCE($3, level), position = COALESCE($4, position)
       WHERE queue_id = $1 AND agent_id = $2`,
      [queue.rows[0].id, agent.rows[0].id, level ?? null, position ?? null]
    );
    if (!rowCount) return res.status(404).json({ error: 'Tier not found (agent is not a member of this queue)' });
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
    await query(`DELETE FROM agent_tiers WHERE queue_id = $1 AND agent_id = $2`, [
      queue.rows[0].id,
      agent.rows[0].id
    ]);
  }
  try {
    await cc.tierDel(queueName, agentId);
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on tier del:', err.message);
  }
  res.status(204).end();
}
