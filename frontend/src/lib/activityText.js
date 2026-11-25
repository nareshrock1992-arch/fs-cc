// Activity log (M2 Part B): one plain-language sentence per recorded change.
// Admin's words, not field names (TASTE). Unknown actions fall back to a readable form.

const q = (v) => (v == null || v === '' ? '' : `"${v}"`);
const list = (arr) => (Array.isArray(arr) && arr.length ? arr.join(', ') : 'none');
const onOff = (b) => (b ? 'on' : 'off');

const PERMISSION_WORDS = {
  view_reports: 'view reports',
  change_agent_state: 'change agent state',
  manage_break_codes: 'manage break codes',
  manage_dispositions: 'manage call outcomes',
  view_caller_id: 'see full caller ID',
  view_activity_log: 'view activity log',
};
const perms = (arr) => list((arr || []).map((p) => PERMISSION_WORDS[p] || p));

// Bookkeeping columns that change on every save and mean nothing to an admin.
const IGNORED_FIELDS = new Set(['id', 'created_at', 'updated_at', 'updated_by', 'created_by']);

function diffFields(oldV, newV) {
  if (!oldV || !newV) return '';
  const changes = Object.keys(newV)
    .filter((k) => !IGNORED_FIELDS.has(k) && JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]))
    .map((k) => `${k.replace(/_/g, ' ')}: ${oldV[k] ?? '—'} → ${newV[k] ?? '—'}`);
  return changes.length ? ` (${changes.join('; ')})` : '';
}

// Queue settings in the words of the Queues page.
const STRATEGY_WORDS = {
  'longest-idle-agent': 'Longest Idle Agent', 'agent-with-least-talk-time': 'Least Talk Time',
  'round-robin': 'Round Robin', 'top-down': 'Top Down (by tier)', 'ring-all': 'Ring All',
};
const QUEUE_FIELD_WORDS = {
  display_name: ['name', q],
  strategy: ['call distribution', (v) => STRATEGY_WORDS[v] || v],
  max_wait_time: ['max wait', (v) => (Number(v) === 0 ? 'no limit' : `${v} s`)],
  max_queue_size: ['max callers waiting', (v) => v],
  agent_no_answer_status: ['after missed calls the agent is set to', (v) => v],
  sla_seconds: ['service level target', (v) => `${v} s`],
  active: ['active', (v) => (v ? 'yes' : 'no')],
};
const shown = (fmt, v) => (v == null ? '—' : fmt(v));

/** "call distribution: Ring All → Top Down (by tier); service level target: 20 s → 30 s" */
function queueDiff(oldV = {}, newV = {}) {
  const parts = Object.keys(QUEUE_FIELD_WORDS)
    .filter((k) => k in newV && JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]))
    .map((k) => { const [word, fmt] = QUEUE_FIELD_WORDS[k]; return `${word}: ${shown(fmt, oldV[k])} → ${shown(fmt, newV[k])}`; });
  return parts.length ? ` (${parts.join('; ')})` : '';
}
const queueName = (r) => {
  const dn = r.new_value?.display_name || r.old_value?.display_name;
  return dn ? `${q(dn)} (${r.entity_id})` : r.entity_id;
};
const tier = (v) => (v ? `level ${v.level ?? '—'}, position ${v.position ?? '—'}` : '');

const SENTENCES = {
  AGENT_CREATED:        (r) => `Agent ${r.entity_id} added`,
  AGENT_DELETED:        (r) => `Agent ${r.entity_id} removed`,
  AGENT_STATUS_SET:     (r) => `Agent ${r.entity_id} set to ${r.new_value?.status}${r.old_value?.status ? ` (was ${r.old_value.status})` : ''}`,
  AGENT_PIN_SET:        (r) => `Agent ${r.entity_id}: sign-in PIN changed`,
  AGENT_WEBRTC_CHANGED: (r) => `Agent ${r.entity_id}: browser phone turned ${onOff(r.new_value?.webrtc_enabled)}`,
  USER_CREATED:         (r) => `User ${r.entity_id} added as ${r.new_value?.role}`,
  USER_UPDATED:         (r) => `User ${r.entity_id} changed${diffFields(r.old_value, r.new_value)}`,
  USER_DELETED:         (r) => `User ${r.entity_id} removed`,
  USER_PERMISSIONS_SET: (r) => `User ${r.entity_id} may now: ${perms(r.new_value?.permissions)}`,
  USER_PASSWORD_RESET:  (r) => `User ${r.entity_id}: password reset`,
  BREAK_CODE_CREATED:   (r) => `Break code ${q(r.new_value?.name || r.entity_id)} added`,
  BREAK_CODE_UPDATED:   (r) => `Break code ${q(r.new_value?.name || r.old_value?.name || r.entity_id)} changed${diffFields(r.old_value, r.new_value)}`,
  BREAK_CODE_ACTIVATED:   (r) => `Break code ${r.entity_id} switched on`,
  BREAK_CODE_DEACTIVATED: (r) => `Break code ${r.entity_id} switched off`,
  DISPOSITION_CODE_ACTIVATED:   (r) => `Call outcome ${r.entity_id} switched on`,
  DISPOSITION_CODE_DEACTIVATED: (r) => `Call outcome ${r.entity_id} switched off`,
  DISPOSITION_CODE_CREATED: (r) => `Call outcome ${q(r.new_value?.name || r.entity_id)} added`,
  DISPOSITION_CODE_UPDATED: (r) => `Call outcome ${q(r.new_value?.name || r.old_value?.name || r.entity_id)} changed${diffFields(r.old_value, r.new_value)}`,
  QUEUE_DISPOSITIONS_SET: (r) => `Queue ${r.entity_id} now offers: ${
    Array.isArray(r.new_value?.names) ? list(r.new_value.names)
      : Array.isArray(r.new_value?.code_ids) && r.new_value.code_ids.length === 0 ? 'all active outcomes'
      : `${r.new_value?.code_ids?.length ?? 'some'} chosen outcomes`}`,
  QUEUE_CREATED:        (r) => `Queue ${queueName(r)} added`,
  QUEUE_UPDATED:        (r) => `Queue ${queueName(r)} changed${queueDiff(r.old_value, r.new_value)}`,
  QUEUE_DELETED:        (r) => `Queue ${queueName(r)} removed`,
  QUEUE_AGENT_ADDED:    (r) => `Agent ${r.new_value?.agent_id} added to queue ${r.entity_id} (${tier(r.new_value)})`,
  QUEUE_AGENT_UPDATED:  (r) => `Agent ${r.new_value?.agent_id} in queue ${r.entity_id}: ${tier(r.old_value)} → ${tier(r.new_value)}`,
  QUEUE_AGENT_STATE_SET: (r) => `Agent ${r.new_value?.agent_id} in queue ${r.entity_id} set to ${q(r.new_value?.state)}`,
  QUEUE_AGENT_REMOVED:  (r) => `Agent ${r.old_value?.agent_id} removed from queue ${r.entity_id}`,
  force_hangup:         (r) => `Ended a call${r.new_value?.agent_id ? ` of agent ${r.new_value.agent_id}` : ''} (force hang-up)${r.result && r.result !== 'ok' ? ` — ${r.result}` : ''}`,
};

/** Plain-language description of one activity row. */
export function describeActivity(row) {
  const fn = SENTENCES[row?.action];
  if (fn) {
    try { return fn(row); } catch { /* fall through to the generic text */ }
  }
  const what = String(row?.action || 'change').toLowerCase().replace(/_/g, ' ');
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}${row?.entity_id ? ` — ${row.entity_type || 'item'} ${row.entity_id}` : ''}`;
}
