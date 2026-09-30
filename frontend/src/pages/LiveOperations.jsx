import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PhoneIncoming, PhoneCall, Headphones, Coffee, PowerOff, UserCheck,
  Timer, Search, Wifi, WifiOff, AlertTriangle, RefreshCw, Radio,
} from 'lucide-react';
import { Calls, Stats, Agents as AgentsApi } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import { useAuth } from '../hooks/useAuth.js';
import KpiCard from '../components/KpiCard.jsx';
import Panel from '../components/Panel.jsx';
import EmptyState from '../components/EmptyState.jsx';

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

// Agent operational-state visuals (identical labels to the backend's derivation).
const AGENT_META = {
  'Idle':     { label: 'Available', dot: '#27C98A', pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  'Ringing':  { label: 'Ringing',   dot: '#F5A623', pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  'On Call':  { label: 'On Call',   dot: '#2563EB', pill: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' },
  'On Break': { label: 'On Break',  dot: '#A78BFA', pill: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400' },
  'Offline':  { label: 'Offline',   dot: '#4C5A78', pill: 'bg-gray-100 text-gray-500 dark:bg-panel-raised dark:text-ink-dim' },
};
const AGENT_STATE_ORDER = { 'On Call': 0, 'Ringing': 1, 'Idle': 2, 'On Break': 3, 'Offline': 4 };

const CALL_META = {
  Waiting:   { pill: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-200 dark:border-amber-500/25', dot: '#F5A623' },
  Ringing:   { pill: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border border-orange-200 dark:border-orange-500/25', dot: '#FB923C' },
  Connected: { pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25', dot: '#27C98A' },
};

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

// ── Connection / data-health pill ────────────────────────────────────────────
function HealthPill({ health }) {
  const map = {
    connected:    { cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400', Icon: Wifi,    text: 'Connected' },
    stale:        { cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 animate-pulse', Icon: AlertTriangle, text: 'Stale — reconnecting' },
    disconnected: { cls: 'border-red-200 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 animate-pulse', Icon: WifiOff, text: 'Disconnected' },
  };
  const { cls, Icon, text } = map[health] || map.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border tracking-wide uppercase ${cls}`}>
      <Icon size={12} /> {text}
    </span>
  );
}

// ── KPI command bar (reuses shared KpiCard + auto-fit reflow) ────────────────
function KpiBar({ k }) {
  const tiles = [
    { label: 'Waiting',      value: k.waiting,    tone: k.waiting > 0 ? 'amber' : 'default',  icon: PhoneIncoming },
    { label: 'Ringing',      value: k.ringing,    tone: k.ringing > 0 ? 'amber' : 'default',  icon: Radio },
    { label: 'On Call',      value: k.onCall,     tone: k.onCall > 0 ? 'blue' : 'default',    icon: PhoneCall },
    { label: 'Available',    value: k.available,  tone: k.available > 0 ? 'green' : 'default',icon: UserCheck },
    { label: 'On Break',     value: k.onBreak,    tone: 'purple',                             icon: Coffee },
    { label: 'Offline',      value: k.offline,    tone: 'default',                            icon: PowerOff },
    { label: 'SLA Breached', value: k.slaBreached,tone: k.slaBreached > 0 ? 'red' : 'default',icon: AlertTriangle,
      sub: k.slaBreached > 0 ? 'Wait ≥ queue target' : 'Within target' },
    { label: 'Longest Wait', value: fmtDur(k.longestWait), tone: k.longestWait >= 120 ? 'amber' : 'default', icon: Timer },
  ];
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
      {tiles.map(t => <KpiCard key={t.label} {...t} />)}
    </div>
  );
}

// ── Calls Requiring Attention ────────────────────────────────────────────────
function CallsTable({ rows, allEmpty }) {
  return (
    <Panel eyebrow="Live" title="Calls Requiring Attention" noPad>
      {rows.length === 0 ? (
        /* Compact, content-driven empty state — collapses the Calls section to
           ~one row so Agent Floor Status rises immediately when the floor is
           quiet (no large blank panel). */
        <div className="flex items-center gap-2.5 px-4 py-3 text-gray-400 dark:text-ink-faint">
          <span className={`h-2 w-2 rounded-full shrink-0 ${allEmpty ? 'bg-emerald-400/70' : 'bg-gray-300 dark:bg-ink-faint/40'}`} />
          <span className="text-xs font-semibold text-gray-500 dark:text-ink-dim">
            {allEmpty ? 'No active calls' : 'No calls match the current filters'}
          </span>
          <span className="text-[11px] hidden sm:inline">
            {allEmpty ? '— waiting, ringing and connected calls appear here in real time' : '— adjust the filters or search'}
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-auto max-h-[46vh]">
          <table className="w-full text-sm" style={{ minWidth: 720 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 dark:bg-panel-raised border-b border-gray-200 dark:border-panel-border">
                {['State', 'Customer', 'Queue', 'Agent', 'Ext', 'Duration', 'SLA'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-ink-faint whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-panel-border/30">
              {rows.map(r => {
                const m = CALL_META[r.state] || CALL_META.Waiting;
                return (
                  <tr key={r.uuid} className={`transition-colors ${r.sla === 'breached' ? 'bg-red-50/60 dark:bg-red-500/5' : 'hover:bg-gray-50/60 dark:hover:bg-panel-raised/20'}`}>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.pill}`}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
                        {r.state === 'Connected' ? 'On Call' : r.state}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono tnum text-gray-800 dark:text-ink">{r.ani || 'Unknown'}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-ink-dim truncate max-w-[160px]" title={r.queue}>{r.queue || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-ink truncate max-w-[160px]" title={r.agent_name}>{r.agent_name || <span className="text-gray-300 dark:text-ink-faint/50">—</span>}</td>
                    <td className="px-4 py-2.5 font-mono tnum text-gray-500 dark:text-ink-dim">{r.agent_ext || '—'}</td>
                    <td className={`px-4 py-2.5 font-mono tnum font-semibold ${r.sla === 'breached' ? 'text-red-600 dark:text-lamp-alert' : r.state === 'Connected' ? 'text-emerald-600 dark:text-lamp-available' : 'text-amber-600 dark:text-lamp-warn'}`}>
                      {fmtDur(r.dur)}<span className="ml-1 text-[9px] font-normal text-gray-400 dark:text-ink-faint uppercase">{r.durLabel}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.state === 'Waiting'
                        ? (r.sla === 'breached'
                            ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 dark:text-lamp-alert"><AlertTriangle size={11} /> Breached</span>
                            : <span className="text-[11px] text-emerald-600 dark:text-lamp-available">Within</span>)
                        : <span className="text-gray-300 dark:text-ink-faint/50">—</span>}
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
function AgentsTable({ rows, allEmpty, canChangeState, onSetStatus }) {
  const cols = ['Agent', 'Ext', 'State', 'State Dur', 'Queue(s)', 'Current Call', 'Call Dur', canChangeState ? 'Action' : ''].filter(Boolean);
  return (
    <Panel eyebrow="Live" title="Agent Floor Status" noPad>
      {rows.length === 0 ? (
        <EmptyState icon={Headphones}
          title={allEmpty ? 'No agents configured' : 'No agents match the current filters'}
          body={allEmpty ? 'Agent states will appear here in real time.' : 'Adjust the filters or search to see agents.'} />
      ) : (
        <div className="overflow-x-auto overflow-y-auto max-h-[46vh]">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 dark:bg-panel-raised border-b border-gray-200 dark:border-panel-border">
                {cols.map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-ink-faint whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-panel-border/30">
              {rows.map(r => {
                const meta = AGENT_META[r.operational_state] || AGENT_META.Offline;
                const cc = r.current_call;
                return (
                  <tr key={r.agent_id} className="hover:bg-gray-50/60 dark:hover:bg-panel-raised/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-800 dark:text-ink truncate max-w-[170px]">{r.full_name || r.agent_id}</div>
                      {r._loginDur != null && r.operational_state !== 'Offline' && (
                        <div className="text-[10px] text-gray-400 dark:text-ink-faint">logged in {fmtDur(r._loginDur)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono tnum text-gray-600 dark:text-ink-dim">{r.avaya_extension || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.pill}`}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
                        {meta.label}{r.operational_state === 'On Break' && r.break_name ? ` · ${r.break_name}` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono tnum text-gray-700 dark:text-ink">{fmtDur(r._stateDur)}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-ink-dim truncate max-w-[150px]" title={(r.queues || []).map(q => q.display_name || q.queue).join(', ')}>
                      {(r.queues || []).map(q => q.display_name || q.queue).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {cc ? (
                        <span className="font-mono tnum text-xs text-gray-700 dark:text-ink">
                          {cc.ani || 'unknown'}{cc.queue_name ? ` → ${qn(cc.queue_name)}` : ''}
                        </span>
                      ) : <span className="text-gray-300 dark:text-ink-faint/50">—</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono tnum text-gray-700 dark:text-ink">
                      {r._callDur != null ? fmtDur(r._callDur) : <span className="text-gray-300 dark:text-ink-faint/50">—</span>}
                    </td>
                    {canChangeState && (
                      <td className="px-4 py-2.5">
                        <select value="" onChange={e => { if (e.target.value) onSetStatus(r.agent_id, e.target.value); }}
                          className="py-1 px-1.5 text-xs rounded border border-gray-200 dark:border-panel-border bg-white dark:bg-panel-raised text-gray-600 dark:text-ink-dim">
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

// ─────────────────────────────────────────────────────────────────────────────

export default function LiveOperations() {
  const { user } = useAuth();
  const canChangeState = user?.role === 'admin'
    || (Array.isArray(user?.permissions) && user.permissions.includes('change_agent_state'));

  const [calls,  setCalls]  = useState([]);
  const [agents, setAgents] = useState([]);
  const [queueMax, setQueueMax] = useState({}); // { normalizedQueueName: max_wait_time }
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
    const [cRes, aRes, qRes] = await Promise.allSettled([
      Calls.live(), Stats.liveAgents(), Stats.queues(),
    ]);
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
        uuid: c.call_uuid, state, ani: c.ani, queue: queueName,
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
          uuid: cc.call_uuid, state: 'Ringing', ani: cc.ani, queue: qn(cc.queue_name),
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

  // ── Filtered / sorted CALL view ─────────────────────────────────────────────
  const callView = useMemo(() => {
    const term = search.trim().toLowerCase();
    const allowed = CALL_STATES_FOR[quick] || CALL_STATES_FOR.All;
    let list = callRows.filter(r => {
      if (!allowed.includes(r.state)) return false;
      if (quick === 'Attention' && !(r.state === 'Waiting' || r.state === 'Ringing')) return false;
      if (queue !== 'All' && r.queue !== queue) return false;
      if (term) {
        const hay = `${r.ani || ''} ${r.agent_name || ''} ${r.agent_ext || ''} ${r.queue || ''}`.toLowerCase();
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
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
        </div>
        <div className="skeleton h-64 rounded-xl" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  const selectCls = 'py-1.5 px-2 text-xs rounded-lg border border-gray-200 dark:border-panel-border bg-white dark:bg-panel-raised text-gray-600 dark:text-ink-dim';

  return (
    <div className="space-y-4">

      {/* KPI command bar */}
      <KpiBar k={kpi} />

      {/* Health + filters (stay stable while the tables scroll) */}
      <Panel noPad>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <HealthPill health={health} />
          {error && (
            <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-lamp-alert">
              <RefreshCw size={12} /> {error}
            </span>
          )}
          <div className="flex-1 min-w-[160px]" />
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-ink-faint" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search customer / agent / ext"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-panel-border bg-white dark:bg-panel-raised text-gray-700 dark:text-ink w-56 max-w-full" />
          </div>
          <select value={queue} onChange={e => setQueue(e.target.value)} className={selectCls}>
            {queueOptions.map(q => <option key={q} value={q}>{q === 'All' ? 'All queues' : q}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          {QUICK.map(f => (
            <button key={f} onClick={() => setQuick(f)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                quick === f
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 dark:bg-panel-raised text-gray-600 dark:text-ink-dim hover:bg-gray-200 dark:hover:bg-panel-border'
              }`}>
              {f}
            </button>
          ))}
        </div>
      </Panel>

      {/* Calls */}
      <div className="flex items-center justify-end gap-2 -mb-1">
        <span className="text-[11px] text-gray-400 dark:text-ink-faint">Sort calls</span>
        <select value={callSort} onChange={e => setCallSort(e.target.value)} className={selectCls}>
          <option value="attention">Attention</option>
          <option value="wait">Longest waiting</option>
          <option value="newest">Newest</option>
          <option value="sla">SLA breached</option>
          <option value="queue">Queue</option>
          <option value="agent">Agent</option>
        </select>
      </div>
      <CallsTable rows={callView} allEmpty={callRows.length === 0} />

      {/* Agents */}
      <div className="flex items-center justify-end gap-2 -mb-1">
        <span className="text-[11px] text-gray-400 dark:text-ink-faint">Sort agents</span>
        <select value={agentSort} onChange={e => setAgentSort(e.target.value)} className={selectCls}>
          <option value="state">State</option>
          <option value="duration">Longest state duration</option>
          <option value="agent">Agent</option>
          <option value="ext">Extension</option>
          <option value="calldur">Current call duration</option>
        </select>
      </div>
      <AgentsTable rows={agentView} allEmpty={agentRows.length === 0}
        canChangeState={canChangeState} onSetStatus={setStatus} />

    </div>
  );
}
