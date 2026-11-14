import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import Panel from '../../components/Panel.jsx';
import EmptyState from '../../components/EmptyState.jsx';

export function fmtDur(sec) {
  if (sec == null || sec < 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Health strip: one compact row, the numbers a supervisor reads first ──────
function Metric({ label, value, sub, tone = 'default', title }) {
  const color = { default: 'text-ink', bad: 'text-status-error', warn: 'text-status-ringing', good: 'text-status-available' }[tone];
  return (
    <div className="bg-surface px-4 py-2.5 min-w-0 last:col-span-2 sm:last:col-span-2 xl:last:col-span-1" title={title}>
      <div className="text-[0.6875rem] font-medium text-ink-dim whitespace-nowrap">{label}</div>
      <div className={`text-xl font-semibold tabular-nums leading-tight ${color}`}>{value}</div>
      {sub && <div className="text-[0.6875rem] text-ink-faint whitespace-nowrap">{sub}</div>}
    </div>
  );
}

export function HealthStrip({ k, sl, avgWait, abandoned, offered, activeCalls }) {
  return (
    <section aria-label="Contact center health" className="card overflow-hidden grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-px bg-border">
      <Metric label="Waiting" value={k.waiting} tone={k.waiting ? 'warn' : 'default'}
        sub={k.slaBreached ? `${k.slaBreached} over target` : k.waiting ? 'in queue' : 'none'} />
      <Metric label="Longest wait" value={k.waiting ? fmtDur(k.longestWait) : '—'} tone={k.slaBreached ? 'bad' : 'default'} />
      <Metric label="Service level today" value={sl == null ? '—' : `${sl}%`}
        tone={sl == null ? 'default' : sl >= 80 ? 'good' : sl >= 60 ? 'warn' : 'bad'}
        sub={sl == null ? 'no calls yet' : 'answered within target'}
        title="Calls answered within each queue's service level target ÷ (answered + abandoned), today" />
      <Metric label="Avg wait today" value={avgWait == null ? '—' : fmtDur(avgWait)} sub="answered calls" />
      <Metric label="Calls today" value={offered ?? '—'}
        sub={abandoned == null ? null : `${abandoned} abandoned`} tone={abandoned ? 'warn' : 'default'} />
      <Metric label="Active calls" value={activeCalls} sub="talking now" />
      <Metric label="Agents available" value={k.available} tone={k.waiting && !k.available ? 'bad' : 'default'}
        sub={`${k.onCall} on call · ${k.onBreak} break`} />
    </section>
  );
}

// ── Queue performance ────────────────────────────────────────────────────────
const HEALTH = {
  critical: { dot: 'bg-status-error', label: 'Critical' },
  warning:  { dot: 'bg-status-ringing', label: 'Attention' },
  ok:       { dot: 'bg-status-available', label: 'Healthy' },
  idle:     { dot: 'bg-status-loggedout', label: 'No agents' },
};

export function QueuePerformance({ rows, selected, onSelect }) {
  return (
    <Panel title="Queue performance" eyebrow="Live + today" count={rows.length} noPad>
      {rows.length === 0 ? (
        <EmptyState compact title="No queue statistics" body="queue figures appear once the statistics load" />
      ) : (
        <div className="overflow-auto">
          <table className="data-table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                {['Queue', 'Waiting', 'Longest', 'Service level', 'Calls / abandoned', 'Agents avail / in', 'Health'].map((h) => (
                  <th key={h} scope="col" className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => {
                const h = HEALTH[q.health];
                const active = selected === q.name;
                return (
                  <tr key={q.name} className={`tr-row cursor-pointer ${active ? 'bg-primary/5' : ''}`}
                    onClick={() => onSelect(active ? 'All' : q.name)} aria-selected={active}
                    title={active ? 'Show all queues' : `Show only ${q.display}`}>
                    <td className="td font-medium">{q.display}</td>
                    <td className={`td tabular-nums font-semibold ${q.waiting ? 'text-status-ringing' : 'text-ink-dim'}`}>{q.waiting}</td>
                    <td className={`td tabular-nums ${q.breached ? 'text-status-error font-semibold' : ''}`}>{fmtDur(q.longest)}</td>
                    <td className="td tabular-nums whitespace-nowrap">
                      {q.sl == null ? <span className="text-ink-faint">—</span> : `${Math.round(q.sl)}%`}
                      {q.slaSeconds != null && <span className="ml-1 text-[0.6875rem] text-ink-faint">≤{q.slaSeconds}s</span>}
                    </td>
                    <td className="td tabular-nums">{q.offered}<span className="text-ink-faint"> / {q.abandoned}</span></td>
                    <td className={`td tabular-nums ${q.waiting && !q.available ? 'text-status-error font-semibold' : ''}`}>
                      {q.available}<span className="text-ink-faint"> / {q.loggedIn}</span>
                    </td>
                    <td className="td whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={`h-2 w-2 rounded-full ${h.dot}`} aria-hidden="true" />{h.label}
                      </span>
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

// ── Alerts ───────────────────────────────────────────────────────────────────
export function AlertsPanel({ alerts }) {
  return (
    <Panel title="Alerts" count={alerts.length} className="flex flex-col">
      {alerts.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-dim">
          <CheckCircle2 size={16} className="text-status-available" aria-hidden="true" /> No active alerts
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Active alerts">
          {alerts.map((a) => (
            <li key={a.id} className={`flex gap-2 rounded-md border px-2.5 py-2 text-sm
              ${a.sev === 'critical' ? 'border-status-error/30 bg-status-error/[0.06]' : 'border-status-ringing/30 bg-status-ringing/[0.06]'}`}>
              {a.sev === 'critical'
                ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-status-error" aria-hidden="true" />
                : <Info size={16} className="mt-0.5 shrink-0 text-status-ringing" aria-hidden="true" />}
              <div className="min-w-0">
                <div className="font-medium text-ink">{a.title}</div>
                <div className="text-xs text-ink-dim">{a.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Calls by hour (today) ────────────────────────────────────────────────────
export function CallsByHour({ data, failed }) {
  const total = (data || []).reduce((s, r) => s + (r.offered || 0), 0);
  return (
    <Panel title="Calls by hour" eyebrow="Today">
      {failed ? (
        <EmptyState compact tone="warn" title="Hourly figures unavailable" body="retrying with the next refresh" />
      ) : !total ? (
        <EmptyState compact title="No calls today yet" body="offered, answered and abandoned calls appear per hour" />
      ) : (
        <div className="h-48" role="img" aria-label={`Calls by hour today: ${total} offered`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} maxBarSize={36}>
              <CartesianGrid vertical={false} stroke="rgb(var(--border))" />
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgb(var(--border) / 0.4)' }} />
              <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="answered" name="Answered" stackId="c" fill="rgb(var(--status-available))" />
              <Bar dataKey="abandoned" name="Abandoned" stackId="c" fill="rgb(var(--status-error))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

// ── Agent overview: one stacked bar + legend (no decorative donut) ───────────
const STATE_COLOR = {
  Idle: 'bg-status-available', 'On Call': 'bg-status-oncall', Ringing: 'bg-status-ringing',
  'On Break': 'bg-status-onbreak', Offline: 'bg-status-loggedout', Other: 'bg-ink-faint',
};

export function AgentOverview({ counts, onPick }) {
  const total = counts.reduce((s, c) => s + c.n, 0);
  return (
    <Panel title="Agents" count={total}>
      {!total ? (
        <EmptyState compact title="No agents configured" />
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-sm bg-surface-2" aria-hidden="true">
            {counts.filter((c) => c.n).map((c) => (
              <div key={c.state} className={STATE_COLOR[c.state]} style={{ width: `${(100 * c.n) / total}%` }} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {counts.map((c) => (
              <li key={c.state}>
                <button type="button" onClick={() => onPick(c.state)} className="flex w-full items-center gap-2 rounded px-1 hover:bg-surface-2">
                  <span className={`h-2.5 w-2.5 rounded-sm ${STATE_COLOR[c.state]}`} aria-hidden="true" />
                  <span className="text-ink-dim">{c.label}</span>
                  <span className="ml-auto font-semibold tabular-nums">{c.n}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
