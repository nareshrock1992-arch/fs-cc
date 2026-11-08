import React, { useEffect, useState } from 'react'; // React in scope: works with classic and automatic JSX
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, Mic, MicOff, Volume2, Pause, Play, Grid3x3, Settings2,
} from 'lucide-react';
import { PhoneProvider } from '../PhoneProvider';
import { usePhone } from '../usePhone';

/**
 * SoftphonePanel — browser phone for the Agent Desktop.
 *
 * CP-5: sign-in, answer/reject, mute, hang up.
 * Step 1 (telephony controls): dial pad + Call, hold/resume, in-call DTMF keypad,
 * call timer, remote number display, microphone and speaker selection.
 * All actions use existing engine APIs (usePhone); no engine, backend or FreeSWITCH changes.
 *
 * Loaded lazily by Dashboard.jsx only when VITE_WEBRTC_ENABLED === 'true'.
 * The agent types ONLY the SIP password. It lives in this component's state until
 * submit, is then handed to the engine (memory only), and the field is cleared.
 * Nothing is written to localStorage/sessionStorage/IndexedDB.
 * This panel never changes the agent's FS-CC status.
 */
export default function SoftphonePanel({ agent }) {
  return (
    <PhoneProvider agent={agent}>
      <SoftphoneCard />
    </PhoneProvider>
  );
}

const LAMP = {
  off: 'bg-ink-faint',
  ok: 'bg-lamp-available',
  busy: 'bg-lamp-break',
  warn: 'bg-lamp-break',
  error: 'bg-lamp-alert',
};

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
const BTN_PRIMARY = `${BTN} bg-brand text-white disabled:opacity-50`;
const BTN_PLAIN = `${BTN} border border-panel-border text-ink-dim hover:bg-panel-raised disabled:opacity-50`;
const BTN_ON = `${BTN} border border-brand text-brand bg-brand/10`;
const BTN_DANGER = `${BTN} bg-lamp-alert/15 text-lamp-alert border border-lamp-alert/30`;
const INPUT = 'px-3 py-1.5 rounded-lg bg-panel-raised border border-panel-border text-sm text-ink';

export const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const DIAL_CHARS = /[^0-9*#+]/g;

const STATUS_LABEL = {
  dialing: 'Calling…',
  'ringing-out': 'Ringing…',
  'ringing-in': 'Incoming call',
  connecting: 'Connecting…',
  active: 'Connected',
};

/** mm:ss, or h:mm:ss after an hour. */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** "sip:1001@192.168.1.124" or "\"Name\" <sip:1001@...>" -> "1001". Plain numbers pass through. */
export function displayNumber(identity) {
  if (!identity) return 'Unknown';
  const match = String(identity).match(/sips?:([^@;>]+)/i);
  return match ? match[1] : String(identity);
}

function CallTimer({ answeredAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!answeredAt) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [answeredAt]);
  if (!answeredAt) return null;
  return (
    <span className="font-mono text-sm text-ink tabular-nums" aria-label="Call duration">
      {formatDuration((now - answeredAt) / 1000)}
    </span>
  );
}

function Keypad({ onKey, label }) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={label}>
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`${BTN_PLAIN} justify-center py-2 text-base font-mono`}
          onClick={() => onKey(k)}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

function DialPad({ phone }) {
  const [number, setNumber] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const clean = number.replace(DIAL_CHARS, '');

  async function handleCall(e) {
    e.preventDefault();
    if (!clean) return;
    phone.clearError();
    await phone.dial(clean);
    setNumber('');
  }

  return (
    <form onSubmit={handleCall} className="space-y-2" aria-label="Dial pad">
      <div className="flex items-center gap-2">
        <input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          aria-label="Number to call"
          placeholder="Number or extension"
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(DIAL_CHARS, ''))}
          className={`${INPUT} flex-1 font-mono`}
        />
        <button
          type="button"
          className={showKeys ? BTN_ON : BTN_PLAIN}
          aria-pressed={showKeys}
          aria-label="Show keypad"
          onClick={() => setShowKeys((v) => !v)}
        >
          <Grid3x3 size={14} />
        </button>
        <button type="submit" className={BTN_PRIMARY} disabled={!clean}>
          <PhoneOutgoing size={14} /> Call
        </button>
      </div>
      {showKeys && (
        <>
          <Keypad label="Dial keypad" onKey={(k) => setNumber((n) => n + k)} />
          <div className="flex justify-end">
            <button type="button" className={BTN_PLAIN} disabled={!number} onClick={() => setNumber((n) => n.slice(0, -1))}>
              Delete
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function DeviceSettings({ phone, devices }) {
  const [open, setOpen] = useState(false);
  if (!devices) return null;
  const toggle = () => {
    if (!open) phone.refreshDevices();
    setOpen((v) => !v);
  };
  const name = (d, i, kind) => d.label || `${kind} ${i + 1}`;
  return (
    <div className="space-y-2">
      <button type="button" className={open ? BTN_ON : BTN_PLAIN} aria-expanded={open} onClick={toggle}>
        <Settings2 size={14} /> Audio devices
      </button>
      {open && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink-dim space-y-1">
            <span className="block">Microphone / headset</span>
            <select
              aria-label="Microphone"
              className={`${INPUT} w-full`}
              value={devices.selectedInput}
              onChange={(e) => phone.selectInput(e.target.value)}
            >
              <option value="">System default</option>
              {devices.inputs.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{name(d, i, 'Microphone')}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-dim space-y-1">
            <span className="block">Speaker / headset</span>
            <select
              aria-label="Speaker"
              className={`${INPUT} w-full`}
              value={devices.selectedOutput}
              disabled={!devices.sinkSupported}
              onChange={(e) => phone.selectOutput(e.target.value)}
            >
              <option value="">System default</option>
              {devices.outputs.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{name(d, i, 'Speaker')}</option>
              ))}
            </select>
            {!devices.sinkSupported && (
              <span className="block text-ink-faint">This browser can't choose the speaker; it uses the system default.</span>
            )}
          </label>
        </div>
      )}
    </div>
  );
}

