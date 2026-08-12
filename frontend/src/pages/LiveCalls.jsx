import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calls } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import Panel from '../components/Panel.jsx';
import StatusLamp from '../components/StatusLamp.jsx';

function elapsed(fromIso, tickMs) {
  if (!fromIso) return 0;
  return Math.max(0, Math.floor((tickMs - new Date(fromIso).getTime()) / 1000));
}

function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

// Render the ivr_path JSONB array as a compact breadcrumb trail (kept for potential use)
function IvrPath({ path }) {
  let steps = [];
  if (Array.isArray(path)) steps = path;
  else if (typeof path === 'string') { try { steps = JSON.parse(path); } catch { steps = []; } }

  if (!steps.length) return <span className="dark:text-ink-faint text-gray-400">—</span>;

  const badgeClass = (step) => {
    if (step.startsWith('pressed_')) return 'bg-blue-500/15 text-blue-400 dark:text-blue-300';
    if (step.startsWith('play:'))    return 'bg-violet-500/15 text-violet-400 dark:text-violet-300';
    if (step.startsWith('queue:'))   return 'bg-green-500/15 text-green-400 dark:text-green-300';
    return 'dark:bg-panel-border/60 bg-gray-100 dark:text-ink-dim text-gray-600';
  };

  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((s, i) => (
        <span
          key={i}
          title={s.ts ? new Date(s.ts).toLocaleTimeString() : undefined}
          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${badgeClass(s.step || '')}`}
        >
          {s.step || '?'}
        </span>
      ))}
    </div>
  );
}

// Compact KPI tile for the live calls summary strip
function LiveKpi({ label, value, colorClass }) {
  return (
    <div className="rounded-lg border dark:bg-panel-surface dark:border-panel-border bg-white border-gray-200 px-4 py-3 shadow-card">
      <p className="text-[10px] uppercase tracking-widest font-display font-semibold dark:text-ink-faint text-gray-400 mb-0.5">
        {label}
      </p>
      <p className={`font-mono tnum text-xl font-bold leading-none ${colorClass ?? 'dark:text-ink text-gray-900'}`}>
        {value}
      </p>
    </div>
  );
}

export default function LiveCalls() {
  const [calls, setCalls]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tick, setTick]       = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const rows = await Calls.live();
      setCalls(rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll  = setInterval(load, 5000);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  const onLiveEvent = useCallback(() => load(), [load]);
  useSocketEvent('call:enqueued',   onLiveEvent);
  useSocketEvent('call:bridged',    onLiveEvent);
  useSocketEvent('call:abandoned',  onLiveEvent);
  useSocketEvent('call:bridge-end', onLiveEvent);
  useSocketEvent('channel:hangup',  onLiveEvent);
  useSocketEvent('esl:status',      onLiveEvent);

  const { waiting, onCall } = useMemo(() => ({
    waiting: calls.filter(c => !c.agent_id && c.disposition === 'waiting'),
    onCall:  calls.filter(c =>  c.agent_id && c.disposition === 'answered'),
  }), [calls]);

  // Longest wait — computed from live data + tick, no extra backend call needed
  const longestWaitSec = waiting.length === 0
    ? 0
    : Math.max(...waiting.map(c => elapsed(c.queue_enter_time, tick)));

  const thClass = 'pb-2.5 font-display font-medium dark:text-ink-faint text-gray-400 text-[11px] uppercase tracking-widest';

  if (loading) return <p className="text-sm dark:text-ink-dim text-gray-500">Loading live calls…</p>;
  if (error)   return <p className="text-sm text-lamp-alert">{error}</p>;

  return (
    <div className="space-y-6">

      {/* ── KPI strip ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <LiveKpi
          label="Waiting"
          value={waiting.length}
          colorClass={waiting.length > 0 ? 'text-lamp-live' : 'dark:text-ink text-gray-900'}
        />
        <LiveKpi
          label="In Progress"
          value={onCall.length}
          colorClass={onCall.length > 0 ? 'text-lamp-available' : 'dark:text-ink text-gray-900'}
        />
        <LiveKpi
          label="Longest Wait"
          value={waiting.length > 0 ? fmt(longestWaitSec) : '—'}
          colorClass={
            longestWaitSec > 120 ? 'text-lamp-alert'
            : longestWaitSec > 60 ? 'text-lamp-live'
            : 'dark:text-ink text-gray-900'
          }
        />
      </div>

      {/* ── Waiting in queue ──────────────────────────────────────────────────── */}
      <Panel eyebrow={`${waiting.length} caller${waiting.length === 1 ? '' : 's'}`} title="Waiting in Queue">
        {waiting.length === 0 ? (
          <p className="text-sm dark:text-ink-dim text-gray-500">No callers currently waiting.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-panel-border border-gray-100">
                <th className={thClass}>Queue</th>
                <th className={thClass}>Customer</th>
                <th className={thClass}>Waiting</th>
              </tr>
            </thead>
            <tbody>
              {waiting.map(c => (
                <tr key={c.call_uuid} className="border-b dark:border-panel-border/60 border-gray-50 last:border-0">
                  <td className="py-3">
                    <StatusLamp status="InQueue" label={c.queue_name || '—'} />
                  </td>
                  <td className="py-3 font-mono dark:text-ink text-gray-800">{c.ani || 'Unknown'}</td>
                  <td className="py-3 font-mono tnum text-lamp-live font-semibold">
                    {fmt(elapsed(c.queue_enter_time, tick))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* ── On a call ─────────────────────────────────────────────────────────── */}
      <Panel eyebrow={`${onCall.length} call${onCall.length === 1 ? '' : 's'}`} title="On a Call">
        {onCall.length === 0 ? (
          <p className="text-sm dark:text-ink-dim text-gray-500">No calls currently bridged to an agent.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-panel-border border-gray-100">
                <th className={thClass}>Queue</th>
                <th className={thClass}>Customer</th>
                <th className={thClass}>Agent</th>
                <th className={`${thClass} hidden sm:table-cell`}>Extension</th>
                <th className={thClass}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {onCall.map(c => (
                <tr key={c.call_uuid} className="border-b dark:border-panel-border/60 border-gray-50 last:border-0">
                  <td className="py-3 dark:text-ink-dim text-gray-500 font-medium">{c.queue_name || '—'}</td>
                  <td className="py-3 font-mono dark:text-ink text-gray-800">{c.ani || 'Unknown'}</td>
                  <td className="py-3">
                    <StatusLamp status="In a queue call" label={c.agent_name || c.agent_id} />
                  </td>
                  <td className="py-3 font-mono tnum dark:text-ink-faint text-gray-400 hidden sm:table-cell">
                    {c.agent_extension ? `ext ${c.agent_extension}` : '—'}
                  </td>
                  <td className="py-3 font-mono tnum text-lamp-available font-semibold">
                    {fmt(elapsed(c.agent_answer_time, tick))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

    </div>
  );
}
