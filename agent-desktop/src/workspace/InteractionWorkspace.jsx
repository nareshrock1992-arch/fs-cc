import React from 'react';
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneOff, PhoneMissed, AlertTriangle, Headset, CheckCircle2,
} from 'lucide-react';
import { Badge, Button } from '../ui/primitives.jsx';
import RecentCalls from './RecentCalls.jsx';
import { formatDuration, useElapsed, useSince } from './format.js';

/**
 * InteractionWorkspace — call details beside the PhoneConsole on the Workspace page.
 * Exactly one interaction view (interactions/correlate.js), never two cards for one call.
 *   idle      → readiness + this agent's recent calls (click loads the number into the phone)
 *   incoming  → prominent card: number, name, queue, ringing timer, Answer / Reject
 *   active    → call summary (state, type, queue, duration); controls live in the console
 *   ended     → result + reason
 * Plus a correlation warning and an unlinked queue-call strip when they apply.
 */

const STATUS = {
  offering:              { label: 'Offered by queue', tone: 'warn' },
  ringing:               { label: 'Ringing', tone: 'warn' },
  dialing:               { label: 'Calling…', tone: 'warn' },
  'ringing-out':         { label: 'Ringing…', tone: 'warn' },
  connecting:            { label: 'Connecting…', tone: 'warn' },
  connected:             { label: 'Connected', tone: 'ok' },
  held:                  { label: 'On hold', tone: 'break' },
  'connected-elsewhere': { label: 'Connected (other device)', tone: 'busy' },
  ended:                 { label: 'Call ended', tone: 'neutral' },
};
const KIND = { queue: 'Queue call', direct: 'Direct call', outbound: 'Outbound call' };

export default function InteractionWorkspace({ result, phone, agentStatus, recentCalls = [], recentLoading = false, onPickNumber }) {
  const { interaction, warning, queueCall } = result;
  const s = interaction?.status;
  return (
    <div className="space-y-3">
      {warning && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-status-ringing/40 bg-status-ringing/10 px-3 py-2 text-xs text-ink">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-status-ringing" /> {warning}
        </div>
      )}
      {queueCall && <QueueCallStrip call={queueCall} />}

      {!interaction && <IdleView agentStatus={agentStatus} recentCalls={recentCalls} recentLoading={recentLoading} onPickNumber={onPickNumber} />}
      {interaction && (s === 'ringing' || s === 'offering') && <IncomingView interaction={interaction} phone={phone} />}
      {interaction && s === 'ended' && <EndedView interaction={interaction} />}
      {interaction && !['ringing', 'offering', 'ended'].includes(s) && <ActiveView interaction={interaction} />}
    </div>
  );
}

function IdleView({ agentStatus, recentCalls, recentLoading, onPickNumber }) {
  const ready = agentStatus === 'Available';
  return (
    <section aria-label="Workspace idle" className="rounded-lg border border-panel-border bg-panel-surface">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-panel-border">
        <span className={`w-9 h-9 rounded-md flex items-center justify-center ${ready ? 'bg-status-available/10 text-status-available' : 'bg-panel-raised text-ink-dim'}`}>
          <Headset size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{ready ? 'Waiting for the next interaction' : `You are ${agentStatus}`}</p>
          <p className="text-xs text-ink-dim">
            {ready ? 'Queue calls will appear here when they are offered to you.' : 'You will not receive queue calls until you are Available.'}
          </p>
        </div>
      </div>
      <div className="p-4">
        <RecentCalls calls={recentCalls} loading={recentLoading} onPick={onPickNumber} />
      </div>
    </section>
  );
}

