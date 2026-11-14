import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { Reports as ReportsApi, Stats } from '../api/client.js';
import Panel from '../components/Panel.jsx';
import CDRTable from '../components/reports/CDRTable.jsx';
import AgentSessionsTab from '../components/reports/AgentSessionsTab.jsx';
import { inputClass, buttonPrimary } from '../components/form.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Browser-LOCAL calendar date (YYYY-MM-DD) — never toISOString() (which is UTC and
// causes an off-by-one for evening users). This is only a client-side seed; the
// backend authoritatively re-interprets the chosen dates in BUSINESS_TIMEZONE.
function localIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return localIsoDate(dt);
}

const COLORS = {
  offered:   '#4C8EF5',   // blue
  answered:  '#27C98A',   // green
  abandoned: '#EF4444',   // red
  ivr:       '#F5A623',   // amber
};

// ── IVR section table — reused for all three IVR Paths sections ──────────────

function IvrSection({ title, subtitle, rows, labelKey, labelHeader, color }) {
  const total = rows.reduce((s, r) => s + Number(r.calls), 0);
  return (
    <div>
      <p className="text-xs font-bold text-ink mb-0.5">
        {title}
      </p>
      <p className="text-[0.6875rem] text-ink-faint mb-2">{subtitle}</p>
      <table className="data-table">
        <thead>
          <tr className="border-b dark:border-panel-border border-border text-left">
            <th className="th text-left">
              {labelHeader}
            </th>
            <th className="th text-right">
              Calls
            </th>
            <th className="th text-right">
              Share
            </th>
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-panel-border divide-border">
          {rows.map(r => (
            <tr key={r[labelKey]}
              className="dark:hover:bg-panel-raised/30 hover:bg-surface-2 transition-colors">
              <td className={`py-2 font-medium font-mono tnum ${color}`}>
                {r[labelKey] || '(unknown)'}
              </td>
              <td className="td font-mono tnum text-ink-dim text-right">
                {r.calls}
              </td>
              <td className="td font-mono tnum text-ink-faint text-right">
                {total > 0 ? `${r.share}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'volume',    label: 'Volume Trend' },
  { id: 'queues',    label: 'Queue Performance' },
  { id: 'agents',    label: 'Agent Performance' },
  { id: 'ivr',       label: 'IVR Paths' },
  { id: 'cdr',       label: 'CDR Report' },
  { id: 'sessions',  label: 'Agent Sessions' },
];

function TabBar({ active, onChange }) {
  return (
    <div className="flex gap-0 border-b dark:border-panel-border border-border overflow-x-auto">
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={[
            'px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px',
            active === t.id
              ? 'border-brand text-brand dark:text-brand-light font-bold'
              : 'border-transparent text-ink-dim dark:text-ink-faint hover:text-ink dark:hover:text-ink-dim'
          ].join(' ')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Reports() {
  const isDark = useIsDark();
  const grid   = isDark ? { stroke: '#1C2A42' } : { stroke: '#e5e7eb' };
  const axis   = isDark
    ? { stroke: '#2A3A56', fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif', fill: 'rgb(var(--text-secondary))' }
    : { stroke: '#C5D0DD', fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif', fill: 'rgb(var(--text-secondary))' };
  const ttip   = isDark
    ? { background: '#0B1220', border: '1px solid #1C2A42', borderRadius: 6, fontSize: 12, color: '#E8ECF6' }
    : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, color: '#111827' };

  const [tab,  setTab]  = useState('volume');
  const [from, setFrom] = useState(addDaysStr(localIsoDate(new Date()), -6));
  const [to,   setTo]   = useState(localIsoDate(new Date()));

  // Seed the date range from the server-authoritative business calendar date so
  // "today" reflects BUSINESS_TIMEZONE rather than the browser's local/UTC date.
  useEffect(() => {
    Stats.businessDate()
      .then(({ business_date }) => {
        if (business_date) { setTo(business_date); setFrom(addDaysStr(business_date, -6)); }
      })
      .catch(() => { /* keep local-date seed on failure */ });
  }, []);

  const [volume,    setVolume]    = useState([]);
  const [queuePerf, setQueuePerf] = useState([]);
  const [agentPerf, setAgentPerf] = useState([]);
  const [ivrPaths,  setIvrPaths]  = useState({ dtmf: [], queues: [], other: [] });
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  // Load data for the non-CDR tabs (CDRTable fetches its own)
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { from, to };
      const [v, qp, ap, ivr] = await Promise.all([
        ReportsApi.callVolume(params),
        ReportsApi.queuePerformance(params),
        ReportsApi.agentPerformance(params),
        ReportsApi.ivrPaths(params)
      ]);
      setVolume(v);
      setQueuePerf(qp);
      setAgentPerf(ap);
      setIvrPaths(ivr);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => { load(); }, []);

  const thClass = 'th whitespace-nowrap';

  return (
    <div className="space-y-4">

      {/* Date range + Apply + CSV exports */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-ink-dim mb-1.5">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-dim mb-1.5">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputClass} />
        </div>
        <button className={buttonPrimary} onClick={load}>Apply</button>

        {/* CSV export links — only show for non-CDR tabs (CDR has its own export) */}
        {tab !== 'cdr' && (
          <div className="flex gap-2 ml-auto">
            {[
              { label: 'Queue CSV',  type: 'queue-performance', fmt: 'csv' },
              { label: 'Agent CSV',  type: 'agent-performance',  fmt: 'csv' },
              { label: 'Volume CSV', type: 'call-volume',         fmt: 'csv' }
            ].map(({ label, type, fmt }) => (
              <a
                key={type}
                href={ReportsApi.exportUrl(type, fmt, from, to)}
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded
                  dark:bg-panel-border/60 bg-surface-2 text-ink-dim
                  dark:hover:bg-panel-border hover:bg-border transition-colors"
              >
                <Download size={12} />
                {label}
              </a>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-lamp-alert">{error}</p>}

      {/* Tab navigation */}
      <TabBar active={tab} onChange={setTab} />

      {/* ── Volume Trend ─────────────────────────────────────────────────── */}
      {tab === 'volume' && (
        <Panel eyebrow="Trend" title="Call Volume">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={volume}>
                <CartesianGrid strokeDasharray="3 3" {...grid} vertical={false} />
                <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={{ stroke: grid.stroke }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={ttip} />
                <Legend wrapperStyle={{ fontSize: 12, color: isDark ? '#8891A3' : '#6b7280' }} />
                <Line type="monotone" dataKey="offered"   stroke={COLORS.offered}   strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="answered"  stroke={COLORS.answered}  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="abandoned" stroke={COLORS.abandoned} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* ── Queue Performance ─────────────────────────────────────────────── */}
      {tab === 'queues' && (
        <Panel eyebrow="Historical" title="Queue Performance" noPad>
          {loading ? (
            <div className="p-6"><p className="text-sm text-ink-dim">Loading…</p></div>
          ) : queuePerf.length === 0 ? (
            <div className="p-6"><p className="text-sm text-ink-dim">No calls in this date range.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr className="border-b border-border dark:border-panel-border">
                    {[
                      'Queue', 'Offered', 'Answered',
                      'Abandoned Queue', 'Missed by Agent',
                      'ASA', 'Avg Talk', 'Abandon %', 'SLA %'
                    ].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[0.6875rem] font-bold
                        text-ink-dim bg-surface-2 dark:bg-panel-raised whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border dark:divide-panel-border">
                  {queuePerf.map(q => (
                    <tr key={q.queue_name}
                      className="hover:bg-blue-50/40 dark:hover:bg-panel-raised/40 transition-colors">
                      <td className="td font-semibold text-ink">{q.queue_name}</td>
                      <td className="td font-mono tnum text-ink-dim">{q.offered}</td>
                      <td className="td font-mono tnum text-emerald-600 dark:text-emerald-400 font-semibold">{q.answered}</td>
                      <td className="td font-mono tnum text-red-500 dark:text-red-400">{q.abandoned_queue ?? q.abandoned}</td>
                      <td className="td font-mono tnum text-orange-500 dark:text-orange-400">{q.abandoned_agent ?? 0}</td>
                      <td className="td font-mono tnum text-ink-dim">{q.asa_seconds}s</td>
                      <td className="td font-mono tnum text-ink-dim">{(q.avg_talk_seconds ?? q.aht_seconds)}s</td>
                      <td className="td font-mono tnum text-lamp-alert">{q.abandon_rate_pct}%</td>
                      <td className="td font-mono tnum text-emerald-600 dark:text-emerald-400">
                        {q.sla_pct != null ? `${q.sla_pct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ── Agent Performance ─────────────────────────────────────────────── */}
      {tab === 'agents' && (
        <Panel eyebrow="Historical" title="Agent Performance" noPad>
          {loading ? (
            <div className="p-6"><p className="text-sm text-ink-dim">Loading…</p></div>
          ) : agentPerf.length === 0 ? (
            <div className="p-6"><p className="text-sm text-ink-dim">No agent activity in this date range.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr className="border-b border-border dark:border-panel-border">
                    {[
                      'Agent',
                      'Calls Offered',
                      'Calls Answered',
                      'Calls Missed',
                      'Avg Talk (min)',
                      'Total Talk (min)'
                    ].map(h => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[0.6875rem] font-bold
                          text-ink-dim bg-surface-2 dark:bg-panel-raised whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border dark:divide-panel-border">
                  {agentPerf.map(a => (
                    <tr
                      key={a.agent_id}
                      className="hover:bg-blue-50/40 dark:hover:bg-panel-raised/40 transition-colors"
                    >
                      <td className="td">
                        <p className="font-semibold text-ink">
                          {a.full_name || a.agent_id}
                        </p>
                        <p className="text-[0.6875rem] text-ink-faint font-mono">
                          {a.agent_id}
                        </p>
                      </td>
                      <td className="td font-mono tnum text-ink-dim">
                        {a.calls_offered}
                      </td>
                      <td className="td font-mono tnum font-semibold text-emerald-600 dark:text-emerald-400">
                        {a.calls_answered}
                      </td>
                      <td className="td font-mono tnum text-orange-500 dark:text-orange-400">
                        {a.calls_missed}
                      </td>
                      <td className="td font-mono tnum text-ink-dim">
                        {a.avg_talk_min ?? '—'}
                      </td>
                      <td className="td font-mono tnum text-ink-dim">
                        {a.total_talk_min ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ── IVR / Call-Flow Activity ──────────────────────────────────────── */}
      {tab === 'ivr' && (
        <Panel eyebrow="IVR" title="Call Flow Activity">
          {loading ? (
            <p className="text-sm text-ink-dim">Loading…</p>
          ) : (ivrPaths.queues.length === 0 && ivrPaths.other.length === 0) ? (
            <p className="text-sm text-ink-dim">No IVR data in this date range.</p>
          ) : (
            <div className="space-y-6">

              {/* ── Section: Queue Destinations ───────────────────────────── */}
              {ivrPaths.queues.length > 0 && (
                <IvrSection
                  title="Queue Destinations"
                  subtitle="Calls that actually entered a SIPCommunication queue (based on confirmed queue membership)."
                  rows={ivrPaths.queues}
                  labelKey="queue"
                  labelHeader="Queue"
                  color="text-lamp-ok"
                />
              )}

              {/* ── Section: Other System Events ──────────────────────────── */}
              {ivrPaths.other.length > 0 && (
                <IvrSection
                  title="Other System Events"
                  subtitle="SIPCommunication application and system events recorded during the call."
                  rows={ivrPaths.other}
                  labelKey="step"
                  labelHeader="Event"
                  color="text-ink-dim"
                />
              )}

            </div>
          )}
        </Panel>
      )}

      {/* ── CDR Report ────────────────────────────────────────────────────── */}
      {tab === 'cdr' && <CDRTable from={from} to={to} />}

      {/* ── Agent Sessions (Phase 2) ──────────────────────────────────────── */}
      {tab === 'sessions' && <AgentSessionsTab from={from} to={to} />}

    </div>
  );
}
