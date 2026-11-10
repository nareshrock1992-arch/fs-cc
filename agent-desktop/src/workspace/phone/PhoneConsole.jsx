import React, { useEffect, useState } from 'react';
import {
  Phone, PhoneOutgoing, PhoneOff, Mic, MicOff, Pause, Play, ArrowRightLeft, Users, Delete, X, Volume2, LogOut, AlertTriangle,
} from 'lucide-react';
import { Button, IconButton } from '../../ui/primitives.jsx';
import { useElapsed, useSince } from '../format.js';
import PhoneKeypad from './PhoneKeypad.jsx';
import {
  PhoneStatusBar, PhoneSignIn, CallDisplay, LastCallLine, ControlTile, AudioDevices,
} from './PhoneParts.jsx';

/**
 * PhoneConsole — the agent's telephony console (centre of the Workspace page).
 *
 *   status bar   registration · extension
 *   display      number entry (idle) / caller, state, timer (in call)
 *   keypad       ALWAYS visible: dials when idle, sends DTMF in a call
 *   action       Call | Answer + Reject | Cancel call | End call
 *   controls     Mute · Hold · Transfer (n/a) · Conference (n/a)
 *   audio        microphone and speaker selectors
 *
 * Every action is a real usePhone() call on the existing engine (no second engine,
 * no simulated states). `interaction` comes from interactions/correlate.js.
 */

