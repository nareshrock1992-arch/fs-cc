import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Settings2, WifiOff, AlertTriangle } from 'lucide-react';
import { Stats } from '../api/client.js';
import { selectQueues, agentsForQueues, wallboardTiles, slBand, mmss } from './wallboard/model.js';

// M2 Part C — Wallboard: full screen for a TV, read-only, refreshes every 5 s.
// Owner decision 2026-11-23: a supervisor signs in once on the TV browser.
// Real data only: unknown values show "—" with a plain reason (TASTE).

const REFRESH_MS = 5000;
const STORE_KEY = 'fscc.wallboard.queues';
const readChoice = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; } };
const saveChoice = (v) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* private mode */ } };

const BAND = {
  good: 'text-lamp-ok', warn: 'text-lamp-warn', bad: 'text-lamp-alert', none: 'text-ink-faint',
};
const num = (v) => (v == null ? '—' : v);
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

function Tile({ label, value, sub, tone = '', testId }) {
  return (
    <div className="rounded-lg border border-border dark:border-panel-border bg-white dark:bg-panel-surface px-5 py-4 min-w-0" data-testid={testId}>
      <p className="text-[clamp(0.85rem,1.2vw,1.25rem)] text-ink-dim leading-tight">{label}</p>
      <p className={`font-display font-semibold tnum leading-none mt-2 text-[clamp(2.25rem,5vw,5rem)] ${tone || 'text-ink'}`}>{value}</p>
      {sub && <p className="text-[clamp(0.75rem,1vw,1.05rem)] text-ink-faint mt-2">{sub}</p>}
    </div>
  );
}

