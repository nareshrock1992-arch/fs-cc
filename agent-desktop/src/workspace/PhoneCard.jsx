import React, { useState } from 'react';
import { Phone, Settings2, Volume2, LogIn, LogOut } from 'lucide-react';
import { Button, IconButton, StatusDot } from '../ui/primitives.jsx';

/**
 * PhoneCard — browser phone registration, sign-in and audio devices (context panel).
 * The SIP password is typed here only: it is held in this component's state until submit,
 * handed to the engine (memory only) and cleared. Never stored in browser storage.
 */
export default function PhoneCard({ phone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [devicesOpen, setDevicesOpen] = useState(false);

  if (!phone) return null;
  const { state, indicator, eligibility, configError } = phone;
  const signedIn = Boolean(state?.account);
  const devices = state?.devices;

  async function signIn(e) {
    e.preventDefault();
    const typed = password;
    setPassword('');
    setError(null);
    setBusy(true);
    try {
      const r = await phone.login(typed);
      if (!r.ok) setError(r.error);
    } finally {
      setBusy(false);
    }
  }

  const toggleDevices = () => {
    if (!devicesOpen) phone.refreshDevices();
    setDevicesOpen((v) => !v);
  };
  const name = (d, i, kind) => d.label || `${kind} ${i + 1}`;
  const select = 'w-full h-9 px-2 rounded-md border border-panel-border bg-panel-surface text-sm text-ink focus:outline-none focus:border-primary disabled:bg-panel-raised';

  return (
    <section aria-label="Browser phone" className="p-4 space-y-3 border-b border-panel-border">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
          <Phone size={15} className="text-ink-dim" /> Browser phone
        </h2>
        {signedIn && (
          <IconButton label="Audio devices" variant={devicesOpen ? 'toggled' : 'ghost'} aria-expanded={devicesOpen} className="h-8 w-8" onClick={toggleDevices}>
            <Settings2 size={15} />
          </IconButton>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm" role="status">
        <StatusDot level={configError || !eligibility.eligible ? 'off' : indicator.level} />
        <span className="text-ink">{configError ? 'Not configured' : !eligibility.eligible ? 'Not available' : indicator.label}</span>
        {(signedIn || eligibility.extension) && (
          <span className="ml-auto text-xs text-ink-dim">Ext <span className="font-mono text-ink">{state?.account?.extension || eligibility.extension}</span></span>
        )}
      </div>

      {configError && <p className="text-xs text-status-error">{configError}</p>}
      {!configError && !eligibility.eligible && <p className="text-xs text-ink-dim">{eligibility.reason}</p>}

      {!configError && eligibility.eligible && !signedIn && (
        <form onSubmit={signIn} className="flex items-center gap-2">
          <input
            type="password"
            autoComplete="off"
            aria-label="SIP password"
            placeholder="SIP password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="flex-1 min-w-0 h-9 px-2.5 rounded-md border border-panel-border bg-panel-surface text-sm text-ink focus:outline-none focus:border-primary"
          />
          <Button type="submit" variant="primary" disabled={busy || password.length === 0}>
            <LogIn size={14} /> Sign in
          </Button>
        </form>
      )}

      {signedIn && devicesOpen && devices && (
        <div className="space-y-2">
          <label className="block text-xs text-ink-dim space-y-1">
            <span>Microphone / headset</span>
            <select aria-label="Microphone" className={select} value={devices.selectedInput} onChange={(e) => phone.selectInput(e.target.value)}>
              <option value="">System default</option>
              {devices.inputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{name(d, i, 'Microphone')}</option>)}
            </select>
          </label>
          <label className="block text-xs text-ink-dim space-y-1">
            <span>Speaker / headset (calls and ringing)</span>
            <select aria-label="Speaker" className={select} value={devices.selectedOutput} disabled={!devices.sinkSupported} onChange={(e) => phone.selectOutput(e.target.value)}>
              <option value="">System default</option>
              {devices.outputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{name(d, i, 'Speaker')}</option>)}
            </select>
          </label>
          {!devices.sinkSupported && <p className="text-[0.6875rem] text-ink-faint">This browser can't choose the speaker; the system default is used.</p>}
          {devices.inputs.length > 0 && devices.inputs.every((d) => !d.label) && (
            <p className="text-[0.6875rem] text-ink-faint">Device names appear after the browser is allowed to use the microphone (first call).</p>
          )}
        </div>
      )}

      {state?.notice && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-status-ringing/10 px-2.5 py-2 text-xs text-ink">
          <span>{state.notice}</span>
          <Button size="sm" onClick={() => phone.unlockAudio()}><Volume2 size={13} /> Enable audio</Button>
        </div>
      )}

      {(error || state?.error) && (
        <div role="alert" className="flex items-start justify-between gap-2 text-xs text-status-error">
          <span>{error || state.error}</span>
          {state?.error && <button type="button" className="underline" onClick={() => phone.clearError()}>Dismiss</button>}
        </div>
      )}

      {signedIn && !state?.call && (
        <Button size="sm" variant="ghost" onClick={() => phone.logout()}>
          <LogOut size={13} /> Sign out of phone
        </Button>
      )}
    </section>
  );
}
