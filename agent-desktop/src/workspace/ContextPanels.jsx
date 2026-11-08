import React, { useEffect, useState } from 'react';
import { UserRound, ListOrdered, History, AlertOctagon } from 'lucide-react';
import { api } from '../api/client.js';
import { Badge } from '../ui/primitives.jsx';
import { digits } from '../interactions/correlate.js';
import { formatClock, formatDuration } from './format.js';

const H2 = 'flex items-center gap-2 text-[0.8125rem] font-semibold text-ink';
const ROW = 'flex items-baseline justify-between gap-3 text-xs';

/**
 * CustomerPanel — real data only: number, caller name, queue, direction, interaction id,
 * and this agent's previous calls with the number (GET /agent-desk/call-history?search=).
 * No CRM, email, account, notes or dispositions are shown because none exist.
 */
export function CustomerPanel({ interaction }) {
  const number = interaction?.number;
  const key = digits(number);
  const [history, setHistory] = useState({ key: null, rows: [], loading: false, error: null });

  useEffect(() => {
    if (!key || key.length < 3) { setHistory({ key: null, rows: [], loading: false, error: null }); return undefined; }
    let live = true;
    setHistory({ key, rows: [], loading: true, error: null });
    api.callHistory({ search: key, limit: 5 })
      .then((r) => live && setHistory({ key, rows: r?.data || [], loading: false, error: null }))
      .catch((e) => live && setHistory({ key, rows: [], loading: false, error: e.message }));
    return () => { live = false; };
  }, [key]);

  return (
    <section aria-label="Customer" className="p-4 space-y-3 border-b border-panel-border">
      <h2 className={H2}><UserRound size={15} className="text-ink-dim" /> Customer</h2>
      {!interaction ? (
        <p className="text-xs text-ink-dim">Customer details appear here during a call.</p>
      ) : (
        <>
          <dl className="space-y-1.5">
            <div className={ROW}><dt className="text-ink-dim">Number</dt><dd className="font-mono text-ink">{number || '—'}</dd></div>
            <div className={ROW}><dt className="text-ink-dim">Caller name</dt><dd className="text-ink truncate">{interaction.name || '—'}</dd></div>
            <div className={ROW}><dt className="text-ink-dim">Direction</dt><dd className="text-ink capitalize">{interaction.direction || '—'}</dd></div>
            <div className={ROW}><dt className="text-ink-dim">Queue</dt><dd className="text-ink">{interaction.queue || '—'}</dd></div>
            {interaction.callUuid && (
              <div className={ROW}><dt className="text-ink-dim">Interaction ID</dt><dd className="font-mono text-[0.625rem] text-ink-dim truncate max-w-[10rem]" title={interaction.callUuid}>{interaction.callUuid}</dd></div>
            )}
          </dl>
          <p className="text-[0.6875rem] text-ink-faint">No CRM is connected; only call data is shown.</p>

          <div className="pt-1">
            <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint mb-1.5">
              <History size={12} /> Your previous calls with this number
            </p>
            {history.loading && <p className="text-xs text-ink-dim">Loading…</p>}
            {history.error && <p className="text-xs text-status-error">Could not load history: {history.error}</p>}
            {!history.loading && !history.error && history.rows.length === 0 && (
              <p className="text-xs text-ink-dim">{key && key.length >= 3 ? 'No previous queue calls with this number.' : 'Number not available.'}</p>
            )}
            <ul className="space-y-1">
              {history.rows.map((c) => (
                <li key={c.call_uuid} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-dim">{formatClock(c.start_time || c.agent_answer_time)}</span>
                  <span className="text-ink-dim truncate">{c.queue_name || ''}</span>
                  {c.missed ? <Badge tone="error">Missed</Badge>
                    : <span className="font-mono text-ink">{formatDuration(c.agent_talk_seconds ?? c.talk_seconds ?? 0)}</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

/** Compact queue list for the context panel (data from the existing 3-s queue poll). */
export function QueueSummary({ queues }) {
  return (
    <section aria-label="My queues" className="p-4 space-y-2">
      <h2 className={H2}><ListOrdered size={15} className="text-ink-dim" /> My queues</h2>
      {queues.length === 0 ? (
        <p className="text-xs text-ink-dim">No queues assigned — ask your supervisor.</p>
      ) : (
        <ul className="divide-y divide-panel-border">
          {queues.map((q) => (
            <li key={q.name} className="flex items-center justify-between gap-2 py-1.5 text-xs">
              <span className="text-ink truncate" title={q.name}>{q.display_name || q.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className={q.waiting > 0 ? 'font-semibold text-status-ringing' : 'text-ink-dim'}>{q.waiting ?? 0} waiting</span>
                <span className="text-ink-faint">{q.available_agents ?? 0} avail.</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Today's activity in one line (from GET /agent-desk/performance). */
export function ActivityStrip({ perf }) {
  if (!perf) return null;
  const item = (label, value, tone) => (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-mono text-sm font-semibold ${tone || 'text-ink'}`}>{value}</span>
      <span className="text-[0.6875rem] text-ink-dim">{label}</span>
    </div>
  );
  return (
    <div aria-label="Today's activity" className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-panel-border bg-panel-surface px-4 py-2.5">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint">Today</span>
      {item('handled', perf.calls_handled ?? 0)}
      {item('missed', perf.calls_missed ?? 0, perf.calls_missed > 0 ? 'text-status-error' : undefined)}
      {item('avg talk', formatDuration(perf.avg_talk_seconds ?? 0))}
      {item('total talk', formatDuration(perf.total_talk_seconds ?? 0))}
    </div>
  );
}

/**
 * "Not reachable" — shown when the agent is Available but the browser phone is not registered.
 * Phone type per agent is not known yet (planned admin setting), so the text says what is known.
 */
export function shouldWarnNotReachable({ agentStatus, phone }) {
  if (agentStatus !== 'Available' || !phone) return false;
  if (phone.configError || !phone.eligibility?.eligible) return false;
  return phone.state?.registration !== 'registered';
}

export function NotReachableBanner({ extension }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-status-error/50 bg-status-error/10 px-4 py-3">
      <AlertOctagon size={18} className="mt-0.5 shrink-0 text-status-error" />
      <div className="text-sm">
        <p className="font-semibold text-status-error">Not reachable: you are Available but your browser phone is not registered</p>
        <p className="text-xs text-ink">
          Queue calls to extension <span className="font-mono">{extension || '—'}</span> will fail unless another phone is registered on it.
          Sign in to the browser phone, or change your status.
        </p>
      </div>
    </div>
  );
}
