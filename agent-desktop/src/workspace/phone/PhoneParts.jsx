import React, { useState } from 'react';
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, CheckCircle2, Mic, Headphones, LogIn,
} from 'lucide-react';
import { Badge, Button, StatusDot } from '../../ui/primitives.jsx';
import { formatDuration } from '../format.js';

/** Building blocks of the phone console. Presentation only; actions come from props. */

export const STATE_LABEL = {
  offering: 'Offered by queue', ringing: 'Incoming call', dialing: 'Calling…', 'ringing-out': 'Ringing…',
  connecting: 'Connecting…', connected: 'Connected', held: 'On hold',
  'connected-elsewhere': 'Connected on another device', ended: 'Call ended',
};
const STATE_TONE = {
  offering: 'warn', ringing: 'warn', dialing: 'warn', 'ringing-out': 'warn', connecting: 'warn',
  connected: 'ok', held: 'break', 'connected-elsewhere': 'busy', ended: 'neutral',
};

export function PhoneStatusBar({ level, label, ext, action }) {
  return (
    <div className="flex items-center gap-2 px-4 h-12 border-b border-panel-border">
      <Phone size={15} className="text-ink-dim" aria-hidden="true" />
      <span className="text-[0.8125rem] font-semibold text-ink">Phone</span>
      <span className="flex items-center gap-1.5 ml-1.5 text-xs text-ink-dim min-w-0" role="status" aria-label="Phone status">
        <StatusDot level={level} /> <span className="truncate">{label}</span>
      </span>
      <span className="flex-1" />
      {ext && <span className="text-xs text-ink-dim shrink-0">Ext <span className="font-mono text-ink">{ext}</span></span>}
      {action}
    </div>
  );
}

/** Password-only sign-in. The value is kept only until submit, then cleared (memory only). */
export function PhoneSignIn({ extension, onSignIn }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const typed = password;
    setPassword('');
    setError(null);
    setBusy(true);
    try {
      const r = await onSignIn(typed);
      if (!r?.ok) setError(r?.error || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} aria-label="Phone sign in" className="px-4 py-3 space-y-2 border-b border-panel-border bg-status-ringing/5">
      <p className="text-xs text-ink">Sign in to extension <span className="font-mono font-semibold">{extension}</span> to take and make calls.</p>
      <div className="flex gap-2">
        <input
          type="password" autoComplete="off" aria-label="SIP password" placeholder="SIP password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="flex-1 min-w-0 h-9 px-2.5 rounded-md border border-panel-border bg-panel-surface text-sm text-ink focus:outline-none focus:border-primary"
        />
        <Button type="submit" variant="primary" disabled={busy || password.length === 0}><LogIn size={14} /> Sign in</Button>
      </div>
      {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
    </form>
  );
}

export function CallDisplay({ interaction, timer }) {
  const s = interaction.status;
  const Icon = interaction.direction === 'outbound' ? PhoneOutgoing : PhoneIncoming;
  const live = s === 'connected' || s === 'held';
  const ringing = s === 'ringing' || s === 'offering';
  return (
    <div className="text-center space-y-1">
      <Badge tone={STATE_TONE[s] || 'neutral'}>
        <Icon size={11} aria-hidden="true" /> {STATE_LABEL[s] || s}
      </Badge>
      <p className="font-mono text-[1.75rem] leading-9 font-semibold text-ink truncate" aria-label="Remote number">
        {interaction.number || 'Unknown number'}
      </p>
      <p className="text-xs text-ink-dim truncate">
        {interaction.name || 'Caller name not available'}{interaction.queue ? ` · ${interaction.queue}` : ''}
      </p>
      {(live || ringing) && (
        <p className="font-mono text-lg text-ink tabular-nums" aria-label={live ? 'Call duration' : 'Ringing for'}>
          {formatDuration(timer)}
          <span className="ml-1.5 text-[0.6875rem] font-sans text-ink-faint">{live ? 'duration' : 'ringing'}</span>
        </p>
      )}
    </div>
  );
}

export function LastCallLine({ interaction }) {
  const failed = !interaction.answeredAt;
  return (
    <p aria-label="Last call" className={`mb-1 flex items-center justify-center gap-1.5 text-xs ${failed ? 'text-status-error' : 'text-ink-dim'}`}>
      {failed ? <PhoneMissed size={13} /> : <CheckCircle2 size={13} />}
      <span>{failed ? 'Not connected' : 'Call ended'} · <span className="font-mono">{interaction.number}</span> · {interaction.endReason || 'Call ended'}</span>
    </p>
  );
}

/** 56-px control tile. When `unavailable` is set it is disabled and says why. */
export function ControlTile({ label, icon: Icon, pressed = false, disabled = false, unavailable, onClick }) {
  const why = unavailable ? `${label} is not available yet` : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !!unavailable}
      aria-pressed={pressed}
      aria-label={unavailable ? `${label} (not available yet)` : label}
      title={why || label}
      className={`h-14 rounded-lg border flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40 disabled:cursor-not-allowed
        ${pressed ? 'border-primary bg-primary/10 text-primary' : 'border-panel-border bg-panel-surface text-ink hover:bg-panel-raised'}`}
    >
      <Icon size={18} aria-hidden="true" />
      {label}
    </button>
  );
}

/** Microphone and speaker in use, with selectors (existing engine device APIs). */
export function AudioDevices({ devices, onSelectInput, onSelectOutput }) {
  const name = (d, i, kind) => d.label || `${kind} ${i + 1}`;
  const select = 'flex-1 min-w-0 h-8 px-2 rounded-md border border-panel-border bg-panel-surface text-xs text-ink focus:outline-none focus:border-primary disabled:bg-panel-raised disabled:text-ink-dim';
  const noLabels = devices.inputs.length > 0 && devices.inputs.every((d) => !d.label);
  return (
    <div className="px-4 py-3 border-t border-panel-border space-y-2" aria-label="Audio devices">
      <label className="flex items-center gap-2 text-xs">
        <Mic size={14} className="text-ink-dim shrink-0" aria-hidden="true" />
        <span className="sr-only">Microphone</span>
        <select aria-label="Microphone" className={select} value={devices.selectedInput} onChange={(e) => onSelectInput(e.target.value)}>
          <option value="">Default microphone</option>
          {devices.inputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{name(d, i, 'Microphone')}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <Headphones size={14} className="text-ink-dim shrink-0" aria-hidden="true" />
        <span className="sr-only">Speaker</span>
        <select aria-label="Speaker" className={select} value={devices.selectedOutput} disabled={!devices.sinkSupported}
          title={devices.sinkSupported ? undefined : 'This browser cannot choose the speaker; the system default is used.'}
          onChange={(e) => onSelectOutput(e.target.value)}>
          <option value="">{devices.sinkSupported ? 'Default speaker' : 'System default speaker'}</option>
          {devices.outputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{name(d, i, 'Speaker')}</option>)}
        </select>
      </label>
      {noLabels && <p className="text-[0.6875rem] text-ink-faint">Device names appear after the browser is allowed to use the microphone.</p>}
    </div>
  );
}
