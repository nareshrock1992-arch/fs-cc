import React from 'react';
import { PhoneCall, PhoneOff } from 'lucide-react';
import { Button } from '../../ui/primitives.jsx';

/**
 * Phone lifecycle notices (CP3-E). Display only; the agent always makes the choice.
 */

/** Phone is back after PHONE_OFFLINE. Never sets Available on its own. */
export function PhoneRecoveredPrompt({ onAvailable }) {
  return (
    <div role="status" aria-label="Phone reconnected"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-status-available/40 bg-status-available/10 px-4 py-3">
      <PhoneCall size={18} className="text-status-available shrink-0" aria-hidden="true" />
      <p className="flex-1 min-w-0 text-sm text-ink">
        <span className="font-semibold">Your browser phone is back.</span>{' '}
        You are still on break (Phone offline). Set yourself Available when you are ready to take calls.
      </p>
      <Button variant="call" size="sm" onClick={onAvailable}>Set Available</Button>
    </div>
  );
}

/** The supervisor turned the browser phone off for this agent. */
export function PhoneDisabledNotice({ inCall }) {
  return (
    <div role="alert" aria-label="Browser phone turned off"
      className="flex items-start gap-3 rounded-lg border border-status-ringing/50 bg-status-ringing/10 px-4 py-3">
      <PhoneOff size={18} className="mt-0.5 text-status-ringing shrink-0" aria-hidden="true" />
      <p className="text-sm text-ink">
        {inCall
          ? 'Your supervisor turned off the browser phone for you. It will sign out when this call ends — the call is not interrupted.'
          : 'Your supervisor turned off the browser phone for you. Use your desk phone for calls.'}
      </p>
    </div>
  );
}