const DIAL_CHARS = /[^0-9*#+]/g;
const TONE = /^[0-9*#]$/;

/** Why the agent cannot dial now (null = can dial). Real phone state only. */
export function dialBlockedReason(phone) {
  if (!phone) return 'The browser phone is not enabled on this desktop.';
  if (phone.configError) return phone.configError;
  if (!phone.eligibility?.eligible) return phone.eligibility?.reason || 'Browser phone not available for this agent.';
  if (!phone.state?.account) return 'Sign in to the phone to make calls.';
  if (phone.state.registration !== 'registered') return phone.indicator?.label || 'Phone not registered.';
  return null;
}

export default function PhoneConsole({ phone, interaction, dialRequest }) {
  const [number, setNumber] = useState('');
  const [placing, setPlacing] = useState(false);
  const [tones, setTones] = useState('');
  const [xferOpen, setXferOpen] = useState(false);
  const [xferNumber, setXferNumber] = useState('');

  const status = interaction?.status;
  const controllable = Boolean(interaction?.controllable && phone);
  const inCall = controllable && (status === 'connected' || status === 'held');
  const ringingHere = controllable && status === 'ringing';
  const progressing = controllable && ['dialing', 'ringing-out', 'connecting'].includes(status);
  const idle = !interaction || status === 'ended';
  const blocked = dialBlockedReason(phone);
  const canDial = idle && !blocked;
  const clean = number.replace(DIAL_CHARS, '');
  const signedIn = Boolean(phone?.state?.account);

  useEffect(() => { setTones(''); setXferOpen(false); setXferNumber(''); }, [interaction?.id]);
  // a number picked elsewhere (recent calls) is loaded into the display
  useEffect(() => { if (dialRequest?.number) setNumber(dialRequest.number.replace(DIAL_CHARS, '')); }, [dialRequest]);
  // device list (labels) once signed in; the engine also refreshes on device changes
  useEffect(() => { if (signedIn) phone.refreshDevices(); }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const ringingNow = status === 'ringing' || status === 'offering';
  const ringStart = useSince(ringingNow, interaction?.id);
  const ringFor = useElapsed(ringingNow ? (interaction?.startedAt || ringStart) : null);
  const talkFor = useElapsed(status === 'connected' || status === 'held' ? (interaction?.answeredAt || interaction?.startedAt) : null);

  function sendTone(k) {
    phone.sendDtmf(k);
    setTones((s) => (s + k).slice(-24));
  }
  // Blind transfer (SIP REFER). Progress comes from the engine: phone.state.call.transfer
  const xfer = inCall ? phone?.state?.call?.transfer : undefined;
  const xferBusy = xfer?.status === 'requesting' || xfer?.status === 'accepted' || xfer?.status === 'done';
  // Consult (attended) transfer: second line to a colleague, customer on hold.
  const consult = phone?.state?.consult;
  const consulting = Boolean(consult && consult.status !== 'ended' && phone?.state?.call);
  const consultTalk = useElapsed(consult?.status === 'active' ? consult.answeredAt : null);
  const showXfer = inCall && !consulting && (xferOpen || xferBusy);
  async function consultNow() {
    const target = xferNumber.replace(DIAL_CHARS, '');
    if (!target || xferBusy) return;
    phone.clearError();
    setXferOpen(false);
    setXferNumber('');
    await phone.startConsult(target);
  }
  async function transferNow(e) {
    e?.preventDefault();
    const target = xferNumber.replace(DIAL_CHARS, '');
    if (!target || xferBusy) return;
    phone.clearError();
    await phone.transfer(target);
  }
  function onKey(k) {
    if (consulting) return;
    if (showXfer) { if (!xferBusy) setXferNumber((n) => n + k); }
    else if (inCall) sendTone(k);
    else if (canDial) setNumber((n) => n + k);
  }
  async function call(e) {
    e?.preventDefault();
    if (!clean || !canDial || placing) return; // never start a second call
    setPlacing(true);
    try {
      phone.clearError();
      await phone.dial(clean);
      setNumber('');
    } finally {
      setPlacing(false);
    }
  }
  // Physical keyboard: digits send DTMF during a call while focus is in the console.
  function onKeyDown(e) {
    if (inCall && !showXfer && !consulting && TONE.test(e.key) && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
      e.preventDefault();
      sendTone(e.key);
    }
  }

  if (!phone) {
    return (
      <section aria-label="Phone" className="rounded-lg border border-panel-border bg-panel-surface">
        <PhoneStatusBar level="off" label="Browser phone not enabled" />
        <p className="px-4 py-4 text-sm text-ink-dim">This desktop was built without the browser phone. Use your desk phone for calls.</p>
      </section>
    );
  }

  const { state, indicator, eligibility, configError } = phone;
  // A failed sign-in (microphone missing/denied, WSS refused, wrong password) leaves no
  // account; show it as a failure instead of a neutral "Phone off".
  const signInFailed = !signedIn && Boolean(state?.error);
  const level = configError || !eligibility.eligible ? 'off' : signInFailed ? 'error' : indicator.level;
  const label = configError ? 'Not configured' : !eligibility.eligible ? 'Not available'
    : signInFailed ? 'Sign-in failed' : indicator.label;

  return (
    <section aria-label="Phone" onKeyDown={onKeyDown}
      className="rounded-lg border border-panel-border bg-panel-surface flex flex-col">
      <PhoneStatusBar
        level={level}
        label={label}
        ext={state?.account?.extension || eligibility.extension}
        action={signedIn && !interaction && (
          <IconButton label="Sign out of phone" className="h-8 w-8" onClick={() => phone.logout()}><LogOut size={14} /></IconButton>
        )}
      />

      {/* Phone errors at the TOP so they are always visible (e.g. "No microphone was found"). */}
      {state?.error && (
        <div role="alert" className="flex items-start gap-2 px-4 py-2.5 border-b border-status-error/30 bg-status-error/10 text-sm text-status-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{state.error}</span>
          <button type="button" className="text-xs underline shrink-0" onClick={() => phone.clearError()}>Dismiss</button>
        </div>
      )}
      {state?.notice && (
        <div role="status" className="flex items-center justify-between gap-2 px-4 py-2 border-b border-status-ringing/30 bg-status-ringing/10 text-xs text-ink">
          <span>{state.notice}</span>
          <Button size="sm" onClick={() => phone.unlockAudio()}><Volume2 size={13} /> Enable audio</Button>
        </div>
      )}
      {configError && <p className="px-4 py-2 text-xs text-status-error">{configError}</p>}
      {!configError && !eligibility.eligible && <p className="px-4 py-2 text-xs text-ink-dim">{eligibility.reason}</p>}
      {!configError && eligibility.eligible && !signedIn && (
        <PhoneSignIn extension={eligibility.extension} onSignIn={(pw) => phone.login(pw)} />
      )}

      {/* display */}
      <div className="px-4 pt-4 pb-3 min-h-[7.25rem] flex flex-col justify-center" aria-live="polite">
        {idle ? (
          <form onSubmit={call} aria-label="Dial pad">
            {status === 'ended' && <LastCallLine interaction={interaction} />}
            <div className="flex items-center gap-1 border-b-2 border-panel-border focus-within:border-primary">
              <input
                type="tel" inputMode="tel" autoComplete="off" aria-label="Number to call"
                placeholder={blocked ? '' : 'Enter number'}
                value={number} disabled={!!blocked}
                onChange={(e) => setNumber(e.target.value.replace(DIAL_CHARS, ''))}
                className="flex-1 min-w-0 h-12 bg-transparent text-center font-mono text-[1.75rem] text-ink tracking-wide
                           placeholder:font-sans placeholder:text-base placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed"
              />
              <IconButton label="Delete last digit" className="h-9 w-9" disabled={!number} onClick={() => setNumber((n) => n.slice(0, -1))}>
                <Delete size={18} />
              </IconButton>
              <IconButton label="Clear number" className="h-9 w-9" disabled={!number} onClick={() => setNumber('')}>
                <X size={18} />
              </IconButton>
            </div>
            <p className="mt-2 min-h-[1rem] text-center text-xs text-ink-dim" role="status">{blocked || ''}</p>
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        ) : (
          <CallDisplay interaction={interaction} timer={inCall ? talkFor : ringFor} />
        )}
        {consulting && (
          <div aria-label="Consult call" className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-dim">Customer</span>
              <span className={phone.state.call.held ? 'text-status-ringing font-medium' : 'text-status-ok font-medium'}>
                {phone.state.call.held ? 'On hold' : 'Talking'}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-ink-dim">Colleague <span className="font-mono text-ink">{consult.target}</span></span>
              <span aria-label="Consult status" className="font-medium">
                {consult.completing ? 'Transferring…'
                  : consult.status === 'active' ? (consult.held ? 'On hold' : `Talking ${consultTalk}`)
                  : 'Ringing…'}
              </span>
            </div>
          </div>
        )}
        {showXfer && (
          <form onSubmit={transferNow} aria-label="Transfer" className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-2">
            <label className="block text-[0.6875rem] font-medium text-ink-dim mb-1" htmlFor="xfer-number">Transfer call to</label>
            <div className="flex items-center gap-1">
              <input id="xfer-number" type="tel" inputMode="tel" autoComplete="off" aria-label="Transfer to number"
                placeholder="Extension or number" value={xferNumber} disabled={xferBusy} autoFocus
                onChange={(e) => setXferNumber(e.target.value.replace(DIAL_CHARS, ''))}
                className="flex-1 min-w-0 h-9 px-2 rounded border border-panel-border bg-panel-surface font-mono text-base text-ink focus:outline-none focus:border-primary disabled:opacity-60" />
              <IconButton label="Delete last transfer digit" className="h-9 w-9" disabled={!xferNumber || xferBusy} onClick={() => setXferNumber((n) => n.slice(0, -1))}>
                <Delete size={16} />
              </IconButton>
            </div>
            <p className="mt-1 min-h-[1rem] text-xs" role="status" aria-label="Transfer status">
              {xfer?.status === 'requesting' && <span className="text-ink-dim">Transferring to {xfer.target}…</span>}
              {xfer?.status === 'accepted' && <span className="text-ink-dim">Connecting customer to {xfer.target}…</span>}
              {xfer?.status === 'done' && <span className="text-status-ok">Transferred to {xfer.target}</span>}
              {xfer?.status === 'failed' && <span className="text-status-error">Transfer failed: {xfer.reason}. Customer is still with you.</span>}
            </p>
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        )}
      </div>

      {/* keypad — always visible */}
      <div className="px-4">
        <PhoneKeypad label={showXfer ? 'Transfer keypad' : inCall ? 'In-call keypad' : 'Dial keypad'} onKey={onKey}
          disabled={!(inCall || canDial) || (showXfer && xferBusy) || consulting} />
        <p className="mt-1.5 h-4 text-center text-[0.6875rem] font-mono text-ink-dim" aria-label="Tones sent">
          {consulting ? '' : showXfer ? 'Keypad enters the transfer number' : inCall ? (tones ? `Tones sent: ${tones}` : 'Keypad sends tones (DTMF)') : ''}
        </p>
      </div>

      {/* primary action */}
      <div className="px-4 pt-2 pb-3">
        {idle && (
          <Button variant="call" size="lg" className="w-full h-12 text-base" onClick={call} disabled={!clean || !canDial || placing}>
            <PhoneOutgoing size={18} /> {placing ? 'Calling…' : 'Call'}
          </Button>
        )}
        {ringingHere && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="call" size="lg" className="h-12 text-base" onClick={() => phone.answer()}><Phone size={18} /> Answer</Button>
            <Button variant="danger" size="lg" className="h-12 text-base" onClick={() => phone.reject()}><PhoneOff size={18} /> Reject</Button>
          </div>
        )}
        {progressing && (
          <Button variant="danger" size="lg" className="w-full h-12 text-base" onClick={() => phone.hangup()}><PhoneOff size={18} /> Cancel call</Button>
        )}
        {showXfer && (
          <div className="grid grid-cols-2 gap-2 mb-2">
            <Button variant="primary" size="lg" className="h-12 text-base" onClick={transferNow}
              disabled={!xferNumber.replace(DIAL_CHARS, '') || xferBusy}><ArrowRightLeft size={18} /> Transfer now</Button>
            <Button size="lg" className="h-12 text-base" onClick={consultNow}
              disabled={!xferNumber.replace(DIAL_CHARS, '') || xferBusy}><Users size={18} /> Consult first</Button>
            <Button size="md" className="col-span-2" disabled={xferBusy}
              onClick={() => { setXferOpen(false); setXferNumber(''); }}>Back to call</Button>
          </div>
        )}
        {consulting && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="call" size="lg" className="col-span-2 h-12 text-base" onClick={() => phone.completeConsult()}
              disabled={consult.status !== 'active' || consult.completing}><ArrowRightLeft size={18} /> Complete transfer</Button>
            <Button size="lg" className="h-12 text-base" onClick={() => phone.swapCalls()}
              disabled={consult.status !== 'active' || consult.completing}>
              {phone.state.call.held ? 'Talk to customer' : 'Talk to colleague'}
            </Button>
            <Button variant="danger" size="lg" className="h-12 text-base" onClick={() => phone.cancelConsult()}
              disabled={consult.completing}><PhoneOff size={18} /> Cancel consult</Button>
          </div>
        )}
        {inCall && !consulting && (
          <Button variant="danger" size="lg" className="w-full h-12 text-base" onClick={() => phone.hangup()}><PhoneOff size={18} /> End call</Button>
        )}
        {interaction && !controllable && status !== 'ended' && (
          <p className="h-12 flex items-center justify-center text-xs text-ink-dim text-center">
            {status === 'offering' ? 'Waiting for the call to ring here…' : 'Use the device handling this call.'}
          </p>
        )}
      </div>

      {/* in-call controls (stable layout; enabled only during a call) */}
      <div className="px-4 pb-3 grid grid-cols-4 gap-2" role="toolbar" aria-label="Call controls">
        <ControlTile label={interaction?.muted ? 'Unmute' : 'Mute'} icon={interaction?.muted ? MicOff : Mic}
          pressed={!!interaction?.muted} disabled={!inCall || consulting} onClick={() => phone.toggleMute()} />
        <ControlTile label={interaction?.held ? 'Resume' : 'Hold'} icon={interaction?.held ? Play : Pause}
          pressed={!!interaction?.held} disabled={!inCall || consulting} onClick={() => phone.toggleHold()} />
        <ControlTile label="Transfer" icon={ArrowRightLeft} pressed={showXfer || consulting} disabled={!inCall || xferBusy || consulting}
          onClick={() => setXferOpen((o) => !o)} />
        <ControlTile label="Conference" icon={Users} unavailable />
      </div>

      {signedIn && state?.devices && (
        <AudioDevices devices={state.devices} onSelectInput={(id) => phone.selectInput(id)} onSelectOutput={(id) => phone.selectOutput(id)} />
      )}

    </section>
  );
}
