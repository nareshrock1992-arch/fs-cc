import { query } from '../db/pool.js';
import { cc, isConnected } from '../services/eslService.js';
import { config } from '../config/index.js';
import * as agentSession from '../services/agentSessionService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Contact builder — single canonical location for PAI prefix enforcement
// ─────────────────────────────────────────────────────────────────────────────

// Every mod_callcenter agent contact that should carry P-Asserted-Identity must
// start with {sip_cid_type=pid}.  This causes FreeSWITCH sofia to generate the
// PAI header from effective_caller_id_name/number on the B-leg INVITE.
//
// Two endpoint types are supported:
//
//   internal — SIP user registered on the FreeSWITCH internal profile:
//     {sip_cid_type=pid}user/<extension>@<FS_SIP_DOMAIN>
//
//   gateway  — SIP call via a named gateway:
//     {sip_cid_type=pid}sofia/gateway/<gateway>/<destination>
//
// The function is deterministic and idempotent:
//   - Calling it twice with the same inputs produces the same output.
//   - An input that already contains {sip_cid_type=pid} is not double-prefixed.
export function buildContact({ agentType, extension, gateway, destination, contact, ringTimeout }) {
  // The channel-var block always carries sip_cid_type=pid (PAI). A per-agent ring
  // timeout is added as leg_timeout=<seconds> in the SAME block (never a second
  // block, so PAI is never duplicated). ringTimeout null/absent → no leg_timeout,
  // i.e. exactly the previous behaviour (backward compatible).
  const rt = (ringTimeout === undefined || ringTimeout === null || ringTimeout === '')
    ? null
    : Number(ringTimeout);
  const PREFIX = rt ? `{sip_cid_type=pid,leg_timeout=${rt}}` : '{sip_cid_type=pid}';

  if (agentType === 'internal') {
    if (!extension || !String(extension).trim()) {
      throw Object.assign(new Error('extension is required for internal agents'), { status: 400 });
    }
    const sipDomain = config.fs.sipDomain;
    if (!sipDomain) {
      throw Object.assign(
        new Error('FS_SIP_DOMAIN is not configured — cannot build internal agent contact'),
        { status: 500 }
      );
    }
    return `${PREFIX}user/${String(extension).trim()}@${sipDomain}`;
  }

  if (agentType === 'gateway') {
    if (!gateway || !String(gateway).trim()) {
      throw Object.assign(new Error('gateway is required for gateway agents'), { status: 400 });
    }
    if (!destination || !String(destination).trim()) {
      throw Object.assign(new Error('destination is required for gateway agents'), { status: 400 });
    }
    return `${PREFIX}sofia/gateway/${String(gateway).trim()}/${String(destination).trim()}`;
  }

  // Legacy / direct-contact path: caller supplied a raw contact string.
  // Normalize by stripping any existing {key=val} prefix blocks (idempotent),
  // then prepend the canonical prefix.
  if (contact && String(contact).trim()) {
    const raw     = String(contact).trim();
    const stripped = raw.replace(/^(\{[^}]*\})+/, '');
    return `${PREFIX}${stripped}`;
  }

  throw Object.assign(
    new Error('agentType (internal|gateway) or contact string is required'),
    { status: 400 }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Config validation — additive; rejects invalid values with HTTP 400.
//   fs_agent_type : FreeSWITCH mod_callcenter agent type (callback | uuid-standby)
//                   — DISTINCT from agents.agent_type (internal | gateway endpoint).
//   ring_timeout  : NULL (no per-agent override) or 1..600 seconds (matches the DB CHECK).
//   timing fields : non-negative integers.
// ─────────────────────────────────────────────────────────────────────────────
export const FS_AGENT_TYPES = ['callback', 'uuid-standby'];

export function validateAgentConfig({
  fsAgentType, ringTimeout,
  maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, noAnswerDelayTime,
}) {
  const errors = [];
  if (fsAgentType !== undefined && fsAgentType !== null && !FS_AGENT_TYPES.includes(fsAgentType)) {
    errors.push(`fs_agent_type must be one of: ${FS_AGENT_TYPES.join(', ')}`);
  }
  if (ringTimeout !== undefined && ringTimeout !== null && ringTimeout !== '') {
    if (!Number.isInteger(ringTimeout) || ringTimeout < 1 || ringTimeout > 600) {
      errors.push('ring_timeout must be an integer between 1 and 600 (or null for no override)');
    }
  }
  const timing = { maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, noAnswerDelayTime };
  for (const [k, v] of Object.entries(timing)) {
    if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0 || v > 86400)) {
      errors.push(`${k} must be a non-negative integer (0..86400)`);
    }
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agents CRUD
// ─────────────────────────────────────────────────────────────────────────────

// Returns all agents with their assigned queues in a `queues` array
export async function listAgents(req, res) {
  const { rows } = await query(`
    SELECT
      a.id,
      a.agent_id,
      a.full_name,
      a.avaya_extension,
      a.agent_type,
      a.fs_agent_type,
      a.contact,
      a.status,
      a.state,
      a.max_no_answer,
      a.wrap_up_time,
      a.reject_delay_time,
      a.busy_delay_time,
      a.no_answer_delay_time,
      a.ring_timeout,
      a.active,
      a.created_at,
      a.updated_at,
      (a.pin_hash IS NOT NULL) AS pin_hash,   -- boolean: does an Agent Desktop PIN exist?
      ase.started_at           AS status_since, -- start of the current status segment (for idle timer)
      COALESCE(
        json_agg(
          json_build_object(
            'queue',    q.name,
            'level',    t.level,
            'position', t.position
          )
        ) FILTER (WHERE q.id IS NOT NULL),
        '[]'
      ) AS queues
    FROM agents a
    LEFT JOIN agent_tiers t ON t.agent_id = a.id
    LEFT JOIN queues q       ON q.id       = t.queue_id
    LEFT JOIN LATERAL (
      SELECT started_at
      FROM   agent_state_events
      WHERE  agent_id = a.agent_id AND ended_at IS NULL
      LIMIT  1
    ) ase ON true
    GROUP BY a.id, ase.started_at
    ORDER BY a.full_name ASC
  `);
  res.json(rows);
}

export async function getAgent(req, res) {
  const { rows } = await query(`SELECT * FROM agents WHERE agent_id = $1`, [req.params.agentId]);
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });
  res.json(rows[0]);
}

