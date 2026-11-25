// Wallboard (M2 Part C) — pure view model over /stats/queues and /stats/live-agents.
// Real data only: anything unknown is null and shown as "—" (TASTE).
import { overallServiceLevel, overallAvgWait, sumToday } from '../liveops/model.js';

/** Queues to show: the chosen names that still exist, or all queues when nothing is chosen. */
export function selectQueues(queueStats, chosen) {
  const all = Array.isArray(queueStats) ? queueStats : [];
  if (!chosen || chosen.length === 0) return all;
  const set = new Set(chosen);
  const picked = all.filter((q) => set.has(q.queue_name));
  return picked.length ? picked : all;   // stale choice (queue deleted) → fall back to all
}

/** Agents serving any of the shown queues (live-agents rows carry their queue list). */
export function agentsForQueues(agentRows, queues) {
  const names = new Set(queues.map((q) => q.queue_name));
  return (agentRows || []).filter((a) => {
    const qs = Array.isArray(a.queues) ? a.queues : [];
    return qs.some((q) => names.has(typeof q === 'string' ? q : q?.queue ?? q?.queue_name ?? q?.name));
  });
}

/**
 * Tiles for the top of the wallboard.
 * phoneOnline=false → live numbers (waiting, longest wait, agents) are unknown (null);
 * today's totals come from the database and stay visible.
 */
export function wallboardTiles({ queues, agents, phoneOnline }) {
  const live = phoneOnline !== false;
  const waiting = live ? queues.reduce((s, q) => s + Number(q.waiting || 0), 0) : null;
  const longest = live && queues.length ? Math.max(0, ...queues.map((q) => Number(q.longest_wait_seconds || 0))) : null;
  const count = (state) => (live ? agents.filter((a) => a.operational_state === state).length : null);
  return {
    waiting,
    longestWaitSeconds: longest,
    serviceLevel: overallServiceLevel(queues),
    answered: sumToday(queues, 'answered_today'),
    abandoned: sumToday(queues, 'abandoned_today'),
    avgWaitSeconds: overallAvgWait(queues),
    agentsReady: count('Idle'),
    agentsOnCall: count('On Call') == null ? null : count('On Call') + count('Ringing'),
    agentsOnBreak: count('On Break'),
  };
}

/** Service level colour band: good ≥ 80, warn ≥ 60, bad below; none without data. */
export function slBand(pct) {
  if (pct == null) return 'none';
  return pct >= 80 ? 'good' : pct >= 60 ? 'warn' : 'bad';
}

/** m:ss, or "—" for unknown. */
export function mmss(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return '—';
  const s = Math.max(0, Math.round(Number(sec)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
