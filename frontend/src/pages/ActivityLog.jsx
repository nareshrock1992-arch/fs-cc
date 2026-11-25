import { useCallback, useEffect, useState } from 'react';
import { History, Search, AlertTriangle, RefreshCw } from 'lucide-react';
import { Activity } from '../api/client.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { inputClass, buttonSecondary } from '../components/form.jsx';
import { describeActivity } from '../lib/activityText.js';

// M2 Part B — Activity log: who changed what, when (read-only). Settings changes and
// supervisor actions on calls, newest first. Visible to admins and supervisors with
// the "view activity log" right (owner decision 2026-11-23).

const PERIODS = [
  { days: 1, label: 'Last 24 hours' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];
const PAGE = 100;
const headCls = 'text-left text-[0.6875rem] text-ink-faint border-b border-border dark:border-panel-border';
const rowCls  = 'border-b border-border dark:border-panel-border/40 align-top';

function when(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ActivityLog() {
  const [days, setDays]       = useState(7);
  const [search, setSearch]   = useState('');
  const [term, setTerm]       = useState('');
  const [rows, setRows]       = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Search runs shortly after typing stops.
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async (offset = 0) => {
    setLoading(true); setError(null);
    try {
      const r = await Activity.list({ days, q: term || undefined, limit: PAGE, offset });
      setRows((prev) => (offset ? [...prev, ...r.rows] : r.rows));
      setHasMore(r.hasMore);
    } catch (err) {
      setError(err.response?.status === 403
        ? 'You do not have access to the activity log. Ask an admin for the "View activity log" right.'
        : 'The activity log could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  }, [days, term]);

  useEffect(() => { load(0); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-sm text-ink-dim">Who changed settings or acted on calls, and when. Newest first.</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            <input className={`${inputClass} pl-8 w-56`} placeholder="Search who or what"
              aria-label="Search the activity log" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={`${inputClass} w-40`} aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
          </select>
          <button className={buttonSecondary} onClick={() => load(0)} aria-label="Refresh" title="Refresh"><RefreshCw size={14} /></button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg border border-lamp-alert/30 bg-lamp-alert/10 px-3 py-2 text-sm text-lamp-alert">
          <AlertTriangle size={15} aria-hidden="true" /> {error}
        </div>
      )}

      <div className="rounded-lg border border-border dark:border-panel-border bg-white dark:bg-panel-surface">
        {loading && rows.length === 0 ? (
          <LoadingState rows={5} cols={3} label="Loading activity…" />
        ) : rows.length === 0 && !error ? (
          <EmptyState icon={History} title="No activity in this period"
            body={term ? 'Nothing matches your search. Try fewer words or a longer period.' : 'Changes to agents, users, break codes, outcomes and supervisor actions will appear here.'} />
        ) : (
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr>
                <th className={`${headCls} px-4 py-2 w-48`}>When</th>
                <th className={`${headCls} px-4 py-2 w-40`}>Who</th>
                <th className={`${headCls} px-4 py-2`}>What changed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.kind}-${r.at}-${i}`} className={rowCls}>
                  <td className="px-4 py-2 text-ink-dim tnum whitespace-nowrap">{when(r.at)}</td>
                  <td className="px-4 py-2 text-ink">{r.actor || '—'}{r.actor_role ? <span className="text-ink-faint"> · {r.actor_role}</span> : null}</td>
                  <td className="px-4 py-2 text-ink">{describeActivity(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {hasMore && (
        <div className="mt-3 flex justify-center">
          <button className={buttonSecondary} disabled={loading} onClick={() => load(rows.length)}>Show more</button>
        </div>
      )}
    </div>
  );
}
