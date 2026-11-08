import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Coffee, Loader2, LogOut } from 'lucide-react';
import { api } from '../api/client.js';
import { StatusDot } from '../ui/primitives.jsx';

/**
 * Header status selector. Same behaviour as the former StatusControls card:
 * - only the three backend statuses: Available, On Break (+ configured break code), Logged Out
 * - posts through api.setStatus exactly as before, then calls onStatusChange(newStatus)
 * - break codes come from the backend, never hard-coded
 * No new statuses, no transition changes.
 */
export function statusLevel(status) {
  if (status === 'Available') return 'ok';
  if (status === 'On Break') return 'break';
  return 'off';
}

export default function StatusSelector({ currentStatus, breakName, breakCodes, onStatusChange, onError }) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function post(status, breakCode) {
    if (changing) return;
    setChanging(status);
    setOpen(false);
    try {
      const res = await api.setStatus(status, breakCode);
      onStatusChange(res.status ?? status);
    } catch (err) {
      onError?.(err.message || 'Failed to change status');
    } finally {
      setChanging(null);
    }
  }

  const label = currentStatus === 'On Break' && breakName ? `On Break · ${breakName}` : currentStatus;
  const item = 'w-full flex items-center gap-2.5 px-3 h-9 text-sm text-ink hover:bg-panel-raised focus:bg-panel-raised focus:outline-none text-left disabled:opacity-50';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!!changing}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Agent status: ${label}. Change status`}
        className="inline-flex items-center gap-2 h-9 pl-3 pr-2 rounded-md border border-panel-border bg-panel-surface
                   text-sm font-medium text-ink hover:bg-panel-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {changing ? <Loader2 size={14} className="animate-spin" /> : <StatusDot level={statusLevel(currentStatus)} />}
        <span className="max-w-[11rem] truncate">{label}</span>
        <ChevronDown size={14} className={`text-ink-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-panel-border bg-panel-surface py-1 shadow-lg">
          <button role="menuitem" className={item} disabled={currentStatus === 'Available'} onClick={() => post('Available')}>
            <StatusDot level="ok" /> <span className="flex-1">Available</span>
            {currentStatus === 'Available' && <Check size={14} className="text-ink-dim" />}
          </button>

          <p className="px-3 pt-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint flex items-center gap-1.5">
            <Coffee size={12} /> {currentStatus === 'On Break' ? 'Change break' : 'Take a break'}
          </p>
          {(!breakCodes || breakCodes.length === 0) ? (
            <p className="px-3 py-2 text-xs text-ink-faint">No break reasons configured. Ask your supervisor.</p>
          ) : breakCodes.map((bc) => (
            <button key={bc.code} role="menuitem" className={item} onClick={() => post('On Break', bc.code)}>
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full shrink-0 border border-panel-border"
                style={bc.color ? { backgroundColor: bc.color } : undefined}
              />
              <span className="flex-1 truncate">{bc.name}</span>
              {bc.max_duration_seconds ? (
                <span className="text-[0.6875rem] text-ink-faint">{Math.round(bc.max_duration_seconds / 60)}m</span>
              ) : null}
            </button>
          ))}

          <div className="my-1 border-t border-panel-border" />
          <button role="menuitem" className={item} onClick={() => post('Logged Out')}>
            <LogOut size={14} className="text-ink-dim" /> Log out of queues
          </button>
        </div>
      )}
    </div>
  );
}