function ActiveCall({ phone, call }) {
  const [showKeys, setShowKeys] = useState(false);
  const [sent, setSent] = useState('');
  const isActive = call.status === 'active';
  const ringingOut = call.status === 'dialing' || call.status === 'ringing-out' || call.status === 'connecting';
  const Icon = call.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing;

  function tone(k) {
    phone.sendDtmf(k);
    setSent((s) => (s + k).slice(-20));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink font-mono flex items-center gap-1.5 truncate" aria-label="Remote number">
            <Icon size={15} /> {displayNumber(call.remoteIdentity)}
          </p>
          <p className="text-xs text-ink-dim">
            {call.direction === 'inbound' ? 'Incoming' : 'Outgoing'} · {call.held ? 'On hold' : STATUS_LABEL[call.status] || call.status}
            {call.muted && ' · Muted'}
          </p>
        </div>
        {isActive && <CallTimer answeredAt={call.answeredAt} />}
      </div>

      {call.status === 'ringing-in' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_PRIMARY} onClick={() => phone.answer()}>
            Answer
          </button>
          <button type="button" className={BTN_DANGER} onClick={() => phone.reject()}>
            Reject
          </button>
        </div>
      )}

      {ringingOut && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_DANGER} onClick={() => phone.hangup()}>
            <PhoneOff size={14} /> Cancel
          </button>
        </div>
      )}

      {isActive && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={call.muted ? BTN_ON : BTN_PLAIN} aria-pressed={call.muted} onClick={() => phone.toggleMute()}>
              {call.muted ? <MicOff size={14} /> : <Mic size={14} />}
              {call.muted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" className={call.held ? BTN_ON : BTN_PLAIN} aria-pressed={call.held} onClick={() => phone.toggleHold()}>
              {call.held ? <Play size={14} /> : <Pause size={14} />}
              {call.held ? 'Resume' : 'Hold'}
            </button>
            <button type="button" className={showKeys ? BTN_ON : BTN_PLAIN} aria-pressed={showKeys} onClick={() => setShowKeys((v) => !v)}>
              <Grid3x3 size={14} /> Keypad
            </button>
            <button type="button" className={BTN_DANGER} onClick={() => phone.hangup()}>
              <PhoneOff size={14} /> Hang up
            </button>
          </div>
          {showKeys && (
            <div className="space-y-1.5">
              <p className="text-xs text-ink-dim font-mono min-h-[1rem]" aria-label="Tones sent">{sent}</p>
              <Keypad label="In-call keypad" onKey={tone} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SoftphoneCard() {
  const phone = usePhone();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  const { state, indicator, eligibility, configError } = phone;
  const call = state?.call && state.call.status !== 'ended' ? state.call : null;
  const signedIn = Boolean(state?.account);
  const registered = state?.registration === 'registered';

  async function handleSignIn(e) {
    e.preventDefault();
    const typed = password;
    setPassword(''); // never keep the password in component state longer than needed
    setLocalError(null);
    setBusy(true);
    try {
      const result = await phone.login(typed);
      if (!result.ok) setLocalError(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4 space-y-4" aria-label="Browser phone">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-dim flex items-center gap-2">
          <Phone size={15} /> Browser phone
        </h2>
        <span className="flex items-center gap-2 text-[0.6875rem] font-medium text-ink-dim" role="status">
          <span className={`w-2 h-2 rounded-full ${LAMP[indicator.level]}`} />
          {indicator.label}
        </span>
      </div>

      {configError && <p className="text-sm text-lamp-alert">{configError}</p>}
      {!configError && !eligibility.eligible && (
        <p className="text-sm text-ink-faint">{eligibility.reason}</p>
      )}

      {!configError && eligibility.eligible && !signedIn && (
        <form onSubmit={handleSignIn} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-dim">
            Extension <code className="text-ink">{eligibility.extension}</code>
          </span>
          <input
            type="password"
            autoComplete="off"
            aria-label="SIP password"
            placeholder="SIP password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`flex-1 ${INPUT}`}
          />
          <button type="submit" className={BTN_PRIMARY} disabled={busy || password.length === 0}>
            Sign in
          </button>
        </form>
      )}

      {signedIn && !call && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-dim">
              Extension <code className="text-ink">{state.account.extension}</code>
            </span>
            <button type="button" className={BTN_PLAIN} onClick={() => phone.logout()}>
              Sign out
            </button>
          </div>
          {registered && <DialPad phone={phone} />}
        </>
      )}

      {call && <ActiveCall phone={phone} call={call} />}

      {signedIn && <DeviceSettings phone={phone} devices={state.devices} />}

      {state?.notice && (
        <div className="flex items-center justify-between gap-2 text-sm text-ink-dim">
          <span>{state.notice}</span>
          <button type="button" className={BTN_PLAIN} onClick={() => phone.unlockAudio()}>
            <Volume2 size={14} /> Enable audio
          </button>
        </div>
      )}

      {(localError || state?.error) && (
        <p role="alert" className="text-sm text-lamp-alert">{localError || state.error}</p>
      )}
    </section>
  );
}
