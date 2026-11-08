import React from 'react';
import { Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, Mic, MicOff, Pause, Play, Grid3x3 } from 'lucide-react';
import { Badge, Button } from '../ui/primitives.jsx';
import { formatDuration, useElapsed, useSince } from './format.js';
import { STATE_LABEL } from './phone/PhoneParts.jsx';

/**
 * CallStrip — compact call bar shown on the Queues, Calls and Breaks pages so a call is
 * never hidden by navigation. Same real usePhone() actions as the console; "Keypad" opens
 * the Workspace page where the full console (DTMF keypad) lives.
 */
const TONE = {
  offering: 'warn', ringing: 'warn', dialing: 'warn', 'ringing-out': 'warn', connecting: 'warn',
  connected: 'ok', held: 'break', 'connected-elsewhere': 'busy', ended: 'neutral',
};

export default function CallStrip({ interaction, phone, onOpenPhone }) {
  const s = interaction.status;
  const controllable = Boolean(interaction.controllable && phone);
  const inCall = controllable && (s === 'connected' || s === 'held');
  const ringingHere = controllable && s === 'ringing';
  const progressing = controllable && ['dialing', 'ringing-out', 'connecting'].includes(s);
  const ringingNow = s === 'ringing' || s === 'offering';
  const since = useSince(ringingNow, interaction.id);
  const ringFor = useElapsed(ringingNow ? (interaction.startedAt || since) : null);
  const talkFor = useElapsed(s === 'connected' || s === 'held' ? (interaction.answeredAt || interaction.startedAt) : null);
  const Icon = interaction.direction === 'outbound' ? PhoneOutgoing : PhoneIncoming;

  return (
    <section
      aria-label="Current call"
      className={`flex flex-wrap items-center gap-3 rounded-lg border bg-panel-surface px-3 py-2
        ${ringingNow ? 'border-2 border-status-ringing' : 'border-panel-border'}`}
    >
      <span className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="font-mono font-semibold text-ink truncate" aria-label="Remote number">{interaction.number || 'Unknown number'}</span>
          <Badge tone={TONE[s] || 'neutral'}>{STATE_LABEL[s] || s}</Badge>
          {interaction.muted && <Badge tone="error">Muted</Badge>}
        </p>
        <p className="text-xs text-ink-dim truncate">
          {interaction.name || 'Caller name not available'}{interaction.queue ? ` · ${interaction.queue}` : ''}
        </p>
      </div>
      {(ringingNow || inCall) && (
        <span className="font-mono text-base text-ink tabular-nums" aria-label={inCall ? 'Call duration' : 'Ringing for'}>
          {formatDuration(inCall ? talkFor : ringFor)}
        </span>
      )}
      <div className="flex items-center gap-1.5" role="toolbar" aria-label="Call strip controls">
        {ringingHere && (
          <>
            <Button variant="call" onClick={() => phone.answer()}><Phone size={15} /> Answer</Button>
            <Button variant="danger" onClick={() => phone.reject()}><PhoneOff size={15} /> Reject</Button>
          </>
        )}
        {progressing && <Button variant="danger" onClick={() => phone.hangup()}><PhoneOff size={15} /> Cancel</Button>}
        {inCall && (
          <>
            <Button variant={interaction.muted ? 'toggled' : 'secondary'} aria-pressed={!!interaction.muted} onClick={() => phone.toggleMute()}>
              {interaction.muted ? <MicOff size={15} /> : <Mic size={15} />} {interaction.muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button variant={interaction.held ? 'toggled' : 'secondary'} aria-pressed={!!interaction.held} onClick={() => phone.toggleHold()}>
              {interaction.held ? <Play size={15} /> : <Pause size={15} />} {interaction.held ? 'Resume' : 'Hold'}
            </Button>
            <Button onClick={onOpenPhone} title="Open the phone keypad (DTMF)"><Grid3x3 size={15} /> Keypad</Button>
            <Button variant="danger" onClick={() => phone.hangup()}><PhoneOff size={15} /> End</Button>
          </>
        )}
        {!controllable && s !== 'ended' && (
          <span className="text-xs text-ink-dim">{s === 'offering' ? 'Waiting to ring here…' : 'On another device'}</span>
        )}
      </div>
    </section>
  );
}
