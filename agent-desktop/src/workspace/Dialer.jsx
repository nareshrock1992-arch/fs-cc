import React, { useEffect, useRef, useState } from 'react';
import { Grid3x3, PhoneOutgoing, Delete } from 'lucide-react';
import { Button, IconButton } from '../ui/primitives.jsx';
import Keypad from './Keypad.jsx';

const DIAL_CHARS = /[^0-9*#+]/g;

/**
 * Why the agent cannot dial right now (null = can dial). Uses real phone state only.
 */
export function dialBlockedReason(phone) {
  if (!phone) return 'The browser phone is not enabled on this desktop.';
  if (phone.configError) return phone.configError;
  if (!phone.eligibility?.eligible) return phone.eligibility?.reason || 'Browser phone not available for this agent.';
  if (!phone.state?.account) return 'Sign in to the browser phone to make calls.';
  if (phone.state.registration !== 'registered') return phone.indicator?.label || 'Phone not registered.';
  return null;
}

/**
 * Compact outbound dialer: one input row + Call. The keypad is hidden by default and
 * opens as a small popover. Recent numbers (this agent's real call history) are offered
 * as quick-dial chips.
 */
export default function Dialer({ phone, recentNumbers = [] }) {
  const [number, setNumber] = useState('');
  const [keypad, setKeypad] = useState(false);
  const [placing, setPlacing] = useState(false);
  const popRef = useRef(null);
  const blocked = dialBlockedReason(phone);
  const clean = number.replace(DIAL_CHARS, '');

  useEffect(() => {
    if (!keypad) return undefined;
    const onDoc = (e) => { if (popRef.current && !popRef.current.contains(e.target)) setKeypad(false); };
    const onKey = (e) => { if (e.key === 'Escape') setKeypad(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [keypad]);

  async function call(e) {
    e?.preventDefault();
    if (!clean || blocked || placing) return; // no repeated initiation
    setPlacing(true);
    try {
      phone.clearError();
      await phone.dial(clean);
      setNumber('');
      setKeypad(false);
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={call} aria-label="Dial pad" className="flex items-center gap-2">
        <div className="relative flex-1" ref={popRef}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            aria-label="Number to call"
            placeholder="Enter number or extension"
            value={number}
            disabled={!!blocked}
            onChange={(e) => setNumber(e.target.value.replace(DIAL_CHARS, ''))}
            className="w-full h-10 pl-3 pr-20 rounded-md border border-panel-border bg-panel-surface font-mono text-sm text-ink
                       placeholder:font-sans placeholder:text-ink-faint focus:outline-none focus:border-primary disabled:bg-panel-raised"
          />
          <div className="absolute right-1 top-1 flex items-center gap-0.5">
            {number && (
              <IconButton label="Delete last digit" className="h-8 w-8" onClick={() => setNumber((n) => n.slice(0, -1))}>
                <Delete size={15} />
              </IconButton>
            )}
            <IconButton
              label={keypad ? 'Hide keypad' : 'Show keypad'}
              className="h-8 w-8"
              variant={keypad ? 'toggled' : 'ghost'}
              aria-pressed={keypad}
              disabled={!!blocked}
              onClick={() => setKeypad((v) => !v)}
            >
              <Grid3x3 size={15} />
            </IconButton>
          </div>
          {keypad && (
            <div className="absolute right-0 z-20 mt-1 p-2 rounded-lg border border-panel-border bg-panel-surface shadow-lg">
              <Keypad label="Dial keypad" onKey={(k) => setNumber((n) => n + k)} />
            </div>
          )}
        </div>
        <Button type="submit" variant="call" size="lg" disabled={!clean || !!blocked || placing}>
          <PhoneOutgoing size={16} /> {placing ? 'Calling…' : 'Call'}
        </Button>
      </form>

      {blocked ? (
        <p className="text-xs text-ink-dim" role="status">{blocked}</p>
      ) : recentNumbers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Recent numbers">
          <span className="text-[0.6875rem] text-ink-faint">Recent:</span>
          {recentNumbers.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNumber(n)}
              className="h-6 px-2 rounded border border-panel-border text-[0.6875rem] font-mono text-ink-dim hover:bg-panel-raised"
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
