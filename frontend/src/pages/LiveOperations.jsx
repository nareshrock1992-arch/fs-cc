import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PhoneIncoming, PhoneCall, Headphones, Coffee, PowerOff, UserCheck,
  Timer, Search, WifiOff, AlertTriangle, RefreshCw, Radio,
  ChevronDown, ChevronRight, ListTree, CheckCircle2,
} from 'lucide-react';
import { Calls, Stats, Agents as AgentsApi } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import { useAuth } from '../hooks/useAuth.js';
import KpiCard from '../components/KpiCard.jsx';
import Panel, { LiveIndicator } from '../components/Panel.jsx';
import EmptyState from '../components/EmptyState.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { KpiSkeleton } from '../components/LoadingState.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Live Operations — the primary real-time supervisor workspace. It does NOT own
// any business logic: it merges three EXISTING canonical sources into one view
// model, on ONE shared clock, over the ONE existing Socket.IO connection.
//   • GET /calls/live       → waiting + connected calls (callsController)
//   • GET /stats/live-agents → agent operational_state + current_call + anchors
//   • GET /stats/queues      → per-queue max_wait_time (the SLA threshold)
// No new backend, no second state model, no per-row timers, no per-second fetch.
// ─────────────────────────────────────────────────────────────────────────────

const STALE_MS = 15_000; // real-time feed considered STALE if no refresh in this window

// Agent / call state visuals come from the shared StatusBadge (one status
// language app-wide). Backend states map 1:1: Idle → "Available",
// Connected → "On Call". Labels are unchanged from the previous UI.
const AGENT_STATE_ORDER = { 'On Call': 0, 'Ringing': 1, 'Idle': 2, 'On Break': 3, 'Offline': 4 };

const QUICK = ['All', 'Attention', 'Waiting', 'Ringing', 'On Call', 'Available', 'Break', 'Offline'];

// Which call/agent states each quick filter reveals (single page-wide lens).
const CALL_STATES_FOR = {
  All: ['Waiting', 'Ringing', 'Connected'], Attention: ['Waiting', 'Ringing'],
  Waiting: ['Waiting'], Ringing: ['Ringing'], 'On Call': ['Connected'],
  Available: [], Break: [], Offline: [],
};
const AGENT_STATES_FOR = {
  All: ['Idle', 'Ringing', 'On Call', 'On Break', 'Offline'], Attention: ['Ringing'],
  Waiting: [], Ringing: ['Ringing'], 'On Call': ['On Call'],
  Available: ['Idle'], Break: ['On Break'], Offline: ['Offline'],
};

// ── Duration helpers ─────────────────────────────────────────────────────────
function secsSince(iso, nowMs) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}
function fmtDur(sec) {
  if (sec == null || sec < 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
const qn = (name) => (name ? String(name).split('@')[0] : '');

// ── Shared presentational helpers ────────────────────────────────────────────
const DASH = <span className="text-ink-disabled" aria-label="none">—</span>;

// Caller identity: name on top (when present), number underneath. The values
// passed in are exactly what the backend authorized for this viewer — masking
// and caller-ID permissions are decided upstream and never altered here.
function Caller({ name, number }) {
  if (!name) return <span className="tabular-nums text-ink">{number}</span>;
  return (
    <div className="min-w-0 leading-tight">
      <div className="font-medium text-ink break-words max-w-[18rem]">{name}</div>
      <div className="text-xs tabular-nums text-ink-dim">{number}</div>
    </div>
  );
}

function SortControl({ value, onChange, options, label }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-dim">
      <span className="hidden sm:inline">Sort</span>
      <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}
        className="input-sm pr-7 text-xs max-w-[12rem]">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// ── Connection / data-health indicator ───────────────────────────────────────
// Healthy is quiet (green dot + "Live"); stale and disconnected escalate.
function HealthIndicator({ health, lastOk }) {
  const ago = lastOk ? Math.max(0, Math.floor((Date.now() - lastOk) / 1000)) : null;
  if (health === 'disconnected') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 rounded-md px-2 h-8 text-xs font-semibold
        border border-status-error/35 bg-status-error/10 text-status-error whitespace-nowrap">
        <WifiOff size={13} aria-hidden="true" /> Disconnected
      </span>
    );
  }
  if (health === 'stale') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 rounded-md px-2 h-8 text-xs font-semibold
        border border-status-ringing/35 bg-status-ringing/10 text-status-ringing whitespace-nowrap">
        <AlertTriangle size={13} aria-hidden="true" /> Stale — reconnecting
        {ago != null && <span className="font-normal tabular-nums">· {fmtDur(ago)} ago</span>}
      </span>
    );
  }
  return (
    <span role="status" className="inline-flex items-center gap-2 h-8 whitespace-nowrap">
      <LiveIndicator state="live" />
      {ago != null && <span className="text-xs text-ink-faint tabular-nums hidden lg:inline">updated {fmtDur(ago)} ago</span>}
    </span>
  );
}

