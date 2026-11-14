import React, { useEffect, useRef, useState } from 'react';
import { StatusDot } from '../ui/primitives.jsx';

/**
 * Connection health: ONE compact badge (Healthy / Warning / Unhealthy) that opens
 * a detail list of every component. The summary is the WORST component level, so
 * a working app with a disconnected phone still never reads "Healthy".
 *
 * Each item: { key, label, level: ok|warn|error|off|busy, detail }
 */
export function buildLamps({ apiOk, socketConnected, eslConnected, phone }) {
  const lamps = [
    {
      key: 'api',
      label: 'Server',
      level: apiOk === null ? 'warn' : apiOk ? 'ok' : 'error',
      detail: apiOk === null ? 'Checking FS-CC server…' : apiOk ? 'FS-CC server reachable' : 'FS-CC server not reachable',
    },
    {
      key: 'live',
      label: 'Live updates',
      level: socketConnected ? 'ok' : 'error',
      detail: socketConnected ? 'Live updates connected' : 'Live updates disconnected — reconnecting',
    },
    {
      key: 'fs',
      label: 'SIP engine',
      level: eslConnected ? 'ok' : 'error',
      detail: eslConnected ? 'SIP engine connected' : 'SIP engine offline — calls cannot be routed',
    },
  ];
  if (phone) {
    lamps.push({ key: 'phone', label: 'Phone', level: phone.level, detail: phone.label });
  }
  return lamps;
}

/** Overall health from the worst component: error → unhealthy; warn/busy/off → warning. */
export function overallHealth(lamps) {
  if (lamps.some((l) => l.level === 'error')) return { level: 'error', label: 'Unhealthy' };
  if (lamps.some((l) => l.level !== 'ok')) return { level: 'warn', label: 'Warning' };
  return { level: 'ok', label: 'Healthy' };
}

const SUMMARY_TONE = {
  ok: 'text-ink-dim',
  warn: 'text-status-ringing border-status-ringing/40 bg-status-ringing/10',
  error: 'text-status-error border-status-error/40 bg-status-error/10',
};

export default function ConnectionLamps({ lamps }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const health = overallHealth(lamps);
  const problems = lamps.filter((l) => l.level !== 'ok');

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`System status: ${health.label}${problems.length ? ` (${problems.map((p) => p.label).join(', ')})` : ''}`}
        title={problems.length ? problems.map((p) => p.detail).join(' · ') : 'All systems connected'}
        data-level={health.level}
        className={`inline-flex items-center gap-1.5 h-7 rounded-md border border-transparent px-2 text-[0.75rem] font-medium hover:bg-surface-2 ${SUMMARY_TONE[health.level]}`}
      >
        <StatusDot level={health.level} />
        <span>{health.label}</span>
        {problems.length > 0 && <span className="hidden sm:inline font-normal">· {problems.map((p) => p.label).join(', ')}</span>}
      </button>

      {open && (
        <div role="dialog" aria-label="Connection status details"
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-surface p-2 shadow-lg">
          <ul aria-label="Connection status" className="space-y-1">
            {lamps.map((l) => (
              <li key={l.key} data-level={l.level} className="flex items-start gap-2 rounded px-2 py-1.5">
                <StatusDot level={l.level} className="mt-1.5" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{l.label}</div>
                  <div className="text-xs text-ink-dim">{l.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
