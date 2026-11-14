// Supervisor call control (BUG-007).
// POST /api/calls/:callUuid/force-hangup — ends a call that is stuck in FreeSWITCH
// (e.g. an agent's held browser-phone leg that was never hung up) without
// restarting FreeSWITCH. Supervisor/admin only; every attempt is audited.
// Uses only the standard ESL command `uuid_kill`; no configuration change.
import { query } from '../db/pool.js';
import { eslApi, cc } from '../services/eslService.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/**
 * FreeSWITCH channels that belong to a call: the customer channel (calls.vdn)
 * and the agent's current leg reported by mod_callcenter (agent list `uuid`).
 * Only well-formed UUIDs are returned (they are placed into an ESL command).
 */
export function channelsForCall(call, agentRow) {
  const out = [];
  if (isUuid(call?.vdn)) out.push(call.vdn);
  if (agentRow && isUuid(agentRow.uuid) && !out.includes(agentRow.uuid)) out.push(agentRow.uuid);
  return out;
}

export async function forceHangup(req, res) {
  const { callUuid } = req.params;
  if (!isUuid(callUuid)) return res.status(400).json({ error: 'Invalid call id' });

  const { rows } = await query(
    'SELECT call_uuid, vdn, agent_id, end_time FROM calls WHERE call_uuid = $1', [callUuid]);
  const call = rows[0];
  if (!call) return res.status(404).json({ error: 'Call not found' });

  let agentRow = null;
  if (call.agent_id) {
    try { agentRow = (await cc.agentList()).find((a) => a.name === call.agent_id) || null; } catch { /* ESL down */ }
  }
  const channels = channelsForCall(call, agentRow);
  const results = [];
  for (const ch of channels) {
    try { results.push(`${ch}: ${(await eslApi(`uuid_kill ${ch} NORMAL_CLEARING`)).trim()}`); }
    catch (err) { results.push(`${ch}: ${err.message}`); }
  }
  const result = channels.length ? results.join('; ') : 'no live FreeSWITCH channel found';

  await query(
    `INSERT INTO supervisor_actions (action, call_uuid, agent_id, channels, result, performed_by)
     VALUES ('force_hangup', $1, $2, $3, $4, $5)`,
    [callUuid, call.agent_id, channels, result, String(req.user?.username || req.user?.id || 'unknown')]);
  console.warn(`[supervisor] force hang-up of ${callUuid} by ${req.user?.username}: ${result}`);

  // The normal hangup events (and the ghost reaper within 30 s) close the call record.
  res.json({ callUuid, channels, result });
}