export async function getAgentHistory(req, res) {
  const { agentId } = req.params;
  const { rows } = await query(
    `SELECT * FROM agent_state_log WHERE agent_id = $1 ORDER BY changed_at DESC LIMIT 200`,
    [agentId]
  );
  res.json(rows);
}

// GET /api/agents/:agentId/live — LIVE FreeSWITCH snapshot for one agent.
// Runtime only (never historical). Degrades gracefully when ESL is offline or
// the agent is not present in FreeSWITCH: 200 with { live: null, esl_connected }.
export async function getAgentLive(req, res) {
  const { agentId } = req.params;
  const { rows } = await query(`SELECT agent_id FROM agents WHERE agent_id = $1`, [agentId]);
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });

  if (!isConnected()) {
    return res.json({ agent_id: agentId, esl_connected: false, live: null });
  }
  try {
    const live = await cc.agentLive(agentId);
    res.json({ agent_id: agentId, esl_connected: true, live });
  } catch (err) {
    console.error('[agents] live read failed:', err.message);
    res.json({ agent_id: agentId, esl_connected: false, live: null, error: 'live read failed' });
  }
}

export async function createAgent(req, res) {
  const {
    agentId,
    fullName,
    avayaExtension,
    // Structured fields (preferred)
    agentType,
    extension,
    gateway,
    destination,
    // Legacy raw contact (still accepted; normalized server-side)
    contact: rawContact,
    // FreeSWITCH mod_callcenter agent type (distinct from agent_type endpoint kind)
    fsAgentType    = 'callback',
    ringTimeout    = null,
    // Call behavior
    maxNoAnswer    = 3,
    wrapUpTime     = 20,
    rejectDelayTime = 2,
    busyDelayTime   = 60,
    noAnswerDelayTime = 10
  } = req.body;

  if (!agentId || !fullName || !avayaExtension) {
    return res.status(400).json({ error: 'agentId, fullName, and avayaExtension are required' });
  }

  const cfgErrors = validateAgentConfig({
    fsAgentType, ringTimeout, maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, noAnswerDelayTime,
  });
  if (cfgErrors.length) return res.status(400).json({ error: cfgErrors.join('; ') });

  let builtContact;
  try {
    builtContact = buildContact({ agentType, extension, gateway, destination, contact: rawContact, ringTimeout });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const resolvedType = agentType || (rawContact && rawContact.includes('sofia/gateway') ? 'gateway' : 'internal');

  const { rows } = await query(
    `INSERT INTO agents
       (agent_id, full_name, avaya_extension, agent_type, fs_agent_type, contact,
        max_no_answer, wrap_up_time, reject_delay_time, busy_delay_time,
        no_answer_delay_time, ring_timeout)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [agentId, fullName, avayaExtension, resolvedType, fsAgentType, builtContact,
     maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime,
     noAnswerDelayTime, (ringTimeout === '' ? null : ringTimeout)]
  );

  try {
    // fs_agent_type is honored at agent-add time (mod_callcenter sets type on add).
    await cc.agentAdd(agentId, builtContact, fsAgentType);
    await cc.agentSetParam(agentId, 'max_no_answer',        maxNoAnswer);
    await cc.agentSetParam(agentId, 'wrap_up_time',         wrapUpTime);
    await cc.agentSetParam(agentId, 'reject_delay_time',    rejectDelayTime);
    await cc.agentSetParam(agentId, 'busy_delay_time',      busyDelayTime);
    await cc.agentSetParam(agentId, 'no_answer_delay_time', noAnswerDelayTime);
  } catch (err) {
    console.error('[agents] FreeSWITCH sync failed on create:', err.message);
  }

  res.status(201).json(rows[0]);
}

export async function updateAgent(req, res) {
  const { agentId } = req.params;
  const {
    fullName, avayaExtension,
    // Structured fields
    agentType,
    extension,
    gateway,
    destination,
    // Legacy raw contact
    contact: rawContact,
    // FreeSWITCH agent type + per-agent ring timeout
    fsAgentType, ringTimeout,
    // Call behavior
    maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, noAnswerDelayTime, active
  } = req.body;

  const cfgErrors = validateAgentConfig({
    fsAgentType, ringTimeout, maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, noAnswerDelayTime,
  });
  if (cfgErrors.length) return res.status(400).json({ error: cfgErrors.join('; ') });

  // Build normalized contact when contact-related fields OR ring_timeout change.
  // Ring-only change: rebuild from the CURRENT stored contact (buildContact's
  // legacy path strips the old {…} block and re-prefixes), preserving the exact
  // endpoint + PAI while updating leg_timeout. Never duplicates PAI.
  let builtContact = undefined;
  const hasContactChange = agentType || extension || gateway || destination || rawContact;
  const ringTimeoutProvided = Object.prototype.hasOwnProperty.call(req.body, 'ringTimeout');
  if (hasContactChange) {
    try {
      builtContact = buildContact({ agentType, extension, gateway, destination, contact: rawContact, ringTimeout });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  } else if (ringTimeoutProvided) {
    const cur = await query(`SELECT contact FROM agents WHERE agent_id = $1`, [agentId]);
    if (cur.rows[0]?.contact) {
      builtContact = buildContact({ contact: cur.rows[0].contact, ringTimeout });
    }
  }

  const normRingTimeout = ringTimeout === '' ? null : ringTimeout;
  const { rows } = await query(
    `UPDATE agents SET
       full_name            = COALESCE($2, full_name),
       avaya_extension      = COALESCE($3, avaya_extension),
       agent_type           = COALESCE($4, agent_type),
       contact              = COALESCE($5, contact),
       max_no_answer        = COALESCE($6, max_no_answer),
       wrap_up_time         = COALESCE($7, wrap_up_time),
       reject_delay_time    = COALESCE($8, reject_delay_time),
       busy_delay_time      = COALESCE($9, busy_delay_time),
       active               = COALESCE($10, active),
       fs_agent_type        = COALESCE($11, fs_agent_type),
       no_answer_delay_time = COALESCE($12, no_answer_delay_time),
       -- ring_timeout is nullable-with-meaning: only overwrite when the key was
       -- present in the request body (so an omitted field never wipes it, and an
       -- explicit null clears the override).
       ring_timeout         = CASE WHEN $14::bool THEN $13 ELSE ring_timeout END
     WHERE agent_id = $1
     RETURNING *`,
    [agentId, fullName, avayaExtension,
     agentType || null, builtContact || null,
     maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, active,
     fsAgentType || null, noAnswerDelayTime,
     normRingTimeout, Object.prototype.hasOwnProperty.call(req.body, 'ringTimeout')]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });

  try {
    if (builtContact)                    await cc.agentSetParam(agentId, 'contact',              builtContact);
    if (maxNoAnswer      !== undefined)  await cc.agentSetParam(agentId, 'max_no_answer',        maxNoAnswer);
    if (wrapUpTime       !== undefined)  await cc.agentSetParam(agentId, 'wrap_up_time',         wrapUpTime);
    if (rejectDelayTime  !== undefined)  await cc.agentSetParam(agentId, 'reject_delay_time',    rejectDelayTime);
    if (busyDelayTime    !== undefined)  await cc.agentSetParam(agentId, 'busy_delay_time',      busyDelayTime);
    if (noAnswerDelayTime !== undefined) await cc.agentSetParam(agentId, 'no_answer_delay_time', noAnswerDelayTime);
    // NOTE: fs_agent_type and ring_timeout are NOT live-settable via `agent set`
    // (mod_callcenter fixes type at add-time; ring_timeout is applied via the
    // agent contact channel var). They persist to the DB now and are applied to
    // FreeSWITCH on contact rebuild / XML regen — Phases 3–5.
  } catch (err) {
    console.error('[agents] FreeSWITCH sync failed on update:', err.message);
  }

  res.json(rows[0]);
}

export async function deleteAgent(req, res) {
  const { agentId } = req.params;
  const { rowCount } = await query(`DELETE FROM agents WHERE agent_id = $1`, [agentId]);
  if (!rowCount) return res.status(404).json({ error: 'Agent not found' });
  try {
    await cc.agentDel(agentId);
  } catch (err) {
    console.error('[agents] FreeSWITCH sync failed on delete:', err.message);
  }
  res.status(204).end();
}

const VALID_STATUSES = ['Available', 'On Break', 'Logged Out'];
const VALID_STATES   = ['Waiting', 'Receiving', 'In a queue call'];

export async function setAgentStatus(req, res) {
  const { agentId } = req.params;
  const { status }  = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  try { await cc.agentSetStatus(agentId, status); } catch (e) { /* ESL offline */ }
  // Admin-forced status changes carry no break reason. Keep the agent's current
  // break_code / break_started_at consistent: cleared unless forced On Break.
  await query(
    `UPDATE agents
        SET status           = $2,
            break_code       = NULL,
            break_started_at = CASE WHEN $2 = 'On Break' THEN now() ELSE NULL END
      WHERE agent_id = $1`,
    [agentId, status]
  );
  await query(
    `INSERT INTO agent_state_log (agent_id, status, reason) VALUES ($1,$2,'manual')`,
    [agentId, status]
  );
  try { await agentSession.handleStatusTransition(agentId, status, 'manual'); }
  catch (err) { console.error('[sessions] setAgentStatus transition failed:', err.message); }
  res.json({ agentId, status });
}

export async function setAgentState(req, res) {
  const { agentId } = req.params;
  const { state }   = req.body;
  if (!VALID_STATES.includes(state)) {
    return res.status(400).json({ error: `state must be one of: ${VALID_STATES.join(', ')}` });
  }
  try { await cc.agentSetState(agentId, state); } catch (e) { /* ESL offline */ }
  await query(`UPDATE agents SET state = $2 WHERE agent_id = $1`, [agentId, state]);
  res.json({ agentId, state });
}
