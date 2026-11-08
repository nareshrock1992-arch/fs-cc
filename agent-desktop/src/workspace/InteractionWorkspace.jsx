import React, { useState } from 'react';
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneOff, PhoneMissed, Mic, MicOff, Pause, Play, Grid3x3,
  ArrowRightLeft, Users, AlertTriangle, Headset, CheckCircle2,
} from 'lucide-react';
import { Badge, Button } from '../ui/primitives.jsx';
import Keypad from './Keypad.jsx';
import Dialer from './Dialer.jsx';
import { formatDuration, useElapsed, useSince } from './format.js';

/**
 * InteractionWorkspace — the centre of the Agent Desktop.
 * Exactly one interaction view (from interactions/correlate.js), never two cards for one call.
 *   idle → dialer + readiness;  ringing/offering → incoming;  dialing…connected/held → active;
 *   ended → termination summary (kept by the engine for a few seconds).
 * Every control calls a real usePhone() action; Transfer/Conference are visibly unavailable.
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

/**
 * `summary` (Workspace page next to the PhoneConsole): the console owns dialing and the
 * in-call controls, so this view shows details only — idle shows recent numbers that load
 * into the console (`onPickNumber`), active shows the call header without controls.
 */
export default function InteractionWorkspace({ result, phone, agentStatus, recentNumbers, summary = false, onPickNumber }) {
  const { interaction, warning, queueCall } = result;
  return (
    <div className="space-y-3">
      {warning && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-status-ringing/40 bg-status-ringing/10 px-3 py-2 text-xs text-ink">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-status-ringing" /> {warning}
        </div>
      )}
      {queueCall && <QueueCallStrip call={queueCall} />}

      {!interaction && <IdleView phone={phone} agentStatus={agentStatus} recentNumbers={recentNumbers} summary={summary} onPickNumber={onPickNumber} />}
      {interaction && (interaction.status === 'ringing' || interaction.status === 'offering') && (
        <IncomingView interaction={interaction} phone={phone} />
      )}
      {interaction && interaction.status === 'ended' && <EndedView interaction={interaction} />}
      {interaction && !['ringing', 'offering', 'ended'].includes(interaction.status) && (
        <ActiveView interaction={interaction} phone={phone} summary={summary} />
      )}
    </div>
  );
}

// ── Idle ────────────────────────────────────────────────────────────────────

