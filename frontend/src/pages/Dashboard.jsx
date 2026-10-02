import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, PhoneIncoming, Timer, PhoneMissed, Gauge,
  LayoutDashboard, RefreshCw, PhoneOff, PhoneCall,
  Activity, CheckCircle2, UserCheck, UserX, Coffee,
  Radio, ArrowRight,
} from 'lucide-react';
import {
  Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { Stats } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import KpiCard from '../components/KpiCard.jsx';
import Panel from '../components/Panel.jsx';
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

// ─── Service Level Gauge (compact) ───────────────────────────────────────────

function ServiceLevelGauge({ pct }) {
  const r = 40;
  const cx = 50, cy = 50;
  const circumference = 2 * Math.PI * r;
  const safe   = Math.min(100, Math.max(0, pct || 0));
  const offset = circumference - (safe / 100) * circumference;
  const stroke = safe >= 80 ? '#27C98A' : safe >= 60 ? '#F5A623' : '#EF4444';
  const status = safe >= 80 ? 'Excellent' : safe >= 60 ? 'Warning' : 'Critical';

  return (
    <div className="flex items-center gap-3">
      <svg width="100" height="100" viewBox="0 0 100 100" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="currentColor" strokeWidth="7"
          className="text-gray-100 dark:text-panel-raised" />
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={stroke} strokeWidth="7"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.7s ease, stroke 0.4s ease' }}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="700"
          fill={stroke} fontFamily="IBM Plex Mono, monospace">{safe}%</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="8"
          fill="#8B99B8" fontFamily="Inter, sans-serif">SLA</text>
      </svg>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-700 dark:text-ink">Service Level</p>
        <p className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: stroke }}>
          {status}
        </p>
        <p className="text-[10px] text-gray-400 dark:text-ink-faint mt-1 leading-relaxed">
          Target: ≥80% answered within<br />each queue's configured target
        </p>
      </div>
    </div>
  );
}