// ── KPI summary ──────────────────────────────────────────────────────────────
// Two groups so queue health (wait / SLA) reads separately from agent-state
// counts. The groups sit side by side when both fit (flex-basis in rem, grow
// 3:5 so each card gets a similar width) and wrap to two rows otherwise.
// Inside a group, columns come from the group's own width via container
// queries (see .kpi-group / .kpi-cols in index.css) — zoom-safe reflow.
function KpiGroup({ label, cols, className = '', children }) {
  return (
    <section aria-label={label} className={`kpi-group ${className}`}>
      <h2 className="text-xs font-semibold text-ink-dim mb-1.5">{label}</h2>
      <div className="kpi-cols" data-cols={cols}>{children}</div>
    </section>
  );
}

function KpiBar({ k }) {
  const breached = k.slaBreached > 0;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-3">
      <KpiGroup label="Queue" cols="3" className="flex-[3_1_23rem]">
        <KpiCard label="Waiting" value={k.waiting} tone="amber" icon={PhoneIncoming}
          sub={k.waiting > 0 ? 'Callers in queue' : 'No callers waiting'} />
        <KpiCard label="Longest Wait" value={fmtDur(k.longestWait)} tone="amber" icon={Timer}
          sub={k.waiting > 0 ? 'Oldest waiting caller' : null} />
        <KpiCard label="SLA Breached" value={k.slaBreached} tone={breached ? 'red' : 'green'}
          icon={breached ? AlertTriangle : CheckCircle2}
          alert={breached ? 'critical' : null}
          sub={breached ? 'Wait ≥ queue target' : 'All within target'} />
      </KpiGroup>
      <KpiGroup label="Agents" cols="5" className="flex-[5_1_39rem]">
        <KpiCard label="Available" value={k.available} tone="green"   icon={UserCheck} />
        <KpiCard label="On Call"   value={k.onCall}    tone="blue"    icon={PhoneCall} />
        <KpiCard label="Ringing"   value={k.ringing}   tone="amber"   icon={Radio} />
        <KpiCard label="On Break"  value={k.onBreak}   tone="purple"  icon={Coffee} />
        <KpiCard label="Offline"   value={k.offline}   tone="default" icon={PowerOff} />
      </KpiGroup>
    </div>
  );
}

// ── Calls Requiring Attention ────────────────────────────────────────────────
const CALL_SORTS = [
  ['attention', 'Attention'], ['wait', 'Longest waiting'], ['newest', 'Newest'],
  ['sla', 'SLA breached'], ['queue', 'Queue'], ['agent', 'Agent'],
];

