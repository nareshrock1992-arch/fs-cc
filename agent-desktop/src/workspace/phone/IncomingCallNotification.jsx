import React, { useEffect, useRef } from 'react';
import { Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
import { Button } from '../../ui/primitives.jsx';
import { formatDuration, useElapsed, useSince } from '../format.js';

/**
 * IncomingCallNotification — a call ringing on THIS browser phone, shown at the top
 * of every page with Answer / Reject. Keyboard: focus starts on Answer (Enter or
 * Space answers); Tab reaches Reject. Escape does nothing, so a call is never
 * rejected by accident. Only real engine actions are used.
 *
 * @param {{ interaction: object|null, phone: object|null }} props
 */
export default function IncomingCallNotification({ interaction, phone }) {
  const ringingHere = Boolean(phone && interaction?.controllable && interaction.status === 'ringing');
  const answerRef = useRef(null);
  const since = useSince(ringingHere, interaction?.id);
  const ringFor = useElapsed(ringingHere ? (interaction?.startedAt || since) : null);

  useEffect(() => {
    if (ringingHere) answerRef.current?.focus();
  }, [ringingHere, interaction?.id]);

  if (!ringingHere) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="incoming-call-title"
      aria-describedby="incoming-call-detail"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-status-ringing/50 bg-panel-surface px-4 py-3"
    >
      <span className="w-9 h-9 rounded-full bg-status-ringing/15 text-status-ringing flex items-center justify-center shrink-0">
        <PhoneIncoming size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p id="incoming-call-title" className="text-sm font-semibold text-ink">
          Incoming call <span className="font-mono">{interaction.number || 'Unknown number'}</span>
        </p>
        <p id="incoming-call-detail" className="text-xs text-ink-dim truncate">
          {interaction.name || 'Caller name not available'}
          {interaction.queue ? ` · ${interaction.queue}` : ''}
          {' · ringing '}<span className="font-mono tabular-nums">{formatDuration(ringFor)}</span>
        </p>
      </div>
      <div className="flex gap-2">
        <Button ref={answerRef} variant="call" onClick={() => phone.answer()} aria-label="Answer call">
          <Phone size={15} /> Answer
        </Button>
        <Button variant="danger" onClick={() => phone.reject()} aria-label="Reject call">
          <PhoneOff size={15} /> Reject
        </Button>
      </div>
    </div>
  );
}
