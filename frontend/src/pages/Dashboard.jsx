import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, PhoneIncoming, Timer, Gauge, PhoneMissed } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Stats, Agents as AgentsApi } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import KpiCard from '../components/KpiCard.jsx';
import Panel from '../components/Panel.jsx';
import StatusLamp from '../components/StatusLamp.jsx';

// Deterministic per-queue colors — dark-console palette, never random
const QUEUE_COLORS = [
  '#4C8EF5',  // brand blue
  '#27C98A',  // green
  '#F5A623',  // amber
  '#A78BFA',  // violet
  '#FB923C',  // orange
  '#34D399',  // teal
  '#60A5FA',  // sky
  '#EF4444',  // red
];

function fmtSeconds(s) {
  if (s === undefined || s === null) return '--';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

// MM:SS or HH:MM:SS idle timer — driven by tick, never resets on page refresh
function fmtIdle(fromIso, nowMs) {
  if (!fromIso) return '--';
  const s = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function QueueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border dark:bg-panel-raised dark:border-panel-border bg-white border-gray-200 px-3 py-2 text-xs shadow-card">
      <p className="font-semibold dark:text-ink text-gray-900">{d.displayName}</p>
      <p className="dark:text-ink-dim text-gray-500 mt-0.5">{d.value} offered · {d.share}%</p>
    </div>
  );
}