function CallsTable({ rows, allEmpty, sort, onSort }) {
  return (
    <Panel title="Calls Requiring Attention" count={rows.length} noPad
      action={<SortControl value={sort} onChange={onSort} options={CALL_SORTS} label="Sort calls" />}>
      {rows.length === 0 ? (
        /* Compact empty state — collapses to one row so the agent floor rises
           immediately when the floor is quiet. */
        <EmptyState compact tone={allEmpty ? 'ok' : 'neutral'}
          title={allEmpty ? 'No active calls' : 'No calls match the current filters'}
          body={allEmpty ? 'waiting, ringing and connected calls appear here in real time' : 'adjust the filters or search'} />
      ) : (
        <div className="overflow-auto tall:max-h-[46vh]">
          <table className="data-table" style={{ minWidth: 720 }}>
            <thead className="sticky top-0 z-10">
              <tr>
                {['State', 'Caller', 'Queue', 'Agent', 'Duration', 'SLA'].map(h => (
                  <th key={h} scope="col" className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const breached = r.sla === 'breached';
                return (
                  <tr key={r.uuid}
                    className={`tr-row ${breached ? 'bg-status-error/[0.05] shadow-[inset_3px_0_0_rgb(var(--status-error))]' : ''}`}>
                    <td className="td w-[120px]"><StatusBadge status={r.state} /></td>
                    <td className="td">
                      <Caller name={r.caller_name} number={r.caller_name ? (r.ani || '—') : (r.ani || 'Unknown')} />
                    </td>
                    <td className="td-secondary break-words max-w-[14rem]">{r.queue || DASH}</td>
                    <td className="td">
                      {r.agent_name || r.agent_ext ? (
                        <div className="leading-tight min-w-0">
                          <div className="break-words max-w-[14rem]">{r.agent_name || DASH}</div>
                          {r.agent_ext && <div className="text-xs tabular-nums text-ink-faint">Ext {r.agent_ext}</div>}
                        </div>
                      ) : DASH}
                    </td>
                    <td className="td whitespace-nowrap">
                      <span className={`tabular-nums font-semibold ${breached ? 'text-status-error' : 'text-ink'}`}>{fmtDur(r.dur)}</span>
                      <span className="ml-1.5 text-[0.6875rem] text-ink-faint">{r.durLabel}</span>
                    </td>
                    <td className="td whitespace-nowrap">
                      {r.state === 'Waiting'
                        ? (breached
                            ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-error"><AlertTriangle size={13} aria-hidden="true" /> Breached</span>
                            : <span className="inline-flex items-center gap-1 text-xs text-ink-dim"><CheckCircle2 size={13} className="text-status-available" aria-hidden="true" /> Within</span>)
                        : DASH}
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

// ── Agent Floor Status ───────────────────────────────────────────────────────
const AGENT_SORTS = [
  ['state', 'State'], ['duration', 'Longest state duration'], ['agent', 'Agent'],
  ['ext', 'Extension'], ['calldur', 'Current call duration'],
];

function AgentsTable({ rows, allEmpty, canChangeState, onSetStatus, sort, onSort }) {
  const cols = ['Agent', 'State', 'In State', 'Queue(s)', 'Current Call', 'Call Dur', canChangeState ? 'Action' : ''].filter(Boolean);
  return (
    <Panel title="Agent Floor Status" count={rows.length} noPad
      action={<SortControl value={sort} onChange={onSort} options={AGENT_SORTS} label="Sort agents" />}>
      {rows.length === 0 ? (
        <EmptyState icon={Headphones}
          title={allEmpty ? 'No agents configured' : 'No agents match the current filters'}
          body={allEmpty ? 'Agent states will appear here in real time.' : 'Adjust the filters or search to see agents.'} />
      ) : (
        <div className="overflow-auto tall:max-h-[46vh]">
          <table className="data-table" style={{ minWidth: 760 }}>
            <thead className="sticky top-0 z-10">
              <tr>
                {cols.map(h => (
                  <th key={h} scope="col" className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const cc = r.current_call;
                const queues = (r.queues || []).map(q => q.display_name || q.queue).join(', ');
                return (
                  <tr key={r.agent_id} className="tr-row">
                    <td className="td">
                      <div className="leading-tight min-w-0">
                        <div className="font-medium break-words max-w-[16rem]">{r.full_name || r.agent_id}</div>
                        <div className="text-xs text-ink-faint tabular-nums">
                          {r.avaya_extension ? `Ext ${r.avaya_extension}` : 'No ext'}
                          {r._loginDur != null && r.operational_state !== 'Offline' && ` · logged in ${fmtDur(r._loginDur)}`}
                        </div>
                      </div>
                    </td>
                    <td className="td">
                      <StatusBadge status={r.operational_state}
                        label={r.operational_state === 'On Break' && r.break_name ? `On Break · ${r.break_name}` : undefined} />
                    </td>
                    <td className="td tabular-nums whitespace-nowrap">{fmtDur(r._stateDur)}</td>
                    <td className="td-secondary break-words max-w-[14rem]">{queues || DASH}</td>
                    <td className="td">
                      {cc ? (
                        <div className="leading-tight min-w-0">
                          <div className="tabular-nums break-words max-w-[16rem]">
                            {cc.caller_name ? `${cc.caller_name} (${cc.ani || '—'})` : (cc.ani || 'unknown')}
                          </div>
                          {cc.queue_name && <div className="text-xs text-ink-faint break-words">→ {qn(cc.queue_name)}</div>}
                        </div>
                      ) : DASH}
                    </td>
                    <td className="td tabular-nums whitespace-nowrap">
                      {r._callDur != null ? fmtDur(r._callDur) : DASH}
                    </td>
                    {canChangeState && (
                      <td className="td">
                        <select value="" onChange={e => { if (e.target.value) onSetStatus(r.agent_id, e.target.value); }}
                          aria-label={`Set state for ${r.full_name || r.agent_id}`}
                          className="input-sm text-xs">
                          <option value="">Set…</option>
                          <option value="Available">Available</option>
                          <option value="On Break">On Break</option>
                          <option value="Logged Out">Logged Out</option>
                        </select>
                      </td>
                    )}
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

// ── IVR & Pre-Queue Monitor ──────────────────────────────────────────────────
// Live view of callers observed in the IVR BEFORE they enter a real queue.
// Everything shown is directly observed. Eligibility and target queue are shown
// when the backend reports them; today it deliberately reports null (not yet
// reliably observable — see the Phase-1A report), so they read "Not reported".
const NOT_REPORTED = <span className="text-ink-faint" title="Not reported by the pre-queue feed yet">Not reported</span>;

function PreQueuePanel({ rows, nowMs, open, onToggle, loadFailed, health }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const hasCallers = rows.length > 0;

  // Feed state, most severe first: feed error > event stream down > stale > live.
  const feed = loadFailed ? { state: 'stale', label: 'Feed unavailable' }
    : health === 'disconnected' ? { state: 'offline', label: 'Disconnected' }
    : health === 'stale' ? { state: 'stale', label: 'Stale' }
    : { state: 'live', label: 'Live' };

  return (
    <section className={`card ${hasCallers ? 'border-primary/40' : ''}`} aria-label="IVR and pre-queue monitor">
      <div className="flex items-center gap-2 min-h-[44px] px-2 pr-4">
        <button onClick={onToggle} aria-expanded={open} aria-controls="prequeue-body"
          className="flex items-center gap-2 min-w-0 rounded-md px-2 py-1.5 hover:bg-surface-2 transition-colors">
          <Chevron size={16} className="text-ink-faint shrink-0" aria-hidden="true" />
          <ListTree size={16} className="text-primary shrink-0" aria-hidden="true" />
          <h2 className="text-section-title">IVR &amp; Pre-Queue Monitor</h2>
          <span className={`count-pill ${hasCallers ? '!bg-primary/10 !text-primary' : ''}`}
            aria-label={`${rows.length} caller${rows.length === 1 ? '' : 's'} in the IVR`}>{rows.length}</span>
        </button>
        <LiveIndicator state={feed.state} label={feed.label} />
        <span className="flex-1" />
        <span className="text-xs text-ink-faint hidden md:inline">Callers before queue entry</span>
      </div>

      {open && (
        <div id="prequeue-body" className="border-t border-border">
          {loadFailed ? (
            <EmptyState compact tone="warn" title="Pre-queue feed unavailable"
              body="retrying automatically with the next refresh" />
          ) : !hasCallers && health === 'disconnected' ? (
            <EmptyState compact tone="warn" title="Event stream disconnected"
              body="callers in the IVR may not be shown until the connection returns" />
          ) : !hasCallers ? (
            <EmptyState compact tone="ok" title="No callers in the IVR"
              body="callers appear here while in the IVR, then move to the queue on transfer" />
          ) : (
            <div className="overflow-auto tall:max-h-[40vh]">
              <table className="data-table" style={{ minWidth: 820 }}>
                <thead className="sticky top-0 z-10">
                  <tr>
                    {['Caller', 'Current Stage', 'In Stage', 'Eligibility', 'Target Queue', 'Last Update', 'Channel'].map(h => (
                      <th key={h} scope="col" className="th">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.chanUuid} className="tr-row">
                      {/* Caller name (r.callerName) and full number (r.caller) are present
                          only for users the backend authorized via view_caller_id / admin;
                          everyone else sees the masked number. */}
                      <td className="td">
                        {(r.caller || r.callerMasked || r.callerName)
                          ? <Caller name={r.callerName} number={r.caller || r.callerMasked} />
                          : <span className="text-ink-faint" title="Not reliably observable yet">Unknown</span>}
                      </td>
                      <td className="td">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium
                          bg-status-oncall/10 text-status-oncall break-words">
                          {r.stage || 'in IVR'}
                        </span>
                      </td>
                      <td className="td tabular-nums font-semibold whitespace-nowrap">{fmtDur(secsSince(r.stageSince, nowMs))}</td>
                      <td className="td">{r.eligibilityReason || NOT_REPORTED}</td>
                      <td className="td">{r.targetQueue ? qn(r.targetQueue) : NOT_REPORTED}</td>
                      <td className="td-secondary tabular-nums whitespace-nowrap">{fmtDur(secsSince(r.lastUpdate, nowMs))} ago</td>
                      <td className="td-secondary tabular-nums text-xs" title={r.chanUuid}>{r.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LiveOperations() {
  const { user } = useAuth();
  const canChangeState = user?.role === 'admin'
    || (Array.isArray(user?.permissions) && user.permissions.includes('change_agent_state'));

  const [calls,  setCalls]  = useState([]);
  const [agents, setAgents] = useState([]);
  const [queueMax, setQueueMax] = useState({}); // { normalizedQueueName: max_wait_time }
  const [prequeue, setPrequeue] = useState({}); // chanUuid → masked pre-queue record
  const [pqFailed, setPqFailed] = useState(false);
  const [pqOpen, setPqOpen] = useState(true);
  const [esl, setEsl]       = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [tick, setTick]     = useState(Date.now());
  const [lastOk, setLastOk] = useState(0);
  const skewRef = useRef(0); // server_time - clientTime, from /stats/live-agents

  // Controls (state preserved across refetches — data is swapped underneath).
  const [search, setSearch] = useState('');
  const [queue,  setQueue]  = useState('All');
  const [quick,  setQuick]  = useState('All');
  const [callSort,  setCallSort]  = useState('attention');
  const [agentSort, setAgentSort] = useState('state');

  // ── Single load: three canonical sources, resilient to partial failure ──────
  const load = useCallback(async () => {
    const [cRes, aRes, qRes, pqRes] = await Promise.allSettled([
      Calls.live(), Stats.liveAgents(), Stats.queues(), Calls.prequeue(),
    ]);
    // Pre-queue is an INDEPENDENT, additive source: its success/failure never
    // affects the existing call/agent/queue KPIs or the `ok` health signal.
    if (pqRes.status === 'fulfilled') {
      const map = {};
      for (const p of (Array.isArray(pqRes.value) ? pqRes.value : [])) map[p.chanUuid] = p;
      setPrequeue(map);
      setPqFailed(false);
    } else {
      setPqFailed(true);
    }
    let ok = false;
    if (cRes.status === 'fulfilled') { setCalls(Array.isArray(cRes.value) ? cRes.value : []); ok = true; }
    if (aRes.status === 'fulfilled') {
      const d = aRes.value;
      setAgents(Array.isArray(d.agents) ? d.agents : []);
      setEsl(!!d.eslConnected);
      if (d.server_time) skewRef.current = new Date(d.server_time).getTime() - Date.now();
      ok = true;
    }
    if (qRes.status === 'fulfilled') {
      const map = {};
      for (const q of (qRes.value || [])) map[qn(q.queue_name)] = q.max_wait_time;
      setQueueMax(map);
    }
    if (ok) { setLastOk(Date.now()); setError(null); }
    else setError(cRes.reason?.message || aRes.reason?.message || 'Failed to load live operations');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Fallback polling (resilience if a socket event is missed).
  useEffect(() => { const p = setInterval(load, 6000); return () => clearInterval(p); }, [load]);

  // ONE shared 1s clock — durations increment locally, no per-second requests.
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Debounced socket-driven refetch (union of the two legacy pages' events).
  const debounceRef = useRef(null);
  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 400);
  }, [load]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  useSocketEvent('call:enqueued',   scheduleRefresh);
  useSocketEvent('call:bridged',    scheduleRefresh);
  useSocketEvent('call:bridge-end', scheduleRefresh);
  useSocketEvent('call:abandoned',  scheduleRefresh);
  useSocketEvent('channel:hangup',  scheduleRefresh);
  useSocketEvent('agent:status',    scheduleRefresh);
  useSocketEvent('agent:state',     scheduleRefresh);
  useSocketEvent('agent:offering',  scheduleRefresh);
  useSocketEvent('agent:no-answer', scheduleRefresh);
  useSocketEvent('agent:update',    scheduleRefresh);
  useSocketEvent('esl:status', useCallback((p) => { setEsl(!!p?.connected); scheduleRefresh(); }, [scheduleRefresh]));

  // Pre-queue live updates (supervisor room only) — upsert / remove in place.
  useSocketEvent('prequeue:update', useCallback((p) => {
    if (!p?.chanUuid) return;
    // Socket payloads are ALWAYS masked (full ANI never travels over Socket.IO).
    // The full number comes only from the authorized REST poll; preserve it across
    // masked socket updates so an authorized viewer doesn't flicker to masked.
    setPrequeue(prev => ({ ...prev, [p.chanUuid]: { ...p,
      caller:     p.caller     ?? prev[p.chanUuid]?.caller,
      callerName: p.callerName ?? prev[p.chanUuid]?.callerName } }));
    setPqFailed(false);
  }, []));
  useSocketEvent('prequeue:remove', useCallback((p) => {
    if (!p?.chanUuid) return;
    setPrequeue(prev => { if (!(p.chanUuid in prev)) return prev; const n = { ...prev }; delete n[p.chanUuid]; return n; });
  }, []));

  const nowMs = tick + skewRef.current;

  // Connection health: disconnected (ESL down) > stale (no refresh in window) > connected.
  const health = !esl ? 'disconnected'
    : (lastOk && (Date.now() - lastOk) > STALE_MS) ? 'stale'
    : 'connected';

  // ── Enriched agents (durations from server anchors) ─────────────────────────
  const agentRows = useMemo(() => agents.map(a => ({
    ...a,
    _stateDur: secsSince(a.state_since || a.status_since, nowMs),
    _loginDur: secsSince(a.login_at, nowMs),
    _callDur:  a.current_call ? secsSince(a.current_call.agent_answer_time, nowMs) : null,
  })), [agents, nowMs]);

  const agentsById = useMemo(() => {
    const m = {};
    for (const a of agentRows) m[a.agent_id] = a;
    return m;
  }, [agentRows]);

  // ── Correlated call rows (Waiting + Connected from /calls/live; Ringing
  //    synthesized from agents in Ringing that hold a current_call). ───────────
  const callRows = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const c of calls) {
      const isConnected = c.agent_id && c.disposition === 'answered';
      const state = isConnected ? 'Connected' : 'Waiting';
      const queueName = qn(c.queue_name);
      const waitSec = secsSince(c.queue_enter_time, nowMs);
      const talkSec = secsSince(c.agent_answer_time, nowMs);
      const max = queueMax[queueName];
      const ag = c.agent_id ? agentsById[c.agent_id] : null;
      seen.add(c.call_uuid);
      out.push({
        uuid: c.call_uuid, state, ani: c.ani, caller_name: c.caller_name || null, queue: queueName,
        agent_name: c.agent_name || ag?.full_name || null,
        agent_ext:  c.agent_extension || ag?.avaya_extension || null,
        dur: isConnected ? talkSec : waitSec,
        durLabel: isConnected ? 'talk' : 'wait',
        _wait: waitSec ?? 0,
        _enter: c.queue_enter_time ? new Date(c.queue_enter_time).getTime() : 0,
        sla: (!isConnected && max != null && waitSec != null && waitSec >= max) ? 'breached' : null,
      });
    }
    // Ringing calls live on the agent side (calls.disposition has no 'ringing').
    for (const a of agentRows) {
      const cc = a.current_call;
      if (a.operational_state === 'Ringing' && cc && !seen.has(cc.call_uuid)) {
        seen.add(cc.call_uuid);
        out.push({
          uuid: cc.call_uuid, state: 'Ringing', ani: cc.ani, caller_name: cc.caller_name || null, queue: qn(cc.queue_name),
          agent_name: a.full_name, agent_ext: a.avaya_extension,
          dur: a._stateDur, durLabel: 'ring', _wait: a._stateDur ?? 0, _enter: Date.now(), sla: null,
        });
      }
    }
    return out;
  }, [calls, agentRows, agentsById, queueMax, nowMs]);

  // ── KPI counts (canonical: calls for waiting/SLA/longest; agents for states) ─
  const kpi = useMemo(() => {
    const k = { waiting: 0, ringing: 0, onCall: 0, available: 0, onBreak: 0, offline: 0, slaBreached: 0, longestWait: 0 };
    for (const a of agentRows) {
      if (a.operational_state === 'Ringing')  k.ringing++;
      else if (a.operational_state === 'On Call') k.onCall++;
      else if (a.operational_state === 'Idle')  k.available++;
      else if (a.operational_state === 'On Break') k.onBreak++;
      else if (a.operational_state === 'Offline') k.offline++;
    }
    for (const r of callRows) {
      if (r.state === 'Waiting') {
        k.waiting++;
        if (r._wait > k.longestWait) k.longestWait = r._wait;
        if (r.sla === 'breached') k.slaBreached++;
      }
    }
    return k;
  }, [agentRows, callRows]);

  const waitingExists = kpi.waiting > 0;

  // Pre-queue rows (oldest first — longest in the IVR at the top).
  const prequeueRows = useMemo(
    () => Object.values(prequeue).sort((a, b) => new Date(a.firstSeen) - new Date(b.firstSeen)),
    [prequeue],
  );

  // ── Filtered / sorted CALL view ─────────────────────────────────────────────
  const callView = useMemo(() => {
    const term = search.trim().toLowerCase();
    const allowed = CALL_STATES_FOR[quick] || CALL_STATES_FOR.All;
    let list = callRows.filter(r => {
      if (!allowed.includes(r.state)) return false;
      if (quick === 'Attention' && !(r.state === 'Waiting' || r.state === 'Ringing')) return false;
      if (queue !== 'All' && r.queue !== queue) return false;
      if (term) {
        const hay = `${r.caller_name || ''} ${r.ani || ''} ${r.agent_name || ''} ${r.agent_ext || ''} ${r.queue || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    const stateRank = { Waiting: 0, Ringing: 1, Connected: 2 };
    list = [...list].sort((a, b) => {
      switch (callSort) {
        case 'newest':  return b._enter - a._enter;
        case 'sla':     return (b.sla === 'breached' ? 1 : 0) - (a.sla === 'breached' ? 1 : 0) || b._wait - a._wait;
        case 'queue':   return (a.queue || '').localeCompare(b.queue || '');
        case 'agent':   return (a.agent_name || '').localeCompare(b.agent_name || '');
        case 'wait':    return b._wait - a._wait;
        case 'attention':
        default:        // breached → waiting(longest) → ringing → connected
          return (b.sla === 'breached' ? 1 : 0) - (a.sla === 'breached' ? 1 : 0)
              || (stateRank[a.state] - stateRank[b.state])
              || b._wait - a._wait;
      }
    });
    return list;
  }, [callRows, search, queue, quick, callSort]);

  // ── Filtered / sorted AGENT view ────────────────────────────────────────────
  const agentView = useMemo(() => {
    const term = search.trim().toLowerCase();
    let allowed = AGENT_STATES_FOR[quick] || AGENT_STATES_FOR.All;
    let list = agentRows.filter(r => {
      if (!allowed.includes(r.operational_state)) return false;
      // Attention also surfaces idle agents while callers are waiting (staffing).
      if (quick === 'Attention' && r.operational_state === 'Idle' && !waitingExists) return false;
      if (queue !== 'All' && !(r.queues || []).some(q => (q.display_name || q.queue) === queue || qn(q.queue) === queue)) return false;
      if (term) {
        const hay = `${r.full_name || ''} ${r.avaya_extension || ''} ${r.agent_id || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    if (quick === 'Attention') {
      allowed = ['Ringing', 'Idle'];
      list = agentRows.filter(r => (r.operational_state === 'Ringing') || (r.operational_state === 'Idle' && waitingExists))
        .filter(r => {
          if (queue !== 'All' && !(r.queues || []).some(q => (q.display_name || q.queue) === queue || qn(q.queue) === queue)) return false;
          if (term) { const hay = `${r.full_name || ''} ${r.avaya_extension || ''} ${r.agent_id || ''}`.toLowerCase(); if (!hay.includes(term)) return false; }
          return true;
        });
    }
    list = [...list].sort((a, b) => {
      switch (agentSort) {
        case 'agent':    return (a.full_name || '').localeCompare(b.full_name || '');
        case 'ext':      return String(a.avaya_extension || '').localeCompare(String(b.avaya_extension || ''), undefined, { numeric: true });
        case 'duration': return (b._stateDur ?? -1) - (a._stateDur ?? -1);
        case 'calldur':  return (b._callDur ?? -1) - (a._callDur ?? -1);
        case 'state':
        default:         return (AGENT_STATE_ORDER[a.operational_state] ?? 9) - (AGENT_STATE_ORDER[b.operational_state] ?? 9)
                             || (a.full_name || '').localeCompare(b.full_name || '');
      }
    });
    return list;
  }, [agentRows, search, queue, quick, agentSort, waitingExists]);

  // Queue options from both sources.
  const queueOptions = useMemo(() => {
    const set = new Set();
    for (const a of agents) for (const q of (a.queues || [])) set.add(q.display_name || q.queue);
    for (const c of calls) if (c.queue_name) set.add(qn(c.queue_name));
    return ['All', ...Array.from(set).sort()];
  }, [agents, calls]);

  const setStatus = useCallback(async (agentId, status) => {
    try { await AgentsApi.setStatus(agentId, status); }
    catch (err) { setError(`Status change failed: ${err.message}`); }
    finally { scheduleRefresh(); }
  }, [scheduleRefresh]);

  // ── Loading (never show misleading zeros before first load) ──────────────────
  // Skeleton mirrors the real layout so nothing jumps when data arrives.
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="flex flex-wrap gap-x-4 gap-y-3">
          <div className="kpi-group flex-[3_1_23rem] pt-5"><KpiSkeleton count={3} cols="3" className="kpi-cols" /></div>
          <div className="kpi-group flex-[5_1_39rem] pt-5"><KpiSkeleton count={5} cols="5" className="kpi-cols" /></div>
        </div>
        <div className="skeleton h-11 rounded-md" />
        <div className="skeleton h-11 rounded-md" />
        <div className="skeleton h-56 rounded-md" />
        <div className="skeleton h-56 rounded-md" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* KPI summary — queue health + agent states */}
      <KpiBar k={kpi} />

      {/* IVR & Pre-Queue Monitor — callers observed before queue entry */}
      <PreQueuePanel rows={prequeueRows} nowMs={nowMs} open={pqOpen}
        onToggle={() => setPqOpen(o => !o)} loadFailed={pqFailed} health={health} />

      {/* Toolbar: feed health · quick filters · search · queue (one compact row) */}
      <div className="card px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <HealthIndicator health={health} lastOk={lastOk} />
        <span className="hidden sm:block h-5 w-px bg-border" aria-hidden="true" />
        <div role="group" aria-label="Quick filter" className="flex flex-wrap items-center gap-0.5">
          {QUICK.map(f => (
            <button key={f} type="button" onClick={() => setQuick(f)} aria-pressed={quick === f} className="chip">
              {f}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" aria-hidden="true" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              type="search" aria-label="Search calls and agents"
              placeholder="Search caller, agent or ext"
              className="input-sm pl-8 w-60 max-w-full" />
          </div>
          <select value={queue} onChange={e => setQueue(e.target.value)} aria-label="Filter by queue"
            className="input-sm pr-7 max-w-[200px]">
            {queueOptions.map(q => <option key={q} value={q}>{q === 'All' ? 'All queues' : q}</option>)}
          </select>
        </div>
        {error && (
          <p role="alert" className="basis-full inline-flex items-center gap-1.5 text-xs text-status-error">
            <RefreshCw size={13} aria-hidden="true" /> {error}
          </p>
        )}
      </div>

      {/* Calls */}
      <CallsTable rows={callView} allEmpty={callRows.length === 0}
        sort={callSort} onSort={setCallSort} />

      {/* Agents */}
      <AgentsTable rows={agentView} allEmpty={agentRows.length === 0}
        canChangeState={canChangeState} onSetStatus={setStatus}
        sort={agentSort} onSort={setAgentSort} />

    </div>
  );
}
