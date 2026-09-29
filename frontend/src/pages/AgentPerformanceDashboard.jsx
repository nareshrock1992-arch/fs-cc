import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, PhoneIncoming, PhoneMissed, CheckCircle2, Timer, Phone, Radio, Trophy, Award, Zap,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { Reports, Agents as AgentsApi } from '../api/client.js';
import KpiCard from '../components/KpiCard.jsx';
import Panel from '../components/Panel.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import AgentSessionsTab from '../components/reports/AgentSessionsTab.jsx';

// ── Formatters (seconds → m:ss / h:mm:ss; percentages) ────────────────────────
function fmtSec(s) {
  if (s == null || s === '') return '—';
  const n = Number(s);
  if (Number.isNaN(n) || n < 0) return '—';
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), r = String(n % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const fmtPct = v => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

// ── Range-level KPI derivation (from TOTALS, never averages-of-averages) ───────
// When a single agent is selected, the backend row already carries the exact
// per-agent values (incl. avg_ring_seconds = AVG excluding NULL); use them as-is.
// For "All agents", counts/totals sum exactly; averages are recomputed from
// totals: answer_rate = Σanswered/Σoffered, avg_talk = Σtotal_talk/Σanswered,
// avg_ring = Σtotal_ring/Σoffered (per-offered-leg weighted).
function deriveKpis(rows, singleAgentRow) {
  if (singleAgentRow) {
    const r = singleAgentRow;
    return {
      offered: num(r.calls_offered), answered: num(r.calls_answered), missed: num(r.calls_missed),
      answer_rate: r.answer_rate == null ? null : Number(r.answer_rate),
      avg_talk: num(r.avg_talk_seconds), total_talk: num(r.total_talk_seconds),
      avg_ring: num(r.avg_ring_seconds),
    };
  }
  const t = rows.reduce((a, r) => ({
    offered: a.offered + num(r.calls_offered),
    answered: a.answered + num(r.calls_answered),
    missed: a.missed + num(r.calls_missed),
    total_talk: a.total_talk + num(r.total_talk_seconds),
    total_ring: a.total_ring + num(r.total_ring_seconds),
  }), { offered: 0, answered: 0, missed: 0, total_talk: 0, total_ring: 0 });
  return {
    offered: t.offered, answered: t.answered, missed: t.missed,
    answer_rate: t.offered ? Math.round((t.answered / t.offered) * 1000) / 10 : null,
    avg_talk: t.answered ? Math.round(t.total_talk / t.answered) : 0,
    total_talk: t.total_talk,
    avg_ring: t.offered ? Math.round(t.total_ring / t.offered) : 0,
  };
}

// ── Build the daily trend series (aggregate per-day when All agents) ──────────
function buildDaily(dailyRows, singleAgent) {
  if (singleAgent) {
    return [...dailyRows]
      .sort((a, b) => String(a.day).localeCompare(String(b.day)))
      .map(r => ({
        day: String(r.day), offered: num(r.calls_offered), answered: num(r.calls_answered),
        missed: num(r.calls_missed), answer_rate: r.answer_rate == null ? 0 : Number(r.answer_rate),
        avg_talk: num(r.avg_talk_seconds), avg_ring: num(r.avg_ring_seconds),
      }));
  }
  const g = new Map();
  for (const r of dailyRows) {
    const k = String(r.day);
    if (!g.has(k)) g.set(k, { day: k, offered: 0, answered: 0, missed: 0, total_talk: 0, total_ring: 0 });
    const d = g.get(k);
    d.offered += num(r.calls_offered); d.answered += num(r.calls_answered); d.missed += num(r.calls_missed);
    d.total_talk += num(r.total_talk_seconds); d.total_ring += num(r.total_ring_seconds);
  }
  return [...g.values()].sort((a, b) => a.day.localeCompare(b.day)).map(d => ({
    day: d.day, offered: d.offered, answered: d.answered, missed: d.missed,
    answer_rate: d.offered ? Math.round((d.answered / d.offered) * 1000) / 10 : 0,
    avg_talk: d.answered ? Math.round(d.total_talk / d.answered) : 0,
    avg_ring: d.offered ? Math.round(d.total_ring / d.offered) : 0,
  }));
}

function dayLabel(d) { const [, m, day] = String(d).split('-'); return `${day}/${m}`; }

// ── Sortable comparison table ─────────────────────────────────────────────────
const COLS = [
  { key: 'full_name',          label: 'Agent',       align: 'left',  fmt: (r) => r.full_name || r.agent_id },
  { key: 'calls_offered',      label: 'Offered',     align: 'right', fmt: (r) => num(r.calls_offered) },
  { key: 'calls_answered',     label: 'Answered',    align: 'right', fmt: (r) => num(r.calls_answered) },
  { key: 'calls_missed',       label: 'Missed',      align: 'right', fmt: (r) => num(r.calls_missed) },
  { key: 'answer_rate',        label: 'Answer Rate', align: 'right', fmt: (r) => fmtPct(r.answer_rate) },
  { key: 'avg_talk_seconds',   label: 'Avg Talk',    align: 'right', fmt: (r) => fmtSec(r.avg_talk_seconds) },
  { key: 'total_talk_seconds', label: 'Total Talk',  align: 'right', fmt: (r) => fmtSec(r.total_talk_seconds) },
  { key: 'avg_ring_seconds',   label: 'Avg Ring',    align: 'right', fmt: (r) => fmtSec(r.avg_ring_seconds) },
];

export default function AgentPerformanceDashboard() {
  const [from, setFrom]   = useState('');
  const [to, setTo]       = useState('');
  const [agent, setAgent] = useState('');           // '' = All agents
  const [agents, setAgents] = useState([]);
  const [rows, setRows]   = useState([]);           // /reports/agent-performance
  const [daily, setDaily] = useState([]);           // /reports/agent-daily
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('calls_answered');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => { AgentsApi.list().then(setAgents).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = { from: from || undefined, to: to || undefined };
      const [perf, day] = await Promise.all([
        Reports.agentPerformance(params),
        Reports.agentDaily({ ...params, agent: agent || undefined }),
      ]);
      setRows(Array.isArray(perf) ? perf : []);
      setDaily(Array.isArray(day) ? day : []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load agent performance');
    } finally { setLoading(false); }
  }, [from, to, agent]);

  useEffect(() => { load(); }, [load]);

  const singleAgentRow = agent ? rows.find(r => r.agent_id === agent) || null : null;
  const kpi = useMemo(() => deriveKpis(rows, singleAgentRow), [rows, singleAgentRow]);
  const series = useMemo(() => buildDaily(daily, Boolean(agent)), [daily, agent]);

  const tableRows = useMemo(() => {
    const list = agent ? rows.filter(r => r.agent_id === agent) : rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'full_name') return String(av || a.agent_id).localeCompare(String(bv || b.agent_id)) * dir;
      return (num(av) - num(bv)) * dir;
    });
  }, [rows, agent, sortKey, sortDir]);

  // Recognition selection — transparent, metric-specific, NO composite score.
  // Deterministic ties (primary metric → supporting volume → agent_id asc).
  //   All agents  → 3 team award winners.
  //   One agent   → that agent's own summary on the same 3 metrics (never
  //                 "top performer against themselves").
  const recognition = useMemo(() => {
    if (rows.length === 0) return null;
    const nm = r => r.full_name || r.agent_id;

    if (agent) {
      const r = singleAgentRow || rows.find(x => x.agent_id === agent);
      if (!r) return null;
      return {
        mode: 'single',
        title: `Agent Performance — ${nm(r)}`,
        cards: [
          { label: 'Calls Answered',              who: nm(r), value: `${num(r.calls_answered)} calls`, sub: `of ${num(r.calls_offered)} offered` },
          { label: 'Answer Rate',                 who: nm(r), value: fmtPct(r.answer_rate),            sub: `${num(r.calls_answered)}/${num(r.calls_offered)} answered/offered` },
          { label: 'Fastest Response (Avg Ring)', who: nm(r), value: fmtSec(r.avg_ring_seconds),        sub: `${num(r.calls_answered)} answered` },
        ],
      };
    }

    const idAsc = (a, b) => String(a.agent_id).localeCompare(String(b.agent_id));
    const mostAnswered = [...rows].sort((a, b) =>
      num(b.calls_answered) - num(a.calls_answered) || Number(b.answer_rate) - Number(a.answer_rate) || idAsc(a, b))[0];
    const bestRate = [...rows].sort((a, b) =>
      Number(b.answer_rate) - Number(a.answer_rate) || num(b.calls_answered) - num(a.calls_answered) || idAsc(a, b))[0];
    const fastest = [...rows].sort((a, b) =>
      num(a.avg_ring_seconds) - num(b.avg_ring_seconds) || num(b.calls_answered) - num(a.calls_answered) || idAsc(a, b))[0];

    return {
      mode: 'team',
      title: 'Recognition',
      cards: [
        { icon: 'trophy', label: 'Most Calls Answered', who: nm(mostAnswered), value: `${num(mostAnswered.calls_answered)} calls`,       sub: `${fmtPct(mostAnswered.answer_rate)} answer rate` },
        { icon: 'award',  label: 'Highest Answer Rate', who: nm(bestRate),     value: fmtPct(bestRate.answer_rate),                     sub: `${num(bestRate.calls_answered)}/${num(bestRate.calls_offered)} answered/offered` },
        { icon: 'zap',    label: 'Fastest Response',    who: nm(fastest),      value: `${fmtSec(fastest.avg_ring_seconds)} avg ring`,    sub: `${num(fastest.calls_answered)} answered` },
      ],
    };
  }, [rows, agent, singleAgentRow]);

  function toggleSort(key) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'full_name' ? 'asc' : 'desc'); }
  }

  const scope = agent ? (agents.find(a => a.agent_id === agent)?.full_name || agent) : 'All agents';

  return (
    <div className="space-y-4">
      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">From</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="field-input w-auto" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">To</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="field-input w-auto" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Agent</span>
          <select value={agent} onChange={e => setAgent(e.target.value)} className="field-input w-auto">
            <option value="">All agents</option>
            {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.full_name} ({a.agent_id})</option>)}
          </select>
        </label>
        <span className="text-[11px] text-ink-faint pb-2">
          Scope: <strong className="text-ink-dim">{scope}</strong>
          {!from && !to && ' · default: last 7 business days'}
        </span>
      </div>

      {loading && <LoadingState rows={4} cols={6} label="Loading agent performance…" />}

      {error && !loading && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {!loading && !error && (
        <>
          {/* ① Recognition — the primary focus (transparent, metric-specific) */}
          {rows.length > 0 && <RecognitionHero recognition={recognition} />}

          {/* ② Team KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <KpiCard label="Calls Offered"  value={kpi.offered}  tone="blue"   icon={Phone} />
            <KpiCard label="Calls Answered" value={kpi.answered} tone="green"  icon={CheckCircle2} />
            <KpiCard label="Calls Missed"   value={kpi.missed}   tone={kpi.missed > 0 ? 'red' : 'default'} icon={PhoneMissed} />
            <KpiCard label="Answer Rate"    value={kpi.answer_rate == null ? '—' : `${kpi.answer_rate}`} suffix={kpi.answer_rate == null ? '' : '%'} tone="green" icon={PhoneIncoming} />
            <KpiCard label="Avg Talk"       value={fmtSec(kpi.avg_talk)}  tone="default" icon={Timer} />
            <KpiCard label="Total Talk"     value={fmtSec(kpi.total_talk)} tone="default" icon={Timer} />
            <KpiCard label="Avg Ring"       value={fmtSec(kpi.avg_ring)}  tone="amber"   icon={Radio} />
          </div>

          {rows.length === 0 ? (
            <Panel><EmptyState icon={Users} title="No agent activity" body="No agent legs were recorded for the selected period." /></Panel>
          ) : (
            <>
              {/* ── Comparison table ──────────────────────────────────────────── */}
              <Panel eyebrow="Historical" title="Agent Comparison" noPad>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {COLS.map(c => (
                          <th key={c.key}
                            onClick={() => toggleSort(c.key)}
                            className={`th cursor-pointer select-none ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                            {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map(r => (
                        <tr key={r.agent_id} className="tr-row">
                          {COLS.map(c => (
                            <td key={c.key} className={`${c.align === 'right' ? 'td-num' : 'td'} ${c.key === 'full_name' ? 'font-semibold' : ''}`}>
                              {c.fmt(r)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              {/* ── Daily trends ──────────────────────────────────────────────── */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Panel eyebrow="Trend" title="Offered · Answered · Missed">
                  <TrendChart data={series} kind="bars" />
                </Panel>
                <Panel eyebrow="Trend" title="Answer Rate">
                  <TrendChart data={series} kind="rate" />
                </Panel>
                <Panel eyebrow="Trend" title="Avg Talk (seconds)">
                  <TrendChart data={series} kind="talk" />
                </Panel>
                <Panel eyebrow="Trend" title="Avg Ring (seconds)">
                  <TrendChart data={series} kind="ring" />
                </Panel>
              </div>

              {/* ── Individual drill-down (reuses AgentSessionsTab) ────────────── */}
              <Panel eyebrow="Drill-down" title="Agent Sessions & Activity" noPad>
                <div className="p-2">
                  <AgentSessionsTab from={from} to={to} />
                </div>
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Recognition hero — the primary, professional recognition band ────────────
// Team mode: 3 metric-specific award cards. Single-agent mode: that agent's own
// summary on the same 3 metrics. Every card states the metric + value + context.
function RecognitionHero({ recognition }) {
  if (!recognition) return null;
  const ICON = { trophy: Trophy, award: Award, zap: Zap };
  const isTeam = recognition.mode === 'team';
  return (
    <Panel eyebrow={isTeam ? 'This period' : 'Selected agent'} title={recognition.title}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {recognition.cards.map((c, i) => {
          const Ico = isTeam ? (ICON[c.icon] || Trophy) : Award;
          return (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 px-4 py-4 shadow-card">
              <span className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Ico size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-faint">{c.label}</p>
                <p className="text-lg font-semibold text-ink truncate leading-tight">{c.who}</p>
                <p className="text-base font-mono font-semibold text-primary tabular-nums mt-0.5">{c.value}</p>
                {c.sub && <p className="text-[11px] text-ink-dim mt-0.5">{c.sub}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {isTeam && (
        <p className="text-[11px] text-ink-faint mt-3">
          Metric-specific recognition — no composite score. Ties broken by supporting volume, then agent&nbsp;ID.
        </p>
      )}
    </Panel>
  );
}

// ── Recharts trend renderer ───────────────────────────────────────────────────
function TrendChart({ data, kind }) {
  if (!data || data.length === 0) {
    return <p className="text-xs text-ink-faint py-8 text-center">No daily data for the selected period.</p>;
  }
  const axisTick = { fontSize: 10, fill: '#8B99B8', fontFamily: 'Inter, sans-serif' };
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,153,184,0.12)" vertical={false} />
      <XAxis dataKey="day" tickFormatter={dayLabel} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
      <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
      <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={dayLabel} />
    </>
  );
  return (
    <ResponsiveContainer width="100%" height={200}>
      {kind === 'bars' ? (
        <BarChart data={data} margin={{ top: 4, right: 6, left: -20, bottom: 0 }} barCategoryGap="25%">
          {common}
          <Bar dataKey="offered"  name="Offered"  fill="#3B82F6" radius={[2, 2, 0, 0]} />
          <Bar dataKey="answered" name="Answered" fill="#27C98A" radius={[2, 2, 0, 0]} />
          <Bar dataKey="missed"   name="Missed"   fill="#EF4444" radius={[2, 2, 0, 0]} />
        </BarChart>
      ) : (
        <LineChart data={data} margin={{ top: 4, right: 6, left: -20, bottom: 0 }}>
          {common}
          <Line type="monotone"
            dataKey={kind === 'rate' ? 'answer_rate' : kind === 'talk' ? 'avg_talk' : 'avg_ring'}
            name={kind === 'rate' ? 'Answer Rate %' : kind === 'talk' ? 'Avg Talk (s)' : 'Avg Ring (s)'}
            stroke={kind === 'rate' ? '#27C98A' : kind === 'talk' ? '#2563EB' : '#F5A623'}
            strokeWidth={2} dot={false} />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}
