import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, PhoneIncoming, Timer, PhoneMissed, Gauge,
  LayoutDashboard, RefreshCw, Phone, PhoneOff, PhoneCall,
  Activity, CheckCircle2, UserCheck, UserX, Coffee,
  Radio,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { Stats, Agents as AgentsApi } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import KpiCard from '../components/KpiCard.jsx';
import Panel from '../components/Panel.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import { KpiSkeleton } from '../components/LoadingState.jsx';

// ─── Constants ────────────────────────────────────────────────────────────────

const QUEUE_COLORS = [
  '#2563EB', '#27C98A', '#F5A623', '#A78BFA',
  '#FB923C', '#34D399', '#60A5FA', '#EF4444',
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtSeconds(s) {
  if (s === undefined || s === null) return '--';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function fmtIdle(fromIso, nowMs) {
  if (!fromIso) return '--';
  const s = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function queueColor(name, distribution) {
  const i = (distribution || []).findIndex(q => q.queue_name === name);
  return QUEUE_COLORS[Math.max(0, i) % QUEUE_COLORS.length];
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ─── Service Level Gauge ──────────────────────────────────────────────────────

function ServiceLevelGauge({ pct }) {
  const r = 52;
  const cx = 66, cy = 66;
  const circumference = 2 * Math.PI * r;
  const safe = Math.min(100, Math.max(0, pct || 0));
  const offset = circumference - (safe / 100) * circumference;
  const stroke = safe >= 80 ? '#27C98A' : safe >= 60 ? '#F5A623' : '#EF4444';
  const status = safe >= 80 ? 'Excellent' : safe >= 60 ? 'Warning' : 'Critical';

  return (
    <div className="flex flex-col items-center">
      <svg width="132" height="132" viewBox="0 0 132 132">
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="currentColor" strokeWidth="9"
          className="text-gray-100 dark:text-panel-raised" />
        {/* Progress */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={stroke} strokeWidth="9"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.7s ease, stroke 0.4s ease' }}
        />
        {/* Value */}
        <text x={cx} y={cy - 7} textAnchor="middle" fontSize="24" fontWeight="700"
          fill={stroke} fontFamily="IBM Plex Mono, monospace">{safe}%</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10"
          fill="#8B99B8" fontFamily="Inter, sans-serif">Service Level</text>
        <text x={cx} y={cy + 28} textAnchor="middle" fontSize="8" fontWeight="700"
          fill={stroke} fontFamily="Inter, sans-serif"
          style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}>{status}</text>
      </svg>
    </div>
  );
}

// ─── Agent Distribution Donut ─────────────────────────────────────────────────

function AgentStatusDonut({ agents }) {
  const rows = [
    { name: 'Available',  count: agents?.Available    || 0, color: '#27C98A' },
    { name: 'On Break',   count: agents?.['On Break'] || 0, color: '#4C8EF5' },
    { name: 'Logged Out', count: agents?.['Logged Out'] || 0, color: '#4C5A78' },
  ];
  const total = rows.reduce((s, d) => s + d.count, 0);
  const data = rows.filter(d => d.count > 0);

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-[72px] h-[72px] shrink-0">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%"
                innerRadius={24} outerRadius={34}
                dataKey="count" paddingAngle={2}
                startAngle={90} endAngle={-270}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.color} stroke="transparent" />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full rounded-full border-4 border-panel-raised dark:border-panel-border flex items-center justify-center">
            <span className="text-xs font-mono text-gray-400 dark:text-ink-faint">0</span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-sm font-bold font-mono dark:text-ink text-gray-900">{total}</span>
        </div>
      </div>

      <div className="flex-1 space-y-2 min-w-0">
        {rows.map(({ name, count, color }) => {
          const pct = total > 0 ? Math.round(count / total * 100) : 0;
          return (
            <div key={name} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="flex-1 text-gray-600 dark:text-ink-dim truncate">{name}</span>
              <span className="font-mono tnum font-semibold w-4 text-right text-gray-800 dark:text-ink">{count}</span>
              <span className="font-mono tnum w-8 text-right text-gray-400 dark:text-ink-faint">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bar Chart Tooltip ────────────────────────────────────────────────────────

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white dark:bg-panel-raised dark:border-panel-border
                    border-gray-200 px-3 py-2.5 text-xs shadow-card-hover">
      <p className="font-semibold text-gray-800 dark:text-ink mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1 last:mb-0">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.fill }} />
          <span className="text-gray-500 dark:text-ink-dim w-16">{p.name}:</span>
          <span className="font-mono font-semibold" style={{ color: p.fill }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Queue Performance Bar Chart ──────────────────────────────────────────────

function QueueBarChart({ distribution }) {
  const data = distribution.map(q => ({
    name: (q.display_name || q.queue_name)
      .replace(/\bSupport\b/gi, 'Sup.')
      .replace(/\bQueue\b/gi, 'Q'),
    Offered:   q.offered_today || 0,
    Answered:  q.answered_today || 0,
    Abandoned: (q.abandoned_queue_today || 0) + (q.abandoned_agent_today || 0),
  }));

  const totalOffered = data.reduce((s, d) => s + d.Offered, 0);

  if (totalOffered === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <div className="h-12 w-12 rounded-xl bg-gray-100 dark:bg-panel-raised flex items-center justify-center">
          <Phone size={22} strokeWidth={1.25} className="text-gray-300 dark:text-ink-faint/50" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-500 dark:text-ink-dim">No calls offered today</p>
          <p className="text-xs text-gray-400 dark:text-ink-faint mt-0.5">
            Call activity will appear here as it happens
          </p>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={168}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -26, bottom: 0 }}
        barCategoryGap="32%">
        <CartesianGrid strokeDasharray="3 3"
          stroke="rgba(139,153,184,0.12)" vertical={false} />
        <XAxis dataKey="name"
          tick={{ fontSize: 9.5, fill: '#8B99B8', fontFamily: 'Inter, sans-serif' }}
          axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 9.5, fill: '#8B99B8', fontFamily: 'Inter, sans-serif' }}
          axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(139,153,184,0.06)' }} />
        <Bar dataKey="Offered"   name="Offered"   fill="#3B82F6" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Answered"  name="Answered"  fill="#27C98A" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Abandoned" name="Abandoned" fill="#EF4444" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Queue Performance Section ────────────────────────────────────────────────

function QueuePerformanceSection({ distribution }) {
  const totalOffered = distribution.reduce((s, q) => s + (q.offered_today || 0), 0);

  const legend = (
    <div className="hidden sm:flex items-center gap-4 text-[10px] text-gray-400 dark:text-ink-faint">
      {[['#3B82F6','Offered'],['#27C98A','Answered'],['#EF4444','Abandoned']].map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );

  return (
    <Panel eyebrow="Today" title="Queue Performance" action={legend}>
      <div className="space-y-4">
        {/* Bar chart */}
        <QueueBarChart distribution={distribution} />

        {/* Stats table */}
        {distribution.length > 0 && (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="border-b border-gray-100 dark:border-panel-border">
                  {[
                    ['Queue', 'text-left'],
                    ['Offered',  'text-right'],
                    ['Answered', 'text-right'],
                    ['Abandoned','text-right'],
                    ['Ans %',    'text-right'],
                    ['Share',    'text-right'],
                  ].map(([h, align]) => (
                    <th key={h} className={`pb-2 text-[10px] font-semibold uppercase tracking-wider
                      text-gray-400 dark:text-ink-faint ${align}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-panel-border/30">
                {distribution.map((q) => {
                  const offered   = q.offered_today         || 0;
                  const answered  = q.answered_today        || 0;
                  const abandoned = (q.abandoned_queue_today || 0) + (q.abandoned_agent_today || 0);
                  const share     = totalOffered > 0 ? Math.round(offered / totalOffered * 100) : 0;
                  const ansRate   = offered > 0 ? Math.round(answered / offered * 100) : 0;
                  const color     = queueColor(q.queue_name, distribution);
                  const ansColor  = offered === 0
                    ? 'text-gray-400 dark:text-ink-faint'
                    : ansRate >= 80 ? 'text-emerald-600 dark:text-lamp-ok'
                    : ansRate >= 60 ? 'text-amber-600 dark:text-lamp-warn'
                    : 'text-red-600 dark:text-lamp-alert';

                  return (
                    <tr key={q.queue_name}
                      className="hover:bg-gray-50/70 dark:hover:bg-panel-raised/25 transition-colors">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                          <span className="font-medium text-gray-800 dark:text-ink truncate max-w-[160px]"
                            title={q.display_name || q.queue_name}>
                            {q.display_name || q.queue_name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 font-mono tnum text-gray-700 dark:text-ink text-right">{offered}</td>
                      <td className="py-2.5 font-mono tnum text-emerald-600 dark:text-lamp-ok text-right font-semibold">{answered}</td>
                      <td className="py-2.5 font-mono tnum text-red-500 dark:text-lamp-alert text-right">{abandoned}</td>
                      <td className={`py-2.5 font-mono tnum text-right font-semibold ${ansColor}`}>
                        {offered > 0 ? `${ansRate}%` : '—'}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-14 h-1.5 rounded-full bg-gray-100 dark:bg-panel-border overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${share}%`, background: color }} />
                          </div>
                          <span className="font-mono tnum text-[11px] text-gray-400 dark:text-ink-faint w-7 text-right">
                            {share}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {distribution.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <Activity size={28} strokeWidth={1.25} className="text-gray-300 dark:text-ink-faint/40" />
            <p className="text-sm font-medium text-gray-500 dark:text-ink-dim">No queues configured</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─── Metric Row (right panel) ─────────────────────────────────────────────────

function MetricRow({ icon: Icon, label, value, valueClass, iconClass }) {
  return (
    <div className="flex items-center justify-between py-2.5
      border-b border-gray-50 dark:border-panel-border/40 last:border-0">
      <div className="flex items-center gap-2.5">
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0
          ${iconClass || 'bg-gray-100 dark:bg-panel-raised text-gray-400 dark:text-ink-dim'}`}>
          <Icon size={13} strokeWidth={2} />
        </div>
        <span className="text-xs text-gray-600 dark:text-ink-dim">{label}</span>
      </div>
      <span className={`text-sm font-mono tnum font-semibold
        ${valueClass || 'text-gray-800 dark:text-ink'}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Real-Time Overview Panel ─────────────────────────────────────────────────

function RealTimeOverview({ stats }) {
  const total    = stats.callsToday?.total    || 0;
  const answered = stats.callsToday?.answered || 0;
  const abnd     = stats.callsToday?.abandoned || 0;
  const ansRate  = total > 0 ? Math.round(answered / total * 100) : 0;
  const abnRate  = total > 0 ? Math.round(abnd / total * 100) : 0;
  const slaPct   = Number(stats.slaPct) || 0;

  return (
    <Panel eyebrow="Live" title="Real-Time Overview">
      <div className="space-y-5">
        {/* Gauge */}
        <div className="flex justify-center pt-1">
          <ServiceLevelGauge pct={slaPct} />
        </div>

        {/* Metrics */}
        <div className="-mx-1">
          <MetricRow
            icon={CheckCircle2} label="Answer Rate"
            value={total > 0 ? `${ansRate}%` : '—'}
            valueClass={
              total === 0 ? 'text-gray-400 dark:text-ink-faint'
              : ansRate >= 80 ? 'text-emerald-600 dark:text-lamp-ok'
              : ansRate >= 60 ? 'text-amber-500 dark:text-lamp-warn'
              : 'text-red-500 dark:text-lamp-alert'
            }
            iconClass="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          />
          <MetricRow
            icon={PhoneMissed} label="Abandon Rate"
            value={total > 0 ? `${abnRate}%` : '—'}
            valueClass={
              total === 0 ? 'text-gray-400 dark:text-ink-faint'
              : abnRate === 0 ? 'text-emerald-600 dark:text-lamp-ok'
              : abnRate <= 10 ? 'text-amber-500 dark:text-lamp-warn'
              : 'text-red-500 dark:text-lamp-alert'
            }
            iconClass="bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400"
          />
          <MetricRow
            icon={Timer} label="Avg Wait Time"
            value={fmtSeconds(stats.callsToday?.avg_wait_seconds)}
            iconClass="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
          <MetricRow
            icon={Phone} label="Calls Today"
            value={total}
            iconClass="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
          />
        </div>

        {/* Agent distribution */}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold
            text-gray-400 dark:text-ink-faint mb-3">
            Agent Distribution
          </p>
          <AgentStatusDonut agents={stats.agents} />
        </div>
      </div>
    </Panel>
  );
}

// ─── Live Queue Snapshot ──────────────────────────────────────────────────────

function LiveQueueSnapshot({ queueStats }) {
  const hasQueues = queueStats && queueStats.length > 0;

  return (
    <Panel eyebrow="Live" title="Queue Snapshot">
      {!hasQueues ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <div className="h-10 w-10 rounded-xl bg-gray-100 dark:bg-panel-raised
            flex items-center justify-center">
            <PhoneIncoming size={18} strokeWidth={1.25}
              className="text-gray-300 dark:text-ink-faint/60" />
          </div>
          <p className="text-sm font-semibold text-gray-500 dark:text-ink-dim mt-1">
            All queues clear
          </p>
          <p className="text-xs text-gray-400 dark:text-ink-faint">
            No callers waiting
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {queueStats.map((q, i) => {
            const waiting  = q.waiting || 0;
            const avail    = q.available_agents || 0;
            const longest  = fmtSeconds(q.longest_wait_seconds);
            const sla      = Number(q.sla_pct_today) || 0;
            const color    = QUEUE_COLORS[i % QUEUE_COLORS.length];
            const slaColor = sla >= 80 ? 'text-emerald-600 dark:text-lamp-ok'
              : sla >= 60 ? 'text-amber-500 dark:text-lamp-warn'
              : 'text-red-500 dark:text-lamp-alert';

            return (
              <div key={q.queue_name}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  waiting > 0
                    ? 'border-amber-200 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/5'
                    : 'border-gray-100 dark:border-panel-border bg-gray-50/50 dark:bg-panel-raised/30'
                }`}
              >
                <span className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: color }} />

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-ink truncate">
                    {q.display_name || q.queue_name}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-ink-faint mt-0.5 font-mono">
                    {avail} avail · {longest} longest
                  </p>
                </div>

                <div className="text-right shrink-0 space-y-0.5">
                  {waiting > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                      bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400
                      text-[10px] font-bold animate-pulse-soft">
                      {waiting} waiting
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                      bg-emerald-50 dark:bg-emerald-500/10
                      text-emerald-700 dark:text-emerald-400
                      text-[10px] font-semibold">
                      Clear
                    </span>
                  )}
                  <p className={`text-[10px] font-mono tnum text-right ${slaColor}`}>
                    SLA {sla}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Agent Roster ─────────────────────────────────────────────────────────────

function AgentRoster({ agents, tick }) {
  const sorted = useMemo(() => {
    const order = { Available: 0, 'On Break': 1, 'Logged Out': 2 };
    return [...(agents || [])].sort((a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [agents]);

  return (
    <Panel eyebrow="Roster" title="Agent Status">
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <div className="h-10 w-10 rounded-xl bg-gray-100 dark:bg-panel-raised
            flex items-center justify-center">
            <Users size={18} strokeWidth={1.25}
              className="text-gray-300 dark:text-ink-faint/60" />
          </div>
          <p className="text-sm font-semibold text-gray-500 dark:text-ink-dim mt-1">
            No agents configured
          </p>
        </div>
      ) : (
        <div className="space-y-0.5 max-h-[340px] overflow-y-auto pr-0.5">
          {sorted.map((a) => {
            const initials = (a.full_name || '??')
              .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
            const dotColor =
              a.status === 'Available'  ? '#27C98A' :
              a.status === 'On Break'   ? '#4C8EF5' : '#4C5A78';

            return (
              <div key={a.agent_id}
                className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg
                  hover:bg-gray-50 dark:hover:bg-panel-raised/60 transition-colors group">

                {/* Avatar */}
                <div className="h-8 w-8 rounded-full flex items-center justify-center
                  shrink-0 text-[11px] font-bold text-white"
                  style={{ background: dotColor + 'CC' }}>
                  {initials}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-ink
                    truncate leading-tight">
                    {a.full_name}
                  </p>
                  <p className="text-[10px] font-mono tnum text-gray-400
                    dark:text-ink-faint leading-none mt-0.5">
                    ext {a.avaya_extension}
                    {a.status === 'Available' && a.status_since && (
                      <span className="text-emerald-500 dark:text-lamp-available ml-1.5">
                        · {fmtIdle(a.status_since, tick)}
                      </span>
                    )}
                  </p>
                </div>

                <StatusLamp status={a.status} showLabel={false} size="sm" />
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

const ACTIVITY_CFG = {
  'call:enqueued':  { Icon: PhoneIncoming, cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  'call:bridged':   { Icon: PhoneCall,     cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  'call:abandoned': { Icon: PhoneOff,      cls: 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400' },
  'agent:login':    { Icon: UserCheck,     cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  'agent:logout':   { Icon: UserX,         cls: 'bg-gray-100 dark:bg-panel-raised text-gray-500 dark:text-ink-dim' },
  'agent:break':    { Icon: Coffee,        cls: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  'default':        { Icon: Activity,      cls: 'bg-gray-100 dark:bg-panel-raised text-gray-400 dark:text-ink-dim' },
};

function ActivityFeed({ activities, tick }) {
  return (
    <Panel eyebrow="Live" title="Activity Feed">
      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <div className="h-10 w-10 rounded-xl bg-gray-100 dark:bg-panel-raised
            flex items-center justify-center">
            <Radio size={18} strokeWidth={1.25}
              className="text-gray-300 dark:text-ink-faint/60" />
          </div>
          <p className="text-sm font-semibold text-gray-500 dark:text-ink-dim mt-1">
            Waiting for activity
          </p>
          <p className="text-xs text-gray-400 dark:text-ink-faint">
            Events appear here in real time
          </p>
        </div>
      ) : (
        <div className="space-y-1 max-h-[340px] overflow-y-auto pr-0.5">
          {activities.map((act) => {
            const cfg = ACTIVITY_CFG[act.type] || ACTIVITY_CFG['default'];
            const { Icon, cls } = cfg;
            return (
              <div key={act.id}
                className="flex items-start gap-2.5 py-2 px-1.5 rounded-lg
                  hover:bg-gray-50/60 dark:hover:bg-panel-raised/30 transition-colors
                  animate-slide-in-up">
                <div className={`h-7 w-7 rounded-lg flex items-center justify-center
                  shrink-0 mt-0.5 ${cls}`}>
                  <Icon size={13} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-ink leading-snug">
                    {act.text}
                  </p>
                  {act.detail && (
                    <p className="text-[10px] text-gray-400 dark:text-ink-faint mt-0.5">
                      {act.detail}
                    </p>
                  )}
                </div>
                <span className="text-[10px] text-gray-400 dark:text-ink-faint shrink-0 mt-0.5 tabular-nums">
                  {timeAgo(act.ts)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const MAX_ACTIVITIES = 14;

export default function Dashboard() {
  const [stats,      setStats]      = useState(null);
  const [agents,     setAgents]     = useState([]);
  const [queueStats, setQueueStats] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [tick,       setTick]       = useState(Date.now());
  const [activities, setActivities] = useState([]);
  const actId = useRef(0);

  const addActivity = useCallback((type, text, detail) => {
    setActivities(prev => [
      { id: ++actId.current, type, text, detail, ts: Date.now() },
      ...prev,
    ].slice(0, MAX_ACTIVITIES));
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, a, qs] = await Promise.all([
        Stats.dashboard(),
        AgentsApi.list(),
        Stats.queues(),
      ]);
      setStats(s);
      setAgents(a);
      setQueueStats(qs);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000);
    return () => clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Data refresh events (existing behavior preserved) ──────────────────────
  const onRefresh = useCallback(() => load(), [load]);
  useSocketEvent('agent:state',    onRefresh);
  useSocketEvent('agent:status',   onRefresh);
  useSocketEvent('agent:update',   onRefresh);
  useSocketEvent('call:enqueued',  onRefresh);
  useSocketEvent('call:bridged',   onRefresh);
  useSocketEvent('channel:hangup', onRefresh);

  // ── Activity feed handlers (separate — don't re-call load) ────────────────
  const onCallEnqueued = useCallback((payload) => {
    const queue  = payload?.queue_name || 'a queue';
    const caller = payload?.caller_id_number;
    addActivity('call:enqueued', `New call entered ${queue}`, caller);
  }, [addActivity]);

  const onCallBridged = useCallback((payload) => {
    const agent = payload?.agent_name || payload?.agent_id;
    addActivity('call:bridged', 'Call connected to agent', agent);
  }, [addActivity]);

  const onCallAbandoned = useCallback((payload) => {
    const queue = payload?.queue_name || 'queue';
    addActivity('call:abandoned', `Call abandoned in ${queue}`);
  }, [addActivity]);

  const onAgentChange = useCallback((payload) => {
    const name  = payload?.full_name || payload?.agent_id || 'Agent';
    const state = payload?.state || payload?.status;
    if (!state) return;
    if      (state === 'Available')  addActivity('agent:login',  `${name} is now available`);
    else if (state === 'Logged Out') addActivity('agent:logout', `${name} logged out`);
    else if (state === 'On Break')   addActivity('agent:break',  `${name} went on break`);
  }, [addActivity]);

  useSocketEvent('call:enqueued',  onCallEnqueued);
  useSocketEvent('call:bridged',   onCallBridged);
  useSocketEvent('call:abandoned', onCallAbandoned);
  useSocketEvent('agent:state',    onAgentChange);
  useSocketEvent('agent:status',   onAgentChange);

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-5">
        <KpiSkeleton count={5} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="skeleton h-[380px] rounded-xl xl:col-span-2" />
          <div className="skeleton h-[380px] rounded-xl" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="skeleton h-52 rounded-xl" />
          <div className="skeleton h-52 rounded-xl" />
          <div className="skeleton h-52 rounded-xl" />
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Panel title="Dashboard unavailable">
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="h-12 w-12 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
            <LayoutDashboard size={22} strokeWidth={1.25}
              className="text-red-400 dark:text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 dark:text-ink">
              Could not load dashboard data
            </p>
            <p className="text-xs text-gray-400 dark:text-ink-faint mt-1 max-w-xs">
              {error}
            </p>
          </div>
          <button onClick={load} className="btn-secondary gap-2 mt-1">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      </Panel>
    );
  }

  const totalWaiting = (stats.queueSnapshot || []).reduce((s, q) => s + q.waiting, 0);
  const abandoned    = stats.callsToday?.abandoned ?? 0;
  const queueDist    = stats.queueDistribution || [];

  return (
    <div className="space-y-5">

      {/* ── KPI Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Agents Available"
          value={stats.agents?.Available ?? 0}
          tone="green" icon={Users}
          sub={`${stats.agents?.['On Break'] ?? 0} break · ${stats.agents?.['Logged Out'] ?? 0} out`}
        />
        <KpiCard
          label="Calls Waiting"
          value={totalWaiting}
          tone={totalWaiting > 0 ? 'amber' : 'default'} icon={PhoneIncoming}
          sub={totalWaiting > 0 ? 'In queue right now' : 'All queues clear'}
        />
        <KpiCard
          label="Calls Today"
          value={stats.callsToday?.total ?? 0}
          tone="blue" icon={Gauge}
          sub={`${stats.callsToday?.answered ?? 0} answered`}
        />
        <KpiCard
          label="Avg Wait"
          value={fmtSeconds(stats.callsToday?.avg_wait_seconds)}
          tone="amber" icon={Timer}
        />
        <KpiCard
          label="Abandoned"
          value={abandoned}
          tone={abandoned > 0 ? 'red' : 'default'} icon={PhoneMissed}
          sub={stats.callsToday?.total > 0
            ? `${Math.round(abandoned / stats.callsToday.total * 100)}% of total`
            : undefined}
        />
      </div>

      {/* ── Main Grid: Queue Performance + Real-Time Overview ────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <QueuePerformanceSection distribution={queueDist} />
        </div>
        <RealTimeOverview stats={stats} />
      </div>

      {/* ── Bottom Grid: Queue Snapshot · Agent Roster · Activity Feed ───── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <LiveQueueSnapshot queueStats={queueStats} />
        <AgentRoster agents={agents} tick={tick} />
        <ActivityFeed activities={activities} tick={tick} />
      </div>

    </div>
  );
}