export default function Wallboard() {
  const [queueStats, setQueueStats] = useState(null);
  const [agents, setAgents]         = useState([]);
  const [phoneOnline, setPhoneOnline] = useState(true);
  const [updatedAt, setUpdatedAt]   = useState(null);
  const [failedSince, setFailedSince] = useState(null);
  const [chosen, setChosen]         = useState(readChoice);
  const [picking, setPicking]       = useState(false);
  const [now, setNow]               = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const [qs, la] = await Promise.all([Stats.queues(), Stats.liveAgents()]);
      setQueueStats(qs);
      setAgents(Array.isArray(la?.agents) ? la.agents : []);
      setPhoneOnline(la?.eslConnected !== false);
      setUpdatedAt(Date.now());
      setFailedSince(null);
    } catch {
      setFailedSince((f) => f ?? Date.now());
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [refresh]);

  const queues = useMemo(() => selectQueues(queueStats, chosen), [queueStats, chosen]);
  const tiles  = useMemo(() => wallboardTiles({ queues, agents: agentsForQueues(agents, queues), phoneOnline }), [queues, agents, phoneOnline]);
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;

  function toggle(name) {
    const next = chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name];
    setChosen(next); saveChoice(next);
  }

  return (
    <div className="min-h-screen bg-surface dark:bg-panel-bg px-6 py-5 flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/" className="text-ink-faint hover:text-ink" aria-label="Back to the admin portal" title="Back to the admin portal"><ArrowLeft size={20} /></Link>
          <h1 className="font-display font-semibold text-[clamp(1.25rem,2vw,2rem)] text-ink truncate">
            Wallboard · {queues.length === (queueStats || []).length ? 'All queues' : queues.map((q) => q.display_name || q.queue_name).join(', ')}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-[clamp(0.8rem,1vw,1.1rem)] text-ink-dim">
          <span className="tnum">{new Date(now).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
          <span data-testid="wb-updated">{ago == null ? 'Loading…' : `Updated ${ago} s ago`}</span>
          <button className="text-ink-faint hover:text-ink" onClick={() => setPicking((p) => !p)} aria-label="Choose queues" title="Choose queues"><Settings2 size={18} /></button>
        </div>
      </header>

      {!phoneOnline && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-lamp-warn/40 bg-lamp-warn/10 px-4 py-2 text-lamp-warn text-[clamp(0.9rem,1.2vw,1.2rem)]">
          <WifiOff size={18} aria-hidden="true" /> Live numbers paused — the phone system isn't reachable. Today's totals are still shown.
        </div>
      )}
      {failedSince && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-lamp-alert/40 bg-lamp-alert/10 px-4 py-2 text-lamp-alert text-[clamp(0.9rem,1.2vw,1.2rem)]">
          <AlertTriangle size={18} aria-hidden="true" /> Can't reach the server — showing the last numbers{updatedAt ? ` from ${new Date(updatedAt).toLocaleTimeString()}` : ''}.
        </div>
      )}

      {picking && (
        <div className="rounded-lg border border-border dark:border-panel-border bg-white dark:bg-panel-surface px-4 py-3" aria-label="Queues on the wallboard">
          <p className="text-sm text-ink-dim mb-2">Queues on this wallboard (none ticked = all queues). Saved on this screen.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(queueStats || []).map((q) => (
              <label key={q.queue_name} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={chosen.includes(q.queue_name)} onChange={() => toggle(q.queue_name)} />
                {q.display_name || q.queue_name}
              </label>
            ))}
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Totals">
        <Tile testId="wb-waiting" label="Waiting now" value={num(tiles.waiting)} sub={`Longest ${mmss(tiles.longestWaitSeconds)}`} />
        <Tile testId="wb-sl" label="Service level today" value={pct(tiles.serviceLevel)} tone={BAND[slBand(tiles.serviceLevel)]}
          sub={tiles.serviceLevel == null ? 'No answered or abandoned calls yet' : 'Answered within target'} />
        <Tile testId="wb-calls" label="Answered / abandoned today" value={`${num(tiles.answered)} / ${num(tiles.abandoned)}`} sub={`Average wait ${mmss(tiles.avgWaitSeconds)}`} />
        <Tile testId="wb-agents" label="Agents ready · on call · on break"
          value={`${num(tiles.agentsReady)} · ${num(tiles.agentsOnCall)} · ${num(tiles.agentsOnBreak)}`} />
      </section>

      <section className="flex-1 rounded-lg border border-border dark:border-panel-border bg-white dark:bg-panel-surface overflow-hidden" aria-label="Queues">
        <table className="w-full text-[clamp(0.95rem,1.5vw,1.6rem)]">
          <thead>
            <tr className="text-left text-ink-faint text-[clamp(0.75rem,1vw,1.05rem)] border-b border-border dark:border-panel-border">
              <th className="px-5 py-2 font-medium">Queue</th>
              <th className="px-5 py-2 font-medium text-right">Waiting</th>
              <th className="px-5 py-2 font-medium text-right">Longest</th>
              <th className="px-5 py-2 font-medium text-right">Service level</th>
              <th className="px-5 py-2 font-medium text-right">Answered</th>
              <th className="px-5 py-2 font-medium text-right">Abandoned</th>
            </tr>
          </thead>
          <tbody>
            {queues.map((q) => {
              const sl = q.sla_pct_today == null ? null : Number(q.sla_pct_today);
              return (
                <tr key={q.queue_name} className="border-b border-border/60 dark:border-panel-border/40" data-testid={`wb-row-${q.queue_name}`}>
                  <td className="px-5 py-2 text-ink">{q.display_name || q.queue_name}</td>
                  <td className="px-5 py-2 text-right tnum">{phoneOnline ? Number(q.waiting || 0) : '—'}</td>
                  <td className="px-5 py-2 text-right tnum">{phoneOnline ? mmss(q.longest_wait_seconds) : '—'}</td>
                  <td className={`px-5 py-2 text-right tnum ${BAND[slBand(sl)]}`}>{pct(sl)}</td>
                  <td className="px-5 py-2 text-right tnum">{Number(q.answered_today || 0)}</td>
                  <td className="px-5 py-2 text-right tnum">{Number(q.abandoned_today || 0)}</td>
                </tr>
              );
            })}
            {queueStats && queues.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-ink-faint">No queues are set up yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
