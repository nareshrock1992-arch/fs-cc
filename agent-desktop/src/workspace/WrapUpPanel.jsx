import React, { useEffect, useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { formatDuration, useElapsed } from './format.js';

/**
 * WrapUpPanel — after-call work time, from REAL contact-center state only:
 * mod_callcenter keeps an Available agent in state "Idle" for the agent's
 * wrap_up_time after a queue call, then returns them to "Waiting" for the next
 * call. FS-CC has no disposition API, so no disposition field is shown.
 *
 * isWrapUp(): Available + Idle, and only after this desktop saw the agent on a
 * call (Idle right after login is not wrap-up).
 */
export function isWrapUp({ agentStatus, agentState, hadCall }) {
  return agentStatus === 'Available' && agentState === 'Idle' && Boolean(hadCall);
}

export default function WrapUpPanel({ agentStatus, agentState, wrapUpSeconds }) {
  // Remember that a call happened, and when wrap-up started (first Idle after it).
  const hadCall = useRef(false);
  const [since, setSince] = useState(null);
  if (agentState === 'Receiving' || agentState === 'In a queue call') hadCall.current = true;
  const active = isWrapUp({ agentStatus, agentState, hadCall: hadCall.current });

  useEffect(() => {
    if (active) setSince((s) => s || Date.now());
    else {
      setSince(null);
      if (agentState === 'Waiting' || agentStatus !== 'Available') hadCall.current = false;
    }
  }, [active, agentState, agentStatus]);

  const elapsed = useElapsed(active ? since : null);
  if (!active) return null;
  const total = Number.isFinite(wrapUpSeconds) && wrapUpSeconds > 0 ? wrapUpSeconds : null;
  const left = total ? Math.max(0, total - elapsed) : null;

  return (
    <section aria-label="Wrap-up" role="status"
      className="flex items-center gap-3 rounded-lg border border-panel-border bg-panel-surface px-4 py-3">
      <ClipboardCheck size={18} className="text-status-onbreak shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Wrap-up</p>
        <p className="text-xs text-ink-dim">Finish your notes. The next queue call is offered when wrap-up ends.</p>
      </div>
      <p className="font-mono text-sm text-ink tabular-nums" aria-label={left != null ? 'Wrap-up time left' : 'Wrap-up time'}>
        {left != null ? formatDuration(left) : formatDuration(elapsed)}
        <span className="ml-1 font-sans text-[0.6875rem] text-ink-faint">{left != null ? 'left' : ''}</span>
      </p>
    </section>
  );
}
