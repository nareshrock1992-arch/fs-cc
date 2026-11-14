import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Reports as ReportsApi } from '../../api/client.js';

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtSec(s) {
  if (s == null || s === '') return '—';
  const n = Number(s);
  if (Number.isNaN(n) || n < 0) return '—';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const r = String(n % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function fmtOcc(pct) {
  // IMPORTANT: null means no Available time — display as "—", never "0%" or NaN
  if (pct == null) return '—';
  const n = Number(pct);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtTs(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Shared table header cell ──────────────────────────────────────────────────

function TH({ children, right = false }) {
  return (
    <th className={[
      'th px-3',
      right ? 'text-right' : 'text-left',
    ].join(' ')}>
      {children}
    </th>
  );
}

// ── Metric card (used inside agent detail modal) ──────────────────────────────

function MetricCard({ label, value }) {
  return (
    <div className="px-4 py-3 rounded-lg bg-surface-2 dark:bg-panel-raised border border-border dark:border-panel-border">
      <p className="text-[0.6875rem] font-bold text-ink-faint">
        {label}
      </p>
      <p className="text-lg font-mono font-semibold text-ink mt-0.5 tabular-nums">
        {value}
      </p>
    </div>
  );
}

// ── Agent detail modal ────────────────────────────────────────────────────────

function AgentDetailModal({ agentId, agentName, from, to, onClose }) {
  const [detail,   setDetail]   = useState(null);
  const [sessions, setSessions] = useState([]);
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = { from, to };
        const [detailRes, sessRes, evtRes] = await Promise.all([
          ReportsApi.agentActivityDetail(agentId, params),
          ReportsApi.agentSessionsList(agentId, params),
          ReportsApi.agentStateEvents(agentId, params),
        ]);
        if (!cancelled) {
          setDetail(detailRes);
          setSessions(sessRes.sessions ?? []);
          setEvents(evtRes.events ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [agentId, from, to]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 pb-8">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-4xl max-h-[85vh] overflow-y-auto
        bg-white dark:bg-panel-surface rounded-xl shadow-card-hover
        border border-border dark:border-panel-border">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4
          border-b border-border dark:border-panel-border
          sticky top-0 bg-white dark:bg-panel-surface z-10">
          <div>
            <h3 className="text-base font-bold text-ink">
              {agentName || agentId}
            </h3>
            <p className="text-xs text-ink-faint mt-0.5 font-mono">
              {agentId} · {from} → {to}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-ink-faint hover:text-ink
              dark:hover:text-ink transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-ink-faint">
              <RefreshCw size={14} className="animate-spin" />
              Loading agent data…
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200
              text-sm text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && detail && (
            <>
              {/* Warnings for live/open state */}
              {detail.open_warnings?.length > 0 && (
                <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200
                  text-sm text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400
                  space-y-0.5">
                  {detail.open_warnings.map((w, i) => <p key={i}>{w}</p>)}
                </div>
              )}

              {/* Metrics grid */}
              <div className="kpi-grid [--kpi-min:8.5rem]">
                <MetricCard label="Sessions"      value={detail.sessions?.count ?? '—'} />
                <MetricCard label="Login Time"    value={fmtSec(detail.sessions?.total_login_seconds)} />
                <MetricCard label="Available"     value={fmtSec(detail.state_durations?.available_seconds)} />
                <MetricCard label="Break"         value={fmtSec(detail.state_durations?.break_seconds)} />
                <MetricCard label="Occupancy"     value={fmtOcc(detail.occupancy?.pct)} />
                <MetricCard label="Calls Offered" value={detail.call_metrics?.calls_offered ?? 0} />
                <MetricCard label="Answered"      value={detail.call_metrics?.calls_answered ?? 0} />
                <MetricCard label="Missed"        value={detail.call_metrics?.calls_missed ?? 0} />
                {/* NOTE: labeled "Avg Talk" — NOT "AHT". avg_talk_seconds ≠ AHT */}
                <MetricCard label="Avg Talk"      value={fmtSec(detail.call_metrics?.avg_talk_seconds)} />
                <MetricCard label="Total Talk"    value={fmtSec(detail.call_metrics?.total_talk_seconds)} />
                <MetricCard label="Break Count"   value={detail.breaks?.count ?? 0} />
                <MetricCard label="Longest Break" value={fmtSec(detail.breaks?.longest_seconds)} />
              </div>

              {/* Session list */}
              {sessions.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-ink mb-2">
                    Sessions ({sessions.length})
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-border dark:border-panel-border">
                    <table className="data-table">
                      <thead>
                        <tr className="border-b border-border dark:border-panel-border">
                          <TH>Login</TH>
                          <TH>Logout</TH>
                          <TH right>Duration</TH>
                          <TH>Reason</TH>
                          <TH>Status</TH>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border dark:divide-panel-border">
                        {sessions.map(s => (
                          <tr key={s.id}
                            className="hover:bg-surface-2 dark:hover:bg-panel-raised/40 transition-colors">
                            <td className="td text-ink-dim whitespace-nowrap">
                              {fmtTs(s.login_at)}
                            </td>
                            <td className="td text-ink-dim whitespace-nowrap">
                              {fmtTs(s.logout_at)}
                            </td>
                            <td className="td font-mono tabular-nums text-right
                              text-ink">
                              {fmtSec(s.duration_seconds)}
                            </td>
                            <td className="td text-ink-dim dark:text-ink-faint text-xs">
                              {s.logout_reason ?? '—'}
                            </td>
                            <td className="td">
                              {s.is_open && (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[0.6875rem] font-bold
                                  bg-emerald-100 text-emerald-700
                                  dark:bg-emerald-900/30 dark:text-emerald-400">
                                  LIVE
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* State events */}
              {events.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-ink mb-2">
                    State Events ({events.length})
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-border dark:border-panel-border">
                    <table className="data-table">
                      <thead>
                        <tr className="border-b border-border dark:border-panel-border">
                          <TH>Status</TH>
                          <TH>Started</TH>
                          <TH>Ended</TH>
                          <TH right>Duration</TH>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border dark:divide-panel-border">
                        {events.map(e => (
                          <tr key={e.id}
                            className="hover:bg-surface-2 dark:hover:bg-panel-raised/40 transition-colors">
                            <td className="td">
                              <span className={[
                                'inline-flex px-2 py-0.5 rounded-full text-[0.6875rem] font-bold',
                                e.status === 'Available'
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                              ].join(' ')}>
                                {e.status}
                              </span>
                            </td>
                            <td className="td text-ink-dim whitespace-nowrap">
                              {fmtTs(e.started_at)}
                            </td>
                            <td className="td text-ink-dim whitespace-nowrap">
                              {fmtTs(e.ended_at)}
                            </td>
                            <td className="td font-mono tabular-nums text-right
                              text-ink">
                              {fmtSec(e.duration_seconds)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* No data case */}
              {sessions.length === 0 && events.length === 0 && (
                <p className="text-sm text-ink-faint">
                  No session or state event data for this agent in the selected range.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main tab component ────────────────────────────────────────────────────────

export default function AgentSessionsTab({ from, to }) {
  const [data,     setData]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [selected, setSelected] = useState(null); // { agentId, agentName }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ReportsApi.agentActivity({ from, to });
      setData(result.agents ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white dark:bg-panel-surface rounded-xl shadow-md
      border border-border dark:border-panel-border overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4
        border-b border-border dark:border-panel-border">
        <div>
          <h3 className="text-base font-bold text-ink">
            Agent Sessions
          </h3>
          <p className="text-xs text-ink-faint mt-0.5">
            Login · availability · call metrics per agent — click a row to drill down
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          title="Refresh"
          className="p-2 rounded-lg border border-border dark:border-panel-border
            text-ink-dim dark:text-ink-faint
            hover:text-ink dark:hover:text-ink
            hover:bg-surface-2 dark:hover:bg-panel-border
            transition-colors disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-lg
          bg-red-50 border border-red-200 text-sm text-red-700
          dark:bg-red-900/20 dark:border-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="data-table min-w-[1100px]">
          <thead>
            <tr className="border-b border-border dark:border-panel-border">
              <TH>Agent</TH>
              <TH right>Sessions</TH>
              <TH right>Login Time</TH>
              <TH right>Available</TH>
              <TH right>Break</TH>
              <TH right>Occupancy</TH>
              <TH right>Offered</TH>
              <TH right>Answered</TH>
              <TH right>Missed</TH>
              <TH right>Total Ring</TH>
              <TH right>Total Talk</TH>
              {/* Column labeled "Avg Talk" — NOT "AHT". avg_talk_seconds ≠ AHT */}
              <TH right>Avg Talk</TH>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-panel-border">

            {/* Loading skeleton */}
            {loading && (
              <tr>
                <td colSpan={12}
                  className="py-12 text-center text-sm text-ink-faint">
                  <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-blue-400" />
                  Loading agent sessions…
                </td>
              </tr>
            )}

            {/* Empty */}
            {!loading && data.length === 0 && !error && (
              <tr>
                <td colSpan={12}
                  className="py-12 text-center text-sm text-ink-faint">
                  No agent session data for this date range.
                </td>
              </tr>
            )}

            {/* Data rows */}
            {data.map(a => (
              <tr
                key={a.agent_id}
                onClick={() => setSelected({ agentId: a.agent_id, agentName: a.full_name })}
                className="hover:bg-blue-50/40 dark:hover:bg-panel-raised/40
                  transition-colors cursor-pointer"
              >
                <td className="td">
                  <p className="font-semibold text-ink">
                    {a.full_name || a.agent_id}
                  </p>
                  <p className="text-[0.6875rem] text-ink-faint font-mono">
                    {a.agent_id}
                  </p>
                </td>
                <td className="td font-mono tabular-nums text-right
                  text-ink-dim">
                  {a.session_count ?? 0}
                </td>
                <td className="td font-mono tabular-nums text-right
                  text-ink-dim">
                  {fmtSec(a.total_login_seconds)}
                </td>
                <td className="td font-mono tabular-nums text-right
                  text-emerald-600 dark:text-emerald-400">
                  {fmtSec(a.available_seconds)}
                </td>
                <td className="td font-mono tabular-nums text-right
                  text-amber-600 dark:text-amber-400">
                  {fmtSec(a.break_seconds)}
                </td>
                <td className="td font-mono tabular-nums text-right font-semibold">
                  {/* null occupancy → "—" (no Available time recorded) */}
                  <span className={
                    a.occupancy_pct == null
                      ? 'text-ink-faint'
                      : 'text-blue-600 dark:text-brand-light'
                  }>
                    {fmtOcc(a.occupancy_pct)}
                  </span>
                </td>
                <td className="td font-mono tabular-nums text-right
                  text-ink-dim">
                  {a.calls_offered ?? 0}
                </td>
                <td className="td font-mono tabular-nums text-right font-semibold
                  text-emerald-600 dark:text-emerald-400">
                  {a.calls_answered ?? 0}
                </td>
                <td className="td font-mono tabular-nums text-right
                  text-orange-500 dark:text-orange-400">
                  {a.calls_missed ?? 0}
                </td>
                <td className="td font-mono tabular-nums text-right
                  text-ink-dim">
                  {fmtSec(a.total_ring_seconds)}
                </td>
                <td className="td font-mono tabular-nums text-right
                  text-ink-dim">
                  {fmtSec(a.total_talk_seconds)}
                </td>
                <td className="td font-mono tabular-nums text-right
                  text-ink-dim">
                  {fmtSec(a.avg_talk_seconds)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      {!loading && !error && (
        <div className="px-6 py-3 border-t border-border dark:border-panel-border
          bg-surface-2 dark:bg-panel-raised/30">
          <p className="text-[0.6875rem] text-ink-faint">
            Occupancy = (ring + talk) / available × 100. — means no Available state recorded in range.
            Avg Talk = average talk time for answered calls only — not Average Handle Time.
          </p>
        </div>
      )}

      {/* Agent drilldown modal */}
      {selected && (
        <AgentDetailModal
          agentId={selected.agentId}
          agentName={selected.agentName}
          from={from}
          to={to}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
