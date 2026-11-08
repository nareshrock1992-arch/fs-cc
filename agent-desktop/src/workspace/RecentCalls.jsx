import React from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, History } from 'lucide-react';
import { Badge } from '../ui/primitives.jsx';
import { formatClock, formatDuration } from './format.js';

/** The number to call back for a call-history row (outbound → dialled number). */
export function callbackNumber(row) {
  return row.direction === 'outbound' ? row.dnis : row.ani;
}

/**
 * RecentCalls — this agent's latest calls from the existing agent-scoped call-history API
 * (time, number, caller name, queue, result). Clicking a row loads the number into the
 * phone console; it never dials by itself.
 */
export default function RecentCalls({ calls = [], loading = false, onPick }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint mb-2">
        <History size={12} aria-hidden="true" /> Recent calls
      </p>
      {loading && calls.length === 0 && <p className="text-xs text-ink-dim">Loading…</p>}
      {!loading && calls.length === 0 && <p className="text-xs text-ink-dim">No calls yet today or recently.</p>}
      {calls.length > 0 && (
        <ul className="divide-y divide-panel-border" aria-label="Recent calls">
          {calls.map((c) => {
            const n = callbackNumber(c);
            const missed = c.missed;
            const Icon = missed ? PhoneMissed : c.direction === 'outbound' ? PhoneOutgoing : PhoneIncoming;
            return (
              <li key={c.call_uuid}>
                <button
                  type="button"
                  disabled={!n}
                  onClick={() => onPick?.(n)}
                  title={n ? `Load ${n} into the phone` : 'No number recorded'}
                  className="w-full grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2.5 py-2 px-1 rounded text-left
                             hover:bg-panel-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
                >
                  <Icon size={14} className={missed ? 'text-status-error' : 'text-ink-dim'} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-mono text-sm text-ink truncate">{n || 'Unknown'}</span>
                    <span className="block text-[0.6875rem] text-ink-dim truncate">
                      {[c.caller_name, c.queue_name, formatClock(c.start_time)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {missed
                    ? <Badge tone="error">Missed</Badge>
                    : <span className="font-mono text-xs text-ink-dim">{formatDuration(c.agent_talk_seconds ?? c.talk_seconds ?? 0)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