// ── Queue Performance visualization ────────────────────────────────────────────
// distribution: array of { queue_name, display_name, offered_today, answered_today,
//                          abandoned_queue_today, abandoned_agent_today }
function QueuePerformance({ distribution }) {
  const totalOffered = distribution.reduce((s, q) => s + (q.offered_today || 0), 0);

  // Assign a stable color per queue based on position in distribution array
  const colorOf = (queueName) => {
    const i = distribution.findIndex(q => q.queue_name === queueName);
    return QUEUE_COLORS[Math.max(0, i) % QUEUE_COLORS.length];
  };

  // Only queues with calls appear in the donut + legend (no empty slices)
  const chartData = distribution
    .filter(q => (q.offered_today || 0) > 0)
    .map(q => ({
      name:        q.queue_name,
      displayName: q.display_name || q.queue_name,
      value:       q.offered_today,
      share:       Math.round(q.offered_today / totalOffered * 100),
    }));

  const thBase = 'pb-2 text-[11px] font-bold uppercase tracking-wider dark:text-ink-faint text-gray-400';

  return (
    <Panel eyebrow="Today" title="Queue Performance">
      <div className="flex flex-col lg:flex-row gap-6">

        {/* ── Donut + legend (only when there are offered calls) ─────────────── */}
        {chartData.length > 0 && (
          <div className="flex flex-col items-center shrink-0 lg:w-52">
            <div className="relative w-48 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={82}
                    dataKey="value"
                    paddingAngle={2}
                    startAngle={90}
                    endAngle={-270}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={colorOf(entry.name)}
                        stroke="transparent"
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<QueueTooltip />} />
                </PieChart>
              </ResponsiveContainer>

              {/* Center label — safe because innerRadius leaves blank space */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <p className="text-[9px] uppercase tracking-widest dark:text-ink-faint text-gray-400 leading-none">
                    Total
                  </p>
                  <p className="text-2xl font-bold font-mono dark:text-ink text-gray-900 leading-tight">
                    {totalOffered}
                  </p>
                  <p className="text-[9px] dark:text-ink-faint text-gray-400 leading-none">calls</p>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="w-48 space-y-1.5 mt-3">
              {chartData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: colorOf(d.name) }}
                  />
                  <span
                    className="flex-1 truncate dark:text-ink-dim text-gray-600"
                    title={d.displayName}
                  >
                    {d.displayName}
                  </span>
                  <span className="font-mono tnum dark:text-ink-faint text-gray-500 shrink-0 w-8 text-right">
                    {d.share}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Queue table (all active queues, including zero-call ones) ─────── */}
        <div className="flex-1 overflow-x-auto">
          {distribution.length === 0 ? (
            <p className="text-sm dark:text-ink-dim text-gray-500">No queues configured.</p>
          ) : totalOffered === 0 ? (
            <div>
              <p className="text-sm dark:text-ink-dim text-gray-500 mb-3">No calls offered today.</p>
              <div className="space-y-1">
                {distribution.map(q => (
                  <div key={q.queue_name} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: colorOf(q.queue_name) }}
                    />
                    <span className="dark:text-ink-dim text-gray-500">{q.display_name || q.queue_name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-panel-border border-gray-100 text-left">
                  <th className={thBase}>Queue</th>
                  <th className={`${thBase} text-right`}>Offered</th>
                  <th className={`${thBase} text-right`}>Answered</th>
                  <th className={`${thBase} text-right hidden sm:table-cell`}>Abn Queue</th>
                  <th className={`${thBase} text-right hidden sm:table-cell`}>Missed</th>
                  <th className={`${thBase} text-right`}>Ans Rate</th>
                  <th className={`${thBase} text-right`}>Share</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-panel-border divide-gray-50">
                {distribution.map((q) => {
                  const offered   = q.offered_today          || 0;
                  const answered  = q.answered_today         || 0;
                  const abanQ     = q.abandoned_queue_today  || 0;
                  const abanA     = q.abandoned_agent_today  || 0;
                  const share     = totalOffered > 0
                    ? Math.round(offered / totalOffered * 100) : 0;
                  const ansRate   = offered > 0
                    ? Math.round(answered / offered * 100) : 0;
                  const ansColor  = offered === 0
                    ? 'dark:text-ink-faint text-gray-400'
                    : ansRate >= 80 ? 'text-lamp-ok'
                    : ansRate >= 60 ? 'text-lamp-warn'
                    : 'text-lamp-alert';

                  return (
                    <tr
                      key={q.queue_name}
                      className="hover:dark:bg-panel-raised/30 hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ background: colorOf(q.queue_name) }}
                          />
                          <span
                            className="font-medium dark:text-ink text-gray-800 truncate max-w-[140px]"
                            title={q.display_name || q.queue_name}
                          >
                            {q.display_name || q.queue_name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 font-mono tnum dark:text-ink text-gray-800 text-right">
                        {offered}
                      </td>
                      <td className="py-2.5 font-mono tnum text-lamp-ok text-right">
                        {answered}
                      </td>
                      <td className="py-2.5 font-mono tnum text-lamp-alert text-right hidden sm:table-cell">
                        {abanQ}
                      </td>
                      <td className="py-2.5 font-mono tnum text-orange-500 dark:text-orange-400 text-right hidden sm:table-cell">
                        {abanA}
                      </td>
                      <td className={`py-2.5 font-mono tnum text-right ${ansColor}`}>
                        {offered > 0 ? `${ansRate}%` : '—'}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 h-1 rounded-full dark:bg-panel-border bg-gray-200 overflow-hidden hidden md:block">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${share}%`,
                                background: colorOf(q.queue_name),
                              }}
                            />
                          </div>
                          <span className="font-mono tnum dark:text-ink-dim text-gray-600 w-8 text-right">
                            {share}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats]     = useState(null);
  const [agents, setAgents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tick, setTick]       = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([Stats.dashboard(), AgentsApi.list()]);
      setStats(s);
      setAgents(a);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 10000);
    return () => clearInterval(poll);
  }, [load]);

  // Single 1-second interval for idle timers — stable dep array, cleaned up on unmount
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const onLiveEvent = useCallback(() => load(), [load]);
  useSocketEvent('agent:state',    onLiveEvent);
  useSocketEvent('agent:status',   onLiveEvent);
  useSocketEvent('agent:update',   onLiveEvent);
  useSocketEvent('call:enqueued',  onLiveEvent);
  useSocketEvent('call:bridged',   onLiveEvent);
  useSocketEvent('channel:hangup', onLiveEvent);

  const sortedAgents = useMemo(() => {
    const order = { Available: 0, 'On Break': 1, 'Logged Out': 2 };
    return [...agents].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [agents]);

  if (loading) return <p className="text-sm dark:text-ink-dim text-gray-500">Loading dashboard…</p>;

  if (error) {
    return (
      <Panel title="Could not load dashboard">
        <p className="text-sm text-lamp-alert">{error}</p>
        <p className="text-xs dark:text-ink-dim text-gray-500 mt-2">
          Check that the backend API is running and reachable, and that it can reach Postgres.
        </p>
      </Panel>
    );
  }

  const totalWaiting = (stats.queueSnapshot || []).reduce((sum, q) => sum + q.waiting, 0);
  const abandoned    = stats.callsToday?.abandoned ?? 0;
  const queueDist    = stats.queueDistribution || [];

  return (
    <div className="space-y-6">
      {/* ── KPI row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Agents Available"
          value={stats.agents?.Available ?? 0}
          tone="green"
          icon={Users}
          sub={`${stats.agents?.['On Break'] ?? 0} on break · ${stats.agents?.['Logged Out'] ?? 0} logged out`}
        />
        <KpiCard
          label="Calls Waiting"
          value={totalWaiting}
          tone={totalWaiting > 0 ? 'amber' : 'default'}
          icon={PhoneIncoming}
        />
        <KpiCard
          label="Calls Today"
          value={stats.callsToday?.total ?? 0}
          tone="blue"
          sub={`${stats.callsToday?.answered ?? 0} answered`}
          icon={Gauge}
        />
        <KpiCard
          label="Avg Wait"
          value={fmtSeconds(stats.callsToday?.avg_wait_seconds)}
          tone="amber"
          icon={Timer}
        />
        <KpiCard
          label="Abandoned Today"
          value={abandoned}
          tone={abandoned > 0 ? 'red' : 'default'}
          icon={PhoneMissed}
        />
      </div>

      {/* ── Queue Performance (donut + table) — only when queues exist ───────── */}
      {queueDist.length > 0 && <QueuePerformance distribution={queueDist} />}

      {/* ── Queue Snapshot + Agent Roster ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue snapshot */}
        <Panel eyebrow="Live" title="Queue Snapshot" className="lg:col-span-2">
          {(!stats.queueSnapshot || stats.queueSnapshot.length === 0) ? (
            <p className="text-sm dark:text-ink-dim text-gray-500">No calls currently waiting in any queue.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest dark:text-ink-faint text-gray-400 border-b dark:border-panel-border border-gray-100">
                  <th className="pb-2 font-display font-medium">Queue</th>
                  <th className="pb-2 font-display font-medium">Waiting</th>
                  <th className="pb-2 font-display font-medium">SLA (today)</th>
                </tr>
              </thead>
              <tbody>
                {stats.queueSnapshot.map((q) => (
                  <tr key={q.queue_name} className="border-b dark:border-panel-border/60 border-gray-50 last:border-0">
                    <td className="py-2.5 font-medium dark:text-ink text-gray-800">{q.queue_name}</td>
                    <td className="py-2.5">
                      <StatusLamp status="InQueue" label={`${q.waiting} waiting`} />
                    </td>
                    <td className="py-2.5 font-mono tnum dark:text-ink-dim text-gray-500">{stats.slaPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {/* Agent roster — includes idle timer for Available agents */}
        <Panel eyebrow="Roster" title="Agent Status">
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {sortedAgents.length === 0 && (
              <p className="text-sm dark:text-ink-dim text-gray-500">No agents configured yet.</p>
            )}
            {sortedAgents.map((a) => (
              <div key={a.agent_id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium dark:text-ink text-gray-800 truncate">{a.full_name}</p>
                  <p className="text-[11px] dark:text-ink-faint text-gray-400 font-mono leading-none mt-0.5">
                    ext {a.avaya_extension}
                  </p>
                  {/* Idle timer — only for Available agents with a known status_since.
                      status_since comes from agent_state_events.started_at (authoritative).
                      Driven by tick (1s interval), never resets on data poll. */}
                  {a.status === 'Available' && (
                    <p className="text-[10px] font-mono tnum text-lamp-available leading-none mt-0.5">
                      {a.status_since
                        ? `Idle ${fmtIdle(a.status_since, tick)}`
                        : 'Available'}
                    </p>
                  )}
                </div>
                <div className="shrink-0 mt-0.5">
                  <StatusLamp status={a.status} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