// ─── Bar Chart Tooltip ────────────────────────────────────────────────────────

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white dark:bg-panel-raised dark:border-panel-border
                    border-gray-200 px-3 py-2 text-xs shadow-card-hover">
      <p className="font-semibold text-gray-800 dark:text-ink mb-1.5">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1 last:mb-0">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: p.fill }} />
          <span className="text-gray-500 dark:text-ink-dim w-14">{p.name}:</span>
          <span className="font-mono font-semibold" style={{ color: p.fill }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Queue Health Section (Phase 2 consolidation) ─────────────────────────────
// Single section replacing the former separate "Queue Performance" (today totals)
// and "Live Queue Snapshot" (live pressure) panels. NO metric definition is
// changed: today columns come from /stats/dashboard queueDistribution exactly as
// before; live columns (Waiting, Longest wait, Avail, per-queue SLA) come from
// /stats/queues exactly as before. The two are merged by queue_name for display
// only. Time basis is labelled explicitly (LIVE vs TODAY) so the differing SLA
// semantics between endpoints are not silently conflated.

function QueueHealthSection({ distribution, liveByName }) {
  const totalOffered = distribution.reduce((s, q) => s + (q.offered_today || 0), 0);

  const chartData = distribution.map(q => ({
    name: (q.display_name || q.queue_name)
      .replace(/\bSupport\b/gi, 'Sup')
      .replace(/\bQueue\b/gi, 'Q'),
    Offered:   q.offered_today || 0,
    Answered:  q.answered_today || 0,
    Abandoned: (q.abandoned_queue_today || 0) + (q.abandoned_agent_today || 0),
  }));

  const legend = (
    <div className="hidden sm:flex items-center gap-3 text-[10px] text-gray-400 dark:text-ink-faint">
      {[['#3B82F6','Offered'],['#27C98A','Answered'],['#EF4444','Abandoned']].map(([c, l]) => (
        <span key={l} className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );

  return (
    <Panel eyebrow="Live + Today" title="Queue Health" action={legend}>
      {distribution.length === 0 ? (
        <div className="flex items-center gap-3 py-3 text-gray-400 dark:text-ink-faint">
          <Activity size={16} strokeWidth={1.5} className="shrink-0" />
          <p className="text-xs">No queues configured yet.</p>
        </div>
      ) : (
        /* Stacked: compact chart on top, aligned scrollable table below — keeps
           numeric columns aligned regardless of queue-name length or row count. */
        <div className="space-y-3">
          {/* Chart — today offered/answered/abandoned (horizontal scroll if many) */}
          <div className="relative w-full overflow-x-auto">
            <div style={{ minWidth: Math.max(100, chartData.length * 9) + '%' }}>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={chartData}
                  margin={{ top: 2, right: 2, left: -26, bottom: 0 }}
                  barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3"
                    stroke="rgba(139,153,184,0.10)" vertical={false} />
                  <XAxis dataKey="name"
                    tick={{ fontSize: 9, fill: '#8B99B8', fontFamily: 'Inter, sans-serif' }}
                    axisLine={false} tickLine={false} interval={0} />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#8B99B8', fontFamily: 'Inter, sans-serif' }}
                    axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                  <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(139,153,184,0.06)' }} />
                  <Bar dataKey="Offered"   name="Offered"   fill="#3B82F6" radius={[2,2,0,0]} />
                  <Bar dataKey="Answered"  name="Answered"  fill="#27C98A" radius={[2,2,0,0]} />
                  <Bar dataKey="Abandoned" name="Abandoned" fill="#EF4444" radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {totalOffered === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[10px] text-gray-400 dark:text-ink-faint bg-white/80
                  dark:bg-panel-surface/80 px-2 py-1 rounded">
                  No calls today
                </span>
              </div>
            )}
          </div>

          {/* Merged table — LIVE (waiting/longest) + TODAY (offered/ans/abnd/ans%/SLA).
              Real <table> with fixed-width right-aligned numeric columns; the name
              column truncates (min-w-0) so long names never push metrics out of
              alignment. Internal vertical scroll caps height for many queues. */}
          <div className="w-full min-w-0 overflow-x-auto overflow-y-auto max-h-64">
            <table className="w-full table-fixed text-xs" style={{ minWidth: 440 }}>
              {/* Explicit column distribution: queue-name ~32%, the seven metric
                  columns share the remaining width evenly so numbers spread
                  across the table instead of crowding the right edge. */}
              <colgroup>
                <col style={{ width: '32%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '8.5%' }} />
                <col style={{ width: '8.5%' }} />
                <col style={{ width: '8.5%' }} />
                <col style={{ width: '10.5%' }} />
                <col style={{ width: '10.5%' }} />
              </colgroup>
              <thead className="sticky top-0 bg-white dark:bg-panel-surface z-10">
                <tr className="border-b border-gray-100 dark:border-panel-border">
                  {[
                    ['Queue',   'text-left',  ''],
                    ['Waiting', 'text-right', 'live'],
                    ['Longest', 'text-right', 'live'],
                    ['Off',     'text-right', 'today'],
                    ['Ans',     'text-right', 'today'],
                    ['Ab',      'text-right', 'today'],
                    ['Ans%',    'text-right', 'today'],
                    ['SLA',     'text-right', 'today'],
                  ].map(([h, align, basis]) => (
                    <th key={h} className={`pb-2 px-1.5 text-[9px] font-semibold uppercase
                      tracking-wider text-gray-400 dark:text-ink-faint ${align}`}>
                      {h}
                      {basis && (
                        <span className={`block text-[8px] font-medium tracking-normal normal-case ${
                          basis === 'live'
                            ? 'text-amber-500 dark:text-amber-400'
                            : 'text-gray-300 dark:text-ink-faint/60'
                        }`}>
                          {basis}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-panel-border/20">
                {distribution.map((q) => {
                  const live      = liveByName[q.queue_name] || {};
                  const offered   = q.offered_today  || 0;
                  const answered  = q.answered_today || 0;
                  const abandoned = (q.abandoned_queue_today || 0) + (q.abandoned_agent_today || 0);
                  const ansRate   = offered > 0 ? Math.round(answered / offered * 100) : null;
                  const waiting   = live.waiting || 0;
                  const longest   = fmtSeconds(live.longest_wait_seconds);
                  const avail     = live.available_agents ?? null;
                  const sla       = live.sla_pct_today == null ? null : Number(live.sla_pct_today);
                  const color     = queueColor(q.queue_name, distribution);
                  const ansColor  = ansRate === null
                    ? 'text-gray-300 dark:text-ink-faint/40'
                    : ansRate >= 80 ? 'text-emerald-600 dark:text-lamp-ok'
                    : ansRate >= 60 ? 'text-amber-500 dark:text-lamp-warn'
                    : 'text-red-500 dark:text-lamp-alert';
                  const slaColor  = sla === null
                    ? 'text-gray-300 dark:text-ink-faint/40'
                    : sla >= 80 ? 'text-emerald-600 dark:text-lamp-ok'
                    : sla >= 60 ? 'text-amber-500 dark:text-lamp-warn'
                    : 'text-red-500 dark:text-lamp-alert';

                  return (
                    <tr key={q.queue_name}
                      className={`transition-colors ${
                        waiting > 0
                          ? 'bg-amber-50/50 dark:bg-amber-500/5'
                          : 'hover:bg-gray-50/60 dark:hover:bg-panel-raised/20'
                      }`}>
                      <td className="py-2 px-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ background: color }} />
                          <span className="font-medium text-gray-700 dark:text-ink truncate min-w-0"
                            title={q.display_name || q.queue_name}>
                            {q.display_name || q.queue_name}
                          </span>
                          {avail !== null && (
                            <span className="shrink-0 text-[9px] font-mono text-gray-400 dark:text-ink-faint">
                              · {avail} avail
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-1.5 text-right">
                        {waiting > 0 ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full
                            bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400
                            text-[9px] font-bold animate-pulse-soft">
                            {waiting}
                          </span>
                        ) : (
                          <span className="font-mono tnum text-gray-300 dark:text-ink-faint/50">0</span>
                        )}
                      </td>
                      <td className="py-2 px-1.5 font-mono tnum text-right text-gray-500 dark:text-ink-dim">
                        {waiting > 0 ? longest : '—'}
                      </td>
                      <td className="py-2 px-1.5 font-mono tnum text-gray-600 dark:text-ink text-right">{offered}</td>
                      <td className="py-2 px-1.5 font-mono tnum text-emerald-600 dark:text-lamp-ok text-right font-semibold">{answered}</td>
                      <td className="py-2 px-1.5 font-mono tnum text-red-400 dark:text-lamp-alert text-right">{abandoned}</td>
                      <td className={`py-2 px-1.5 font-mono tnum text-right font-semibold ${ansColor}`}>
                        {ansRate !== null ? `${ansRate}%` : '—'}
                      </td>
                      <td className={`py-2 px-1.5 font-mono tnum text-right font-semibold ${slaColor}`}>
                        {sla !== null ? `${Math.round(sla)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ─── Metric Row ───────────────────────────────────────────────────────────────

function MetricRow({ icon: Icon, label, value, valueClass, iconClass }) {
  return (
    <div className="flex items-center justify-between py-2
      border-b border-gray-50 dark:border-panel-border/30 last:border-0">
      <div className="flex items-center gap-2">
        <div className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0
          ${iconClass || 'bg-gray-100 dark:bg-panel-raised text-gray-400 dark:text-ink-dim'}`}>
          <Icon size={12} strokeWidth={2} />
        </div>
        <span className="text-[11px] text-gray-600 dark:text-ink-dim">{label}</span>
      </div>
      <span className={`text-sm font-mono tnum font-semibold
        ${valueClass || 'text-gray-800 dark:text-ink'}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Service Health Panel ─────────────────────────────────────────────────────
// Phase 1: no longer repeats Calls Today / Avg Wait (those live once in the KPI
// row) and no longer repeats the agent-status split (that lives once in the
// "Agents Available" KPI card). Shows only the global service-health signals:
// SLA gauge + Answer Rate + Abandon Rate.

function ServiceHealth({ stats }) {
  const total    = stats.callsToday?.total    || 0;
  const answered = stats.callsToday?.answered || 0;
  const abnd     = stats.callsToday?.abandoned || 0;
  const ansRate  = total > 0 ? Math.round(answered / total * 100) : 0;
  const abnRate  = total > 0 ? Math.round(abnd / total * 100) : 0;
  const slaPct   = Number(stats.sla_pct ?? stats.slaPct) || 0;

  return (
    <Panel eyebrow="Live" title="Service Health">
      <div className="space-y-4">
        <div className="pt-0.5">
          <ServiceLevelGauge pct={slaPct} />
        </div>

        <div>
          <MetricRow
            icon={CheckCircle2} label="Answer Rate"
            value={total > 0 ? `${ansRate}%` : '—'}
            valueClass={
              total === 0 ? 'text-gray-300 dark:text-ink-faint/40'
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
              total === 0 ? 'text-gray-300 dark:text-ink-faint/40'
              : abnRate === 0 ? 'text-emerald-600 dark:text-lamp-ok'
              : abnRate <= 10 ? 'text-amber-500 dark:text-lamp-warn'
              : 'text-red-500 dark:text-lamp-alert'
            }
            iconClass="bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400"
          />
        </div>
      </div>
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

function ActivityFeed({ activities }) {
  const viewAgents = (
    <Link to="/live-agents"
      className="inline-flex items-center gap-1 text-[11px] font-semibold
        text-primary hover:underline">
      View Live Agents <ArrowRight size={12} />
    </Link>
  );
  return (
    <Panel eyebrow="Live" title="Activity Feed" action={viewAgents}>
      {activities.length === 0 ? (
        <div className="flex items-center gap-3 py-3 text-gray-400 dark:text-ink-faint">
          <Radio size={15} strokeWidth={1.5} className="shrink-0" />
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-ink-dim">No recent activity</p>
            <p className="text-[10px] mt-0.5">Events appear here in real time</p>
          </div>
        </div>
      ) : (
        <div className="space-y-0.5 max-h-60 overflow-y-auto">
          {activities.map((act) => {
            const cfg = ACTIVITY_CFG[act.type] || ACTIVITY_CFG['default'];
            const { Icon, cls } = cfg;
            return (
              <div key={act.id}
                className="flex items-start gap-2 py-1.5 px-1 rounded-md
                  hover:bg-gray-50/60 dark:hover:bg-panel-raised/30 transition-colors
                  animate-slide-in-up">
                <div className={`h-6 w-6 rounded-md flex items-center justify-center
                  shrink-0 mt-0.5 ${cls}`}>
                  <Icon size={11} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-gray-800 dark:text-ink leading-snug">
                    {act.text}
                  </p>
                  {act.detail && (
                    <p className="text-[10px] text-gray-400 dark:text-ink-faint">{act.detail}</p>
                  )}
                </div>
                <span className="text-[9px] text-gray-400 dark:text-ink-faint shrink-0 mt-0.5 tabular-nums">
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

// ─── Agent Status / Capacity (canonical: /stats/live-agents) ──────────────────
// Counts the authoritative operational_state from the live-agents feed. NO ACW —
// wrap-up is not observable in FS-CC, so it is deliberately not shown.

const AGENT_STATUS = [
  { key: 'Idle',     label: 'Available', color: '#27C98A' },
  { key: 'On Call',  label: 'On Call',   color: '#2563EB' },
  { key: 'Ringing',  label: 'Ringing',   color: '#F5A623' },
  { key: 'On Break', label: 'Break',     color: '#A78BFA' },
  { key: 'Offline',  label: 'Offline',   color: '#4C5A78' },
];

function countAgentStates(agents) {
  const c = { Idle: 0, 'On Call': 0, Ringing: 0, 'On Break': 0, Offline: 0 };
  for (const a of (agents || [])) if (c[a.operational_state] !== undefined) c[a.operational_state]++;
  return c;
}

function AgentStatusCard({ agents }) {
  const counts = countAgentStates(agents);
  const total  = (agents || []).length;
  const available = counts.Idle;

  return (
    <Panel eyebrow="Live" title="Agent Status">
      {total === 0 ? (
        <div className="flex items-center gap-2.5 py-3 text-gray-400 dark:text-ink-faint">
          <Users size={15} strokeWidth={1.5} className="shrink-0" />
          <span className="text-xs">No agents online</span>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Compact distribution bar */}
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-panel-raised">
            {AGENT_STATUS.map(s => counts[s.key] > 0 && (
              <div key={s.key} style={{ width: `${(counts[s.key] / total) * 100}%`, background: s.color }}
                title={`${s.label}: ${counts[s.key]}`} />
            ))}
          </div>
          {/* Counts */}
          <div className="space-y-1">
            {AGENT_STATUS.map(s => (
              <div key={s.key} className="flex items-center gap-2 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="flex-1 text-gray-500 dark:text-ink-dim truncate">{s.label}</span>
                <span className="font-mono tnum font-semibold text-gray-700 dark:text-ink">{counts[s.key]}</span>
              </div>
            ))}
          </div>
          {/* Available capacity */}
          <div className="pt-2 border-t border-gray-100 dark:border-panel-border/40">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-ink-faint">
              Available Capacity
            </p>
            <p className="text-metric text-emerald-600 dark:text-emerald-400 mt-0.5">
              {available}<span className="text-gray-400 dark:text-ink-faint"> / {total}</span>
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ─── Calls — Today trend (canonical: queue_stats_hourly via /stats/calls-trend) ─

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white dark:bg-panel-raised dark:border-panel-border
                    border-gray-200 px-3 py-2 text-xs shadow-card-hover">
      <p className="font-semibold text-gray-800 dark:text-ink mb-1.5">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1 last:mb-0">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-gray-500 dark:text-ink-dim w-16">{p.name}:</span>
          <span className="font-mono font-semibold" style={{ color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function CallsTrendCard({ data, ready }) {
  const hasData = Array.isArray(data) && data.length > 0;
  const anyVolume = hasData && data.some(d => (d.offered || d.answered || d.abandoned));

  return (
    <Panel eyebrow="Today" title="Calls — Today">
      {/* Clamped responsive height — never a fixed magic px that breaks wallboards. */}
      <div className="relative w-full" style={{ height: 'clamp(200px, 26vh, 340px)' }}>
        {!ready ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 dark:text-ink-faint">
            Loading…
          </div>
        ) : !hasData ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 dark:text-ink-faint">
            No call data for today yet
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,153,184,0.10)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#8B99B8', fontFamily: 'Inter, sans-serif' }}
                  axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tick={{ fontSize: 10, fill: '#8B99B8', fontFamily: 'Inter, sans-serif' }}
                  axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                <Tooltip content={<TrendTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                <Line type="monotone" dataKey="offered"   name="Offered"   stroke="#3B82F6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="answered"  name="Answered"  stroke="#27C98A" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="abandoned" name="Abandoned" stroke="#EF4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            {!anyVolume && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[10px] text-gray-400 dark:text-ink-faint bg-white/80 dark:bg-panel-surface/80 px-2 py-1 rounded">
                  No calls today
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

// ─── Agent Utilization — Today (canonical period occupancy) ───────────────────
// Reuses the backend's (ring+talk)/available formula aggregated across agents for
// the business day. PERIOD metric (labelled "Today"), NOT instantaneous. The live
// state counts below are contextual only — NOT components of the occupancy formula.

function UtilizationCard({ util, agents }) {
  const pct = util?.pct;
  const counts = countAgentStates(agents);
  const tone = pct == null ? '#8B99B8' : pct >= 85 ? '#EF4444' : pct >= 70 ? '#F5A623' : '#27C98A';

  return (
    <Panel eyebrow="Today" title="Agent Utilization">
      <div className="space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-400 dark:text-ink-faint">
            Today
          </p>
          <p className="text-metric mt-0.5" style={{ color: tone }}>
            {pct == null ? '—' : `${pct}%`}
          </p>
          <p className="text-[10px] text-gray-400 dark:text-ink-faint mt-1 leading-relaxed">
            (Ring + Talk) ÷ Available time · excludes ACW/hold
          </p>
        </div>
        <div className="pt-2 border-t border-gray-100 dark:border-panel-border/40 grid grid-cols-2 gap-x-3 gap-y-1">
          {AGENT_STATUS.filter(s => s.key !== 'Offline').map(s => (
            <div key={s.key} className="flex items-center gap-2 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="flex-1 text-gray-500 dark:text-ink-dim truncate">{s.label}</span>
              <span className="font-mono tnum font-semibold text-gray-700 dark:text-ink">{counts[s.key]}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const MAX_ACTIVITIES = 14;

export default function Dashboard() {
  const [stats,       setStats]       = useState(null);
  const [queueStats,  setQueueStats]  = useState([]);
  const [liveAgents,  setLiveAgents]  = useState([]);
  const [trend,       setTrend]       = useState(null);
  const [util,        setUtil]        = useState(null);
  const [auxReady,    setAuxReady]    = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [activities,  setActivities]  = useState([]);
  const actId = useRef(0);

  const addActivity = useCallback((type, text, detail) => {
    setActivities(prev => [
      { id: ++actId.current, type, text, detail, ts: Date.now() },
      ...prev,
    ].slice(0, MAX_ACTIVITIES));
  }, []);

  const load = useCallback(async () => {
    // Core dashboard (dashboard + queues) drives the loading/error state. The
    // three new operational sources are fetched resiliently (allSettled) so a
    // failure in one never blanks the whole dashboard.
    const [s, qs, la, tr, ut] = await Promise.allSettled([
      Stats.dashboard(),
      Stats.queues(),
      Stats.liveAgents(),
      Stats.callsTrend(),
      Stats.utilization(),
    ]);

    if (s.status === 'fulfilled' && qs.status === 'fulfilled') {
      setStats(s.value);
      setQueueStats(qs.value);
      setError(null);
    } else {
      setError((s.reason || qs.reason)?.message || 'Failed to load dashboard');
    }
    if (la.status === 'fulfilled') setLiveAgents(Array.isArray(la.value?.agents) ? la.value.agents : []);
    if (tr.status === 'fulfilled') setTrend(Array.isArray(tr.value) ? tr.value : []);
    if (ut.status === 'fulfilled') setUtil(ut.value);
    setAuxReady(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000);
    return () => clearInterval(poll);
  }, [load]);

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
    addActivity('call:enqueued', `Call entered ${payload?.queue_name || 'queue'}`,
      payload?.caller_id_number);
  }, [addActivity]);

  const onCallBridged = useCallback((payload) => {
    addActivity('call:bridged', 'Call connected to agent',
      payload?.agent_name || payload?.agent_id);
  }, [addActivity]);

  const onCallAbandoned = useCallback((payload) => {
    addActivity('call:abandoned', `Call abandoned in ${payload?.queue_name || 'queue'}`);
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
      <div className="space-y-4">
        <KpiSkeleton count={5} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
          <div className="skeleton h-56 rounded-xl xl:col-span-2" />
          <div className="skeleton h-56 rounded-xl" />
        </div>
        <div className="skeleton h-40 rounded-xl" />
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Panel title="Dashboard unavailable">
        <div className="flex items-start gap-4 py-3">
          <div className="h-10 w-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center
            justify-center shrink-0">
            <LayoutDashboard size={18} strokeWidth={1.5} className="text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-700 dark:text-ink">
              Could not load dashboard data
            </p>
            <p className="text-xs text-gray-400 dark:text-ink-faint mt-1">{error}</p>
            <button onClick={load} className="btn-secondary gap-1.5 mt-3 text-xs">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        </div>
      </Panel>
    );
  }

  const totalWaiting = (stats.queueSnapshot || []).reduce((s, q) => s + q.waiting, 0);
  const abandoned    = stats.callsToday?.abandoned ?? 0;
  const queueDist    = stats.queueDistribution || [];
  const liveByName   = Object.fromEntries((queueStats || []).map(q => [q.queue_name, q]));

  return (
    <div className="space-y-4">

      {/* ── KPI Row — the single authoritative home for global scalars ─────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
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
          sub={totalWaiting > 0 ? 'In queue now' : 'All queues clear'}
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
          sub="Average queue wait"
        />
        <KpiCard
          label="Abandoned"
          value={abandoned}
          tone={abandoned > 0 ? 'red' : 'default'} icon={PhoneMissed}
          sub={stats.callsToday?.total > 0
            ? `${Math.round(abandoned / stats.callsToday.total * 100)}% of total`
            : 'No abandoned calls'}
        />
      </div>

      {/* ── Row 2: Operational health — Queue Health (2/3) beside a stacked
            Service Health + Agent Utilization column (1/3). Stacking the two
            smaller cards fills the vertical space next to the taller Queue Health
            table instead of leaving dead whitespace beside short cards, while
            keeping the left-to-right order Queue → Service → Utilization. ─────── */}
      {/* Primary widgets stacked in a wide left column (2/3); the three compact
          operational cards form a right rail (1/3). Each column flows
          independently (items-start), so the tall Queue Health / Calls Today
          stack never leaves a gap beside the shorter rail, and no card is
          stretched to fill empty space. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2 min-w-0 space-y-4">
          <QueueHealthSection distribution={queueDist} liveByName={liveByName} />
          <CallsTrendCard data={trend} ready={auxReady} />
          {/* Activity Feed lives at the bottom of the wide left column so it sits
              directly under Calls Today — no large gap, and it balances the taller
              right rail instead of forcing a separate full-width row. */}
          <ActivityFeed activities={activities} />
        </div>
        <div className="min-w-0 space-y-4">
          <ServiceHealth stats={stats} />
          <UtilizationCard util={util} agents={liveAgents} />
          <AgentStatusCard agents={liveAgents} />
        </div>
      </div>

    </div>
  );
}