function IdleView({ phone, agentStatus, recentNumbers, summary, onPickNumber }) {
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
      {summary ? (
        <div className="p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint mb-2">Recent numbers</p>
          {recentNumbers.length === 0 ? (
            <p className="text-xs text-ink-dim">No recent calls yet.</p>
          ) : (
            <ul className="divide-y divide-panel-border" aria-label="Recent numbers">
              {recentNumbers.map((n) => (
                <li key={n}>
                  <button type="button" onClick={() => onPickNumber?.(n)}
                    className="w-full flex items-center justify-between gap-2 py-2 text-left text-sm hover:bg-panel-raised rounded px-1">
                    <span className="font-mono text-ink">{n}</span>
                    <span className="text-[0.6875rem] text-primary">Load into phone</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-faint mb-2">Make a call</p>
          <Dialer phone={phone} recentNumbers={recentNumbers} />
        </div>
      )}
    </section>
  );
}

// ── Header shared by incoming/active/ended ─────────────────────────────────

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
          <p className="text-lg font-semibold text-ink font-mono truncate" aria-label="Remote number">
            {interaction.number || 'Unknown number'}
          </p>
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

// ── Incoming ───────────────────────────────────────────────────────────────

function IncomingView({ interaction, phone }) {
  const since = useSince(true, interaction.id);
  const ringing = useElapsed(interaction.startedAt || since);
  const canAnswer = interaction.controllable && interaction.status === 'ringing' && phone;
  return (
    <section
      aria-label="Incoming call"
      className="rounded-lg border-2 border-status-ringing bg-panel-surface p-4 space-y-4"
    >
      <CallHeader interaction={interaction} timer={ringing} timerLabel="Ringing for" />
      {canAnswer ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="call" size="lg" onClick={() => phone.answer()} className="min-w-[8rem]">
            <Phone size={16} /> Answer
          </Button>
          <Button variant="danger" size="lg" onClick={() => phone.reject()} className="min-w-[8rem]">
            <PhoneOff size={16} /> Reject
          </Button>
        </div>
      ) : (
        <p className="text-xs text-ink-dim">Answer on the device that is ringing.</p>
      )}
    </section>
  );
}

// ── Active (dialing → connected / held) ────────────────────────────────────

function ActiveView({ interaction, phone, summary }) {
  const [keypad, setKeypad] = useState(false);
  const [sent, setSent] = useState('');
  const connected = interaction.status === 'connected' || interaction.status === 'held';
  const progressing = ['dialing', 'ringing-out', 'connecting'].includes(interaction.status);
  const talk = useElapsed(connected ? interaction.answeredAt || interaction.startedAt : null);
  const controls = interaction.controllable && phone && !summary;

  function tone(k) {
    phone.sendDtmf(k);
    setSent((s) => (s + k).slice(-24));
  }

  return (
    <section aria-label="Active call" className="rounded-lg border border-panel-border bg-panel-surface">
      <div className="p-4 border-b border-panel-border">
        <CallHeader interaction={interaction} timer={connected ? talk : null} timerLabel="Call duration" />
      </div>

      {controls && progressing && (
        <div className="p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-ink-dim">
            {interaction.status === 'connecting' ? 'Connecting audio…' : `Calling ${interaction.number}…`}
          </p>
          <Button variant="danger" onClick={() => phone.hangup()}><PhoneOff size={15} /> Cancel</Button>
        </div>
      )}

      {controls && connected && (
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Call controls">
            <Button variant={interaction.muted ? 'toggled' : 'secondary'} aria-pressed={!!interaction.muted} onClick={() => phone.toggleMute()}>
              {interaction.muted ? <MicOff size={15} /> : <Mic size={15} />} {interaction.muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button variant={interaction.held ? 'toggled' : 'secondary'} aria-pressed={!!interaction.held} onClick={() => phone.toggleHold()}>
              {interaction.held ? <Play size={15} /> : <Pause size={15} />} {interaction.held ? 'Resume' : 'Hold'}
            </Button>
            <Button variant={keypad ? 'toggled' : 'secondary'} aria-pressed={keypad} onClick={() => setKeypad((v) => !v)}>
              <Grid3x3 size={15} /> Keypad
            </Button>
            <Button disabled title="Transfer is not available yet" aria-label="Transfer (not available yet)">
              <ArrowRightLeft size={15} /> Transfer
            </Button>
            <Button disabled title="Conference is not available yet" aria-label="Conference (not available yet)">
              <Users size={15} /> Conference
            </Button>
            <div className="flex-1" />
            <Button variant="danger" onClick={() => phone.hangup()} className="min-w-[7rem]">
              <PhoneOff size={15} /> End call
            </Button>
          </div>
          {keypad && (
            <div className="flex items-start gap-4">
              <Keypad label="In-call keypad" onKey={tone} />
              <div className="text-xs text-ink-dim">
                <p className="font-semibold text-ink-faint uppercase tracking-wide text-[0.6875rem]">Tones sent</p>
                <p className="font-mono text-sm text-ink min-h-[1.25rem]" aria-label="Tones sent">{sent}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {!controls && !summary && (
        <p className="p-4 text-xs text-ink-dim">Call controls are available on the device handling this call.</p>
      )}
    </section>
  );
}

// ── Ended ──────────────────────────────────────────────────────────────────

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

// ── Unlinked queue call (shown next to a browser call) ─────────────────────

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