function CallHeader({ interaction, timer, timerLabel }) {
  const st = STATUS[interaction.status] || { label: interaction.status, tone: 'neutral' };
  const Icon = interaction.direction === 'outbound' ? PhoneOutgoing : PhoneIncoming;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink font-mono truncate" aria-label="Call number">{interaction.number || 'Unknown number'}</p>
          <p className="text-sm text-ink-dim truncate">{interaction.name || 'Caller name not available'}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge>{KIND[interaction.kind] || 'Call'}</Badge>
            {interaction.queue && <Badge tone="busy">Queue · {interaction.queue}</Badge>}
            {interaction.muted && <Badge tone="error">Muted</Badge>}
          </div>
        </div>
      </div>
      {timer != null && (
        <div className="text-right shrink-0">
          <p className="font-mono text-xl text-ink tabular-nums" aria-label={timerLabel}>{formatDuration(timer)}</p>
          <p className="text-[0.6875rem] text-ink-faint">{timerLabel}</p>
        </div>
      )}
    </div>
  );
}

function IncomingView({ interaction, phone }) {
  const since = useSince(true, interaction.id);
  const ringing = useElapsed(interaction.startedAt || since);
  const canAnswer = interaction.controllable && interaction.status === 'ringing' && phone;
  return (
    <section aria-label="Incoming call" className="rounded-lg border-2 border-status-ringing bg-panel-surface p-4 space-y-4">
      <CallHeader interaction={interaction} timer={ringing} timerLabel="Ringing for" />
      {canAnswer ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="call" size="lg" onClick={() => phone.answer()} className="min-w-[8rem]"><Phone size={16} /> Answer</Button>
          <Button variant="danger" size="lg" onClick={() => phone.reject()} className="min-w-[8rem]"><PhoneOff size={16} /> Reject</Button>
        </div>
      ) : (
        <p className="text-xs text-ink-dim">
          {interaction.status === 'offering' ? 'Waiting for the call to ring in the browser phone…' : 'Answer on the device that is ringing.'}
        </p>
      )}
    </section>
  );
}

function ActiveView({ interaction }) {
  const connected = interaction.status === 'connected' || interaction.status === 'held';
  const talk = useElapsed(connected ? interaction.answeredAt || interaction.startedAt : null);
  return (
    <section aria-label="Active call" className="rounded-lg border border-panel-border bg-panel-surface p-4 space-y-2">
      <CallHeader interaction={interaction} timer={connected ? talk : null} timerLabel="Call duration" />
      <p className="text-xs text-ink-dim">
        {interaction.controllable
          ? 'Use the phone on the left for mute, hold, keypad tones and ending the call.'
          : 'Call controls are available on the device handling this call.'}
      </p>
    </section>
  );
}

function EndedView({ interaction }) {
  const talked = interaction.answeredAt ? (Date.now() - interaction.answeredAt) / 1000 : null;
  const failed = !interaction.answeredAt;
  return (
    <section aria-label="Call ended" className="rounded-lg border border-panel-border bg-panel-surface p-4 flex items-center gap-3">
      <span className={`w-9 h-9 rounded-md flex items-center justify-center ${failed ? 'bg-status-error/10 text-status-error' : 'bg-panel-raised text-ink-dim'}`}>
        {failed ? <PhoneMissed size={18} /> : <CheckCircle2 size={18} />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">
          {failed ? 'Call not connected' : 'Call ended'} · <span className="font-mono">{interaction.number}</span>
        </p>
        <p className="text-xs text-ink-dim">
          {interaction.endReason || 'Call ended'}{talked != null ? ` · ${formatDuration(talked)}` : ''}
        </p>
      </div>
    </section>
  );
}

function QueueCallStrip({ call }) {
  return (
    <div aria-label="Queue call" className="flex flex-wrap items-center gap-2 rounded-md border border-panel-border bg-panel-surface px-3 py-2 text-xs">
      <Badge tone="busy">Queue call</Badge>
      <span className="font-mono text-ink">{call.number || 'Unknown number'}</span>
      {call.name && <span className="text-ink-dim">{call.name}</span>}
      {call.queue && <span className="text-ink-dim">· {call.queue}</span>}
    </div>
  );
}
