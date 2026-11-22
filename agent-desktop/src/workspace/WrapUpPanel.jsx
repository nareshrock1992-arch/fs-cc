import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client.js';
import { formatDuration, useElapsed } from './format.js';

/**
 * WrapUpPanel — after-call work (M1): outcome (required) + notes (optional), then
 * "Ready now".
 *
 * Wrap-up timing stays with FreeSWITCH mod_callcenter: after a queue call the agent is
 * offered the next call once their wrap_up_time has passed since the call ended (state
 * returns to "Waiting" immediately; there is no Idle phase for Available agents). The
 * panel therefore follows the agent's latest answered queue call from the backend
 * (GET /agent-desk/wrapup), not the FreeSWITCH state, and counts down wrap_up_time from
 * the moment this desktop saw the call end.
 *
 * - Outcome is required before "Ready now"; the backend enforces the same rule.
 * - If wrap-up time runs out first, the call stays "outcome required" here until saved
 *   (the next call is still offered as before — agent-state logic is unchanged).
 * - Earlier calls without an outcome are listed so the agent can complete them.
 */
const IN_CALL = new Set(['Receiving', 'In a queue call']);

export function isOnCall(agentState) { return IN_CALL.has(agentState); }

function callLabel(c) {
  const who = c.caller_name ? `${c.caller_name} · ${c.ani || ''}` : (c.ani || 'Caller');
  return `${who}${c.queue_name ? ` · ${c.queue_name.split('@')[0]}` : ''}`;
}

