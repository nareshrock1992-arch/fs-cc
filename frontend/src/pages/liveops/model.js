// Live Operations view model — pure functions over data the page already loads
// (/calls/live, /stats/live-agents, /stats/queues). No values are invented:
// anything without data is returned as null and rendered as "—".

export const qn = (name) => (name ? String(name).split('@')[0] : '');

/** Today's service level across queues: Σ within-target ÷ Σ (answered + abandoned). null when no calls. */
export function overallServiceLevel(queueStats) {
  let within = 0, base = 0;
  for (const q of queueStats || []) {
    const b = Number(q.answered_today || 0) + Number(q.abandoned_today || 0);
    if (!b || q.sla_pct_today == null) continue;
    within += (Number(q.sla_pct_today) / 100) * b;
    base += b;
  }
  return base ? Math.round((100 * within) / base) : null;
}

/** Sum of a today counter across queues; null when stats are not loaded. */
export function sumToday(queueStats, field) {
  if (!Array.isArray(queueStats) || queueStats.length === 0) return null;
  return queueStats.reduce((s, q) => s + Number(q[field] || 0), 0);
}

/** Average wait (answered calls) across queues, weighted by answered; null when none. */
export function overallAvgWait(queueStats) {
  let tot = 0, n = 0;
  for (const q of queueStats || []) {
    const a = Number(q.answered_today || 0);
    if (!a) continue;
    tot += Number(q.avg_wait_today || 0) * a;
    n += a;
  }
  return n ? Math.round(tot / n) : null;
}

const agentInQueue = (a, name) =>
  (a.queues || []).some((q) => qn(q.queue) === name || (q.display_name || '') === name);

/**
 * One row per configured queue: live waiting / longest from call rows (real time),
 * today's figures from /stats/queues, agent availability from live agent states.
 * health: 'critical' (callers waiting, nobody available or SL breach),
 *         'warning' (callers waiting / SL today under 80 %), 'ok', or 'idle'.
 */
export function buildQueueRows(queueStats, callRows, agentRows) {
  return (queueStats || []).map((q) => {
    const name = qn(q.queue_name);
    const waiting = callRows.filter((r) => r.state === 'Waiting' && r.queue === name);
    const longest = waiting.reduce((m, r) => Math.max(m, r._wait || 0), 0);
    const breached = waiting.filter((r) => r.sla === 'breached').length;
    const members = agentRows.filter((a) => agentInQueue(a, name));
    const loggedIn = members.filter((a) => a.operational_state !== 'Offline').length;
    const available = members.filter((a) => a.operational_state === 'Idle').length;
    const base = Number(q.answered_today || 0) + Number(q.abandoned_today || 0);
    const sl = base ? Number(q.sla_pct_today) : null;
    let health = 'ok';
    if (waiting.length && (available === 0 || breached)) health = 'critical';
    else if (waiting.length || (sl != null && sl < 80)) health = 'warning';
    else if (!loggedIn) health = 'idle';
    return {
      name, display: q.display_name || name, slaSeconds: q.sla_seconds ?? null,
      waiting: waiting.length, longest: waiting.length ? longest : null, breached,
      sl, offered: Number(q.offered_today || 0), abandoned: Number(q.abandoned_today || 0),
      available, loggedIn, members: members.length, health,
    };
  });
}

/**
 * Operational alerts derived from live data only. Severity: critical | warning.
 * Ringing threshold 30 s = agent not answering an offered call.
 */
export function buildAlerts({ health, pqFailed, queueRows, agentRows }) {
  const out = [];
  if (health === 'disconnected') out.push({ id: 'esl', sev: 'critical', title: 'FreeSWITCH not connected', detail: 'Live call and agent data cannot be updated.' });
  else if (health === 'stale') out.push({ id: 'stale', sev: 'warning', title: 'Live data is stale', detail: 'No update received recently; reconnecting.' });
  if (pqFailed) out.push({ id: 'pq', sev: 'warning', title: 'IVR monitor unavailable', detail: 'Callers in the IVR may not be shown.' });
  for (const q of queueRows) {
    if (q.waiting && q.available === 0) {
      out.push({ id: `noagent-${q.name}`, sev: 'critical', title: `${q.display}: no agent available`,
        detail: `${q.waiting} caller${q.waiting === 1 ? '' : 's'} waiting, ${q.loggedIn} agent${q.loggedIn === 1 ? '' : 's'} logged in.` });
    }
    if (q.breached) {
      out.push({ id: `sla-${q.name}`, sev: 'critical', title: `${q.display}: service level breached`,
        detail: `${q.breached} caller${q.breached === 1 ? '' : 's'} waiting over ${q.slaSeconds}s.` });
    }
  }
  for (const a of agentRows) {
    if (a.operational_state === 'Ringing' && (a._stateDur ?? 0) >= 30) {
      out.push({ id: `ring-${a.agent_id}`, sev: 'warning', title: `${a.full_name || a.agent_id} not answering`,
        detail: `Ringing for ${a._stateDur}s.` });
    }
  }
  return out.sort((x, y) => (x.sev === y.sev ? 0 : x.sev === 'critical' ? -1 : 1));
}

/** Agent state counts in display order. */
export function agentStateCounts(agentRows) {
  const order = [['Idle', 'Available'], ['On Call', 'On call'], ['Ringing', 'Ringing'], ['On Break', 'On break'], ['Offline', 'Offline']];
  const counts = order.map(([state, label]) => ({ state, label, n: agentRows.filter((a) => a.operational_state === state).length }));
  const known = new Set(order.map(([s]) => s));
  const other = agentRows.filter((a) => !known.has(a.operational_state)).length;
  if (other) counts.push({ state: 'Other', label: 'Other', n: other });
  return counts;
}
