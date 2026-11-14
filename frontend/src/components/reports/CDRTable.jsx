import { useCallback, useEffect, useState } from 'react';
import { Download, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { Reports as ReportsApi } from '../../api/client.js';

const PAGE_SIZE = 50;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtTs(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function fmtSec(s) {
  if (s == null || s === '') return '—';
  const n = Number(s);
  if (Number.isNaN(n)) return '—';
  const m = Math.floor(n / 60);
  const r = String(n % 60).padStart(2, '0');
  return `${m}:${r}`;
}

function shortUuid(uuid) {
  if (!uuid) return '—';
  return uuid.slice(0, 8) + '…';
}

// ── Disposition badge ─────────────────────────────────────────────────────────

const DISP = {
  answered:        { label: 'ANSWERED',       cls: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/25' },
  abandoned_agent: { label: 'MISSED (AGENT)', cls: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 ring-1 ring-orange-200 dark:ring-orange-500/25' },
  abandoned_queue: { label: 'ABANDONED',      cls: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-500/25' },
  waiting:         { label: 'WAITING',        cls: 'bg-surface-2 dark:bg-panel-raised text-ink-dim ring-1 ring-border' },
};

function DispositionBadge({ value }) {
  const d = DISP[value] ?? { label: (value ?? 'UNKNOWN').toUpperCase(), cls: 'bg-surface-2 text-ink-dim ring-1 ring-border' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-bold ${d.cls}`}>
      {d.label}
    </span>
  );
}

function AgentCell({ agent, missedBy, disposition }) {
  if (!agent && !missedBy) return <span className="text-ink-faint">—</span>;
  const name  = agent || missedBy;
  const isMiss = disposition === 'abandoned_agent';
  return (
    <span
      title={isMiss ? `Offered to ${name} — not answered` : undefined}
      className={isMiss
        ? 'font-medium text-orange-600 dark:text-orange-400 cursor-help'
        : 'font-medium text-ink'}
    >
      {name}
    </span>
  );
}

// ── Client-side CSV export ────────────────────────────────────────────────────

async function downloadCSV(from, to) {
  const cols = [
    'call_uuid', 'ani', 'dnis', 'queue_name', 'agent',
    'queue_wait_seconds', 'ring_seconds', 'talk_seconds', 'abandoned_seconds',
    'disposition', 'start_time', 'end_time'
  ];
  const rows = await ReportsApi.cdr({ from, to, limit: 5000, offset: 0 });
  const header = cols.join(',');
  const body   = rows.map(r =>
    cols.map(c => {
      const v = r[c] ?? '';
      return typeof v === 'string' && (v.includes(',') || v.includes('"'))
        ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')
  ).join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `cdr-${from}-${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CDRTable({ from, to }) {
  const [rows,       setRows]       = useState([]);
  const [page,       setPage]       = useState(0);
  const [hasMore,    setHasMore]    = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [exporting,  setExporting]  = useState(false);
  const [dispFilter, setDispFilter] = useState('');

  const load = useCallback(async (pg = 0, disp = dispFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = { from, to, limit: PAGE_SIZE + 1, offset: pg * PAGE_SIZE };
      if (disp) params.disposition = disp;
      const data = await ReportsApi.cdr(params);
      setHasMore(data.length > PAGE_SIZE);
      setRows(data.slice(0, PAGE_SIZE));
      setPage(pg);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [from, to, dispFilter]);

  useEffect(() => { load(0); }, [from, to]);

  function handleDispChange(e) {
    setDispFilter(e.target.value);
    load(0, e.target.value);
  }

  async function handleExport() {
    setExporting(true);
    try { await downloadCSV(from, to); }
    catch (err) { setError('CSV export failed: ' + err.message); }
    finally { setExporting(false); }
  }

  // ── Header columns ──────────────────────────────────────────────────────────

  const TH = ({ children, className = '' }) => (
    <th className={`th ${className}`}>
      {children}
    </th>
  );

  return (
    <div className="bg-white dark:bg-panel-surface rounded-xl shadow-md border border-border dark:border-panel-border overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border dark:border-panel-border">
        <div>
          <h3 className="text-base font-bold text-ink">Call Detail Records</h3>
          <p className="text-xs text-ink-faint mt-0.5">
            {from} → {to}
            {page > 0 || rows.length > 0 ? ` · Page ${page + 1}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Disposition filter */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
            <select
              value={dispFilter}
              onChange={handleDispChange}
              className="pl-7 pr-3 py-1.5 rounded-lg border border-border-strong dark:border-panel-border
                bg-white dark:bg-panel-raised text-sm text-ink dark:text-ink-dim
                focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            >
              <option value="">All Dispositions</option>
              <option value="answered">Answered</option>
              <option value="abandoned_agent">Missed by Agent</option>
              <option value="abandoned_queue">Abandoned in Queue</option>
              <option value="waiting">Waiting</option>
            </select>
          </div>

          {/* Refresh */}
          <button
            onClick={() => load(page)}
            disabled={loading}
            title="Refresh"
            className="p-2 rounded-lg border border-border dark:border-panel-border bg-white dark:bg-panel-raised
              text-ink-dim dark:text-ink-faint hover:text-ink dark:hover:text-ink
              hover:bg-surface-2 dark:hover:bg-panel-border transition-colors disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          {/* CSV export */}
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
              bg-blue-600 text-white shadow-sm shadow-blue-600/20
              hover:bg-blue-700 active:bg-blue-800 transition-colors
              disabled:opacity-50 disabled:pointer-events-none"
          >
            <Download size={13} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-lamp-alert/10 border border-lamp-alert/25 text-sm text-lamp-alert">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="overflow-x-auto">
        <table className="data-table min-w-[960px]">
          <thead>
            <tr className="border-b border-border dark:border-panel-border">
              <TH>UUID</TH>
              <TH>Caller (ANI)</TH>
              <TH>DNIS</TH>
              <TH>Queue</TH>
              <TH>Agent</TH>
              <TH>Wait / Ring</TH>
              <TH>Talk</TH>
              <TH>Abandoned</TH>
              <TH>Disposition</TH>
              <TH>Start Time</TH>
              <TH>End Time</TH>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-panel-border">
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={11} className="py-12 text-center text-sm text-ink-faint">
                  <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-blue-400" />
                  Loading records…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={11} className="py-12 text-center text-sm text-ink-faint">
                  No records found for the selected date range and filter.
                </td>
              </tr>
            )}
            {rows.map(r => (
              <tr
                key={r.call_uuid}
                className="hover:bg-blue-50/50 dark:hover:bg-panel-raised/40 transition-colors"
              >
                <td className="td font-mono text-[0.6875rem] text-ink-faint">
                  <span title={r.call_uuid} className="cursor-default">{shortUuid(r.call_uuid)}</span>
                </td>
                <td className="td font-semibold text-ink font-mono">
                  {r.caller_name ? `${r.caller_name} (${r.ani || '—'})` : (r.ani || '—')}
                </td>
                <td className="td text-ink-dim font-mono">
                  {r.dnis || '—'}
                </td>
                <td className="td">
                  <span className="font-medium text-ink dark:text-ink-dim">
                    {r.queue_display_name || r.queue_name || '—'}
                  </span>
                </td>
                <td className="td">
                  <AgentCell
                    agent={r.agent}
                    missedBy={r.missed_by_agent}
                    disposition={r.disposition}
                  />
                </td>
                <td className="td font-mono text-ink-dim tnum">
                  {/* Answered → canonical queue_wait_seconds (queue wait); missed → ring_seconds (agent ring). */}
                  {fmtSec(r.queue_wait_seconds ?? r.ring_seconds)}
                </td>
                <td className="td font-mono text-ink-dim tnum">
                  {fmtSec(r.talk_seconds)}
                </td>
                <td className="td font-mono text-amber-600 dark:text-amber-400 tnum">
                  {fmtSec(r.abandoned_seconds)}
                </td>
                <td className="td">
                  <DispositionBadge value={r.disposition} />
                </td>
                <td className="td text-ink-dim whitespace-nowrap">
                  {fmtTs(r.start_time)}
                </td>
                <td className="td text-ink-dim whitespace-nowrap">
                  {fmtTs(r.end_time)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-border dark:border-panel-border bg-surface-2 dark:bg-panel-raised/30">
        <button
          onClick={() => load(page - 1)}
          disabled={page === 0 || loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-strong dark:border-panel-border
            text-xs font-medium text-ink-dim bg-white dark:bg-panel-raised
            hover:bg-surface-2 dark:hover:bg-panel-border transition-colors
            disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronLeft size={13} /> Prev
        </button>
        <span className="text-xs text-ink-faint font-mono">
          Page {page + 1} · {rows.length} records
        </span>
        <button
          onClick={() => load(page + 1)}
          disabled={!hasMore || loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-strong dark:border-panel-border
            text-xs font-medium text-ink-dim bg-white dark:bg-panel-raised
            hover:bg-surface-2 dark:hover:bg-panel-border transition-colors
            disabled:opacity-40 disabled:pointer-events-none"
        >
          Next <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