export default function WrapUpPanel({ agentStatus, agentState, wrapUpSeconds }) {
  const [calls, setCalls] = useState([]);
  const [notesMax, setNotesMax] = useState(2000);
  const [selected, setSelected] = useState(null);          // call_uuid chosen from "earlier calls"
  const [editing, setEditing] = useState(false);           // change a saved outcome
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(null);                  // 'save' | 'ready'
  const [error, setError] = useState(null);
  const [readyDone, setReadyDone] = useState(() => new Set());
  const [endedAt, setEndedAt] = useState({});               // call_uuid → ms this desk saw the end
  const prevState = useRef(agentState);

  const load = useCallback(async () => {
    try {
      const data = await api.wrapups();
      const list = Array.isArray(data?.calls) ? data.calls : [];
      setCalls(list);
      if (data?.notes_max) setNotesMax(data.notes_max);
      return list;
    } catch { return null; /* keep the last list; the next call end retries */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A call just ended → refresh now and once more shortly after (the backend
  // finalises the call row from FreeSWITCH events a moment after the hang-up).
  // The countdown starts from the moment this desk saw the end (no clock skew).
  useEffect(() => {
    const was = prevState.current;
    prevState.current = agentState;
    if (IN_CALL.has(was) && !IN_CALL.has(agentState)) {
      const endMs = Date.now();
      load().then((list) => {
        const id = list?.[0]?.call_uuid;
        if (id) setEndedAt((m) => (m[id] ? m : { ...m, [id]: endMs }));
      });
      const t = setTimeout(load, 2000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [agentState, load]);

  const latest = calls[0] || null;
  const pending = calls.filter((c) => !c.wrapup);
  const total = Number.isFinite(wrapUpSeconds) && wrapUpSeconds > 0 ? wrapUpSeconds : 0;

  const endMs = latest ? (endedAt[latest.call_uuid]
    ?? (latest.ended_at ? new Date(latest.ended_at).getTime() : null)) : null;
  const elapsed = useElapsed(endMs);
  const left = endMs && total ? Math.max(0, total - elapsed) : 0;
  const inWrapUp = Boolean(latest && endMs && left > 0 && !readyDone.has(latest.call_uuid));

  // Which call the panel works on: one the agent picked, else the latest call while
  // it is in wrap-up or still lacks an outcome, else the newest earlier call without one.
  let target = null;
  if (selected) target = calls.find((c) => c.call_uuid === selected) || null;
  if (!target && latest && endMs && (inWrapUp || !latest.wrapup)) target = latest;
  if (!target && pending.length) target = pending[0];

  const targetKey = target?.call_uuid;
  useEffect(() => {
    setCode(target?.wrapup && target.wrapup.source === 'agent' ? target.wrapup.code : '');
    setNotes(target?.wrapup?.notes || '');
    setEditing(false); setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  if (IN_CALL.has(agentState) || !target) return null;

  const isLatest = latest && target.call_uuid === latest.call_uuid;
  const saved = target.wrapup;
  const showForm = !saved || saved.source === 'system' || editing;
  const others = pending.filter((c) => c.call_uuid !== target.call_uuid);
  const options = target.options || [];

  async function save(e) {
    e?.preventDefault();
    if (!code) { setError('Choose an outcome for this call.'); return; }
    setBusy('save'); setError(null);
    try {
      await api.saveWrapup(target.call_uuid, code, notes.trim());
      setSelected(null); setEditing(false);
      await load();
    } catch (err) { setError(err.message || 'Could not save the outcome'); }
    finally { setBusy(null); }
  }

  async function ready() {
    setBusy('ready'); setError(null);
    try {
      await api.readyNow();
      setReadyDone((s) => new Set(s).add(target.call_uuid));
    } catch (err) { setError(err.message || 'Could not end wrap-up'); }
    finally { setBusy(null); }
  }

  const canReady = isLatest && inWrapUp && saved && agentStatus === 'Available' && !editing;

  return (
    <section aria-label="Wrap-up"
      className="rounded-lg border border-panel-border bg-panel-surface px-4 py-3 space-y-3">
      <div className="flex items-start gap-3">
        <ClipboardCheck size={18} className="text-status-onbreak shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Wrap-up</p>
          <p className="text-xs text-ink-dim truncate">{callLabel(target)}</p>
        </div>
        {isLatest && endMs && total > 0 && (
          <p className="font-mono text-sm text-ink tabular-nums" role="status"
             aria-label={inWrapUp ? 'Wrap-up time left' : 'Wrap-up time'}>
            {inWrapUp ? formatDuration(left) : '00:00'}
            <span className="ml-1 font-sans text-[0.6875rem] text-ink-faint">left</span>
          </p>
        )}
      </div>

      {!saved && isLatest && endMs && !inWrapUp && (
        <p className="text-xs text-status-onbreak" role="status">
          Wrap-up time is over and the next call can arrive. Choose the outcome for this call.
        </p>
      )}
      {saved?.source === 'system' && (
        <p className="text-xs text-ink-dim">Marked “{saved.name}” by the system. Choose the real outcome if you know it.</p>
      )}

      {showForm ? (
        <form onSubmit={save} className="space-y-2" aria-label="Call outcome">
          <label className="block text-xs font-medium text-ink-dim" htmlFor="wrapup-outcome">
            Outcome <span className="text-status-error">*</span>
          </label>
          <select id="wrapup-outcome" value={code} onChange={(e) => { setCode(e.target.value); setError(null); }}
            className="w-full rounded-md border border-panel-border bg-panel-bg px-2 py-1.5 text-sm text-ink"
            aria-required="true">
            <option value="">Choose an outcome…</option>
            {options.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
          {options.length === 0 && (
            <p className="text-xs text-status-error">No outcomes are set up for this queue. Ask your supervisor.</p>
          )}
          <label className="block text-xs font-medium text-ink-dim" htmlFor="wrapup-notes">Notes (optional)</label>
          <textarea id="wrapup-notes" rows={2} maxLength={notesMax} value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-describedby="wrapup-notes-hint"
            className="w-full rounded-md border border-panel-border bg-panel-bg px-2 py-1.5 text-sm text-ink resize-y" />
          <p id="wrapup-notes-hint" className="text-[0.6875rem] text-ink-faint">
            Supervisors can read notes in reports. Do not type card numbers or passwords.
          </p>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy === 'save'}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
              {busy === 'save' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Save outcome
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="text-sm text-ink-dim hover:text-ink">Cancel</button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="inline-flex items-center gap-1.5 text-sm text-ink">
            <CheckCircle2 size={15} className="text-status-available" aria-hidden="true" />
            {saved.name}
          </p>
          {saved.notes && <p className="text-xs text-ink-dim truncate max-w-full">{saved.notes}</p>}
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-ink-dim underline hover:text-ink">Change</button>
          {canReady && (
            <button type="button" onClick={ready} disabled={busy === 'ready'}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
              {busy === 'ready' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Ready now
            </button>
          )}
        </div>
      )}

      {!saved && isLatest && inWrapUp && (
        <p className="text-xs text-ink-faint">Save the outcome to use “Ready now”.</p>
      )}
      {error && <p className="text-xs text-status-error" role="alert">{error}</p>}

      {others.length > 0 && (
        <div className="border-t border-panel-border pt-2">
          <p className="text-xs text-ink-dim">
            {others.length === 1 ? '1 earlier call needs an outcome:' : `${others.length} earlier calls need an outcome:`}
          </p>
          <ul className="mt-1 space-y-1">
            {others.slice(0, 5).map((c) => (
              <li key={c.call_uuid}>
                <button type="button" onClick={() => setSelected(c.call_uuid)}
                  className="text-xs text-brand hover:underline">{callLabel(c)}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
