import React, { useState } from 'react'; // React in scope: works with classic and automatic JSX
import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Volume2 } from 'lucide-react';
import { PhoneProvider } from '../PhoneProvider';
import { usePhone } from '../usePhone';

/**
 * SoftphonePanel — minimal browser phone for the Agent Desktop (Phase 2, CP-5).
 *
 * Loaded lazily by Dashboard.jsx only when VITE_WEBRTC_ENABLED === 'true'.
 * The agent types ONLY the SIP password. It lives in this component's state until
 * submit, is then handed to the engine (memory only), and the field is cleared.
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
const BTN_PLAIN = `${BTN} border border-panel-border text-ink-dim hover:bg-panel-raised`;
const BTN_DANGER = `${BTN} bg-lamp-alert/15 text-lamp-alert border border-lamp-alert/30`;

export function SoftphoneCard() {
  const phone = usePhone();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  const { state, indicator, eligibility, configError } = phone;
  const call = state?.call && state.call.status !== 'ended' ? state.call : null;
  const signedIn = Boolean(state?.account);

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
            className="flex-1 px-3 py-1.5 rounded-lg bg-panel-raised border border-panel-border text-sm text-ink"
          />
          <button type="submit" className={BTN_PRIMARY} disabled={busy || password.length === 0}>
            Sign in
          </button>
        </form>
      )}

      {signedIn && !call && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-ink-dim">
            Extension <code className="text-ink">{state.account.extension}</code>
          </span>
          <button type="button" className={BTN_PLAIN} onClick={() => phone.logout()}>
            Sign out
          </button>
        </div>
      )}

      {call && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink flex-1 flex items-center gap-1.5">
            {call.status === 'ringing-in' && <PhoneIncoming size={15} />}
            {call.remoteIdentity} · {call.status}
          </span>
          {call.status === 'ringing-in' ? (
            <>
              <button type="button" className={BTN_PRIMARY} onClick={() => phone.answer()}>
                Answer
              </button>
              <button type="button" className={BTN_DANGER} onClick={() => phone.reject()}>
                Reject
              </button>
            </>
          ) : (
            <>
              <button type="button" className={BTN_PLAIN} onClick={() => phone.toggleMute()}>
                {call.muted ? <MicOff size={14} /> : <Mic size={14} />}
                {call.muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" className={BTN_DANGER} onClick={() => phone.hangup()}>
                <PhoneOff size={14} /> Hang up
              </button>
            </>
          )}
        </div>
      )}

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
