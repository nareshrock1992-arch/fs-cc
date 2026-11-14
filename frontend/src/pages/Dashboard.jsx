import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Stats } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import Panel from '../components/Panel.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { Metric, CallsByHour, fmtDur } from './liveops/Panels.jsx';
import { overallServiceLevel, overallAvgWait, sumToday, qn } from './liveops/model.js';

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard — TODAY's summary (business day). Live, second-by-second supervision
// lives in Live Operations; this page answers "how is today going?".
// Sources (unchanged backend): /stats/queues (per-queue today figures, service
// level target), /stats/calls-trend (hourly), /stats/utilization-today.
// Missing data is shown as "—", never as a made-up 0.
// ─────────────────────────────────────────────────────────────────────────────

const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);

function QueueTodayTable({ rows }) {
  return (
    <Panel title="Queues today" count={rows.length} noPad>
      {rows.length === 0 ? (
        <EmptyState compact title="No queues configured" />
      ) : (
        <div className="overflow-auto">
          <table className="data-table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                {['Queue', 'Offered', 'Answered', 'Abandoned', 'Avg wait', 'Service level'].map((h, i) => (
                  <th key={h} scope="col" className={i ? 'th text-right' : 'th'}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => {
                const offered = Number(q.offered_today || 0);
                const answered = Number(q.answered_today || 0);
                const abandoned = Number(q.abandoned_today || 0);
                const base = answered + abandoned;
                const sl = base ? Math.round(Number(q.sla_pct_today)) : null;
                return (
                  <tr key={q.queue_name} className="tr-row">
                    <td className="td font-medium">{q.display_name || qn(q.queue_name)}</td>
                    <td className="td-num">{offered}</td>
                    <td className="td-num">{answered}</td>
                    <td className={`td-num ${abandoned ? 'text-status-error' : ''}`}>
                      {abandoned}
                      {offered > 0 && <span className="ml-1 text-[0.6875rem] text-ink-faint">({pct(abandoned, offered)}%)</span>}
                    </td>
                    <td className="td-num">{answered ? fmtDur(Number(q.avg_wait_today)) : '—'}</td>
                    <td className="td-num whitespace-nowrap">
                      {sl == null ? <span className="text-ink-faint">—</span>
                        : <span className={sl >= 80 ? 'text-status-available' : sl >= 60 ? 'text-status-ringing' : 'text-status-error'}>{sl}%</span>}
                      {q.sla_seconds != null && <span className="ml-1 text-[0.6875rem] text-ink-faint">≤{q.sla_seconds}s</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AbandonPanel({ rows }) {
  const inQueue = sumToday(rows, 'abandoned_queue_today') ?? 0;
  const atAgent = sumToday(rows, 'abandoned_agent_today') ?? 0;
  const total = inQueue + atAgent;
  return (
    <Panel title="Where calls were lost" eyebrow="Today">
      {!total ? (
        <EmptyState compact tone="ok" title="No abandoned calls today" />
      ) : (
        <ul className="space-y-3 text-sm">
          {[['Hung up while waiting in queue', inQueue, 'Not enough agents available or wait too long.'],
            ['Hung up while ringing an agent', atAgent, 'Agent did not answer in time.']].map(([label, n, hint]) => (
            <li key={label}>
              <div className="flex items-center justify-between"><span className="text-ink">{label}</span><span className="font-semibold tabular-nums">{n}</span></div>
              <div className="mt-1 h-1.5 rounded-sm bg-surface-2"><div className="h-full rounded-sm bg-status-error" style={{ width: `${(100 * n) / total}%` }} /></div>
              <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function Dashboard() {
  const [queueStats, setQueueStats] = useState(null);
  const [trend, setTrend] = useState([]);
  const [trendFailed, setTrendFailed] = useState(false);
  const [util, setUtil] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [qs, tr, ut] = await Promise.allSettled([Stats.queues(), Stats.callsTrend(), Stats.utilization()]);
    if (qs.status === 'fulfilled') { setQueueStats(Array.isArray(qs.value) ? qs.value : []); setError(null); }
    else setError(qs.reason?.message || 'Failed to load today\'s figures');
    if (tr.status === 'fulfilled') { setTrend(Array.isArray(tr.value) ? tr.value : []); setTrendFailed(false); }
    else setTrendFailed((f) => f || trend.length === 0);
    if (ut.status === 'fulfilled') setUtil(ut.value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 60_000); // daily figures: once a minute is enough
    return () => clearInterval(poll);
  }, [load]);
  // A finished or abandoned call changes today's totals.
  useSocketEvent('call:bridge-end', load);
  useSocketEvent('call:abandoned', load);

  if (queueStats == null && !error) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="skeleton h-16 rounded-md" />
        <div className="skeleton h-56 rounded-md" />
      </div>
    );
  }
  if (error && queueStats == null) {
    return (
      <Panel title="Dashboard unavailable">
        <p className="text-sm text-ink">Could not load today's figures.</p>
        <p className="text-xs text-ink-faint mt-1">{error}</p>
        <button onClick={load} className="btn-secondary gap-1.5 mt-3 text-xs"><RefreshCw size={12} /> Retry</button>
      </Panel>
    );
  }

  const offered = sumToday(queueStats, 'offered_today');
  const answered = sumToday(queueStats, 'answered_today');
  const abandoned = sumToday(queueStats, 'abandoned_today');
  const sl = overallServiceLevel(queueStats);
  const avgWait = overallAvgWait(queueStats);
  const answerRate = pct(answered, offered);
  const abandonRate = pct(abandoned, offered);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-dim">Today's totals for the business day. For callers waiting right now, use Live Operations.</p>
        <Link to="/live-operations" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Live Operations <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>

      <section aria-label="Today's summary" className="card overflow-hidden grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-px bg-border">
        <Metric label="Calls offered" value={offered ?? '—'} sub="today" />
        <Metric label="Answered" value={answered ?? '—'} sub={answerRate == null ? 'no calls yet' : `${answerRate}% of offered`} />
        <Metric label="Abandoned" value={abandoned ?? '—'} tone={abandoned ? 'warn' : 'default'}
          sub={abandonRate == null ? 'no calls yet' : `${abandonRate}% of offered`} />
        <Metric label="Service level" value={sl == null ? '—' : `${sl}%`}
          tone={sl == null ? 'default' : sl >= 80 ? 'good' : sl >= 60 ? 'warn' : 'bad'}
          sub={sl == null ? 'no calls yet' : 'answered within target'}
          title="Calls answered within each queue's service level target ÷ (answered + abandoned), today" />
        <Metric label="Avg wait" value={avgWait == null ? '—' : fmtDur(avgWait)} sub="answered calls" />
        <Metric label="Agent utilization" value={util?.pct == null ? '—' : `${util.pct}%`} sub="ringing + talking" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <CallsByHour data={trend} failed={trendFailed} />
        <AbandonPanel rows={queueStats} />
      </div>

      <QueueTodayTable rows={queueStats} />
    </div>
  );
}
