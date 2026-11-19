import React from 'react';
import { Mic, MicOff, Pause, Play, ArrowRightLeft, Users } from 'lucide-react';
import { ControlTile } from './PhoneParts.jsx';

/**
 * CallControls — in-call controls of the browser phone: Mute, Hold/Resume,
 * Transfer and Conference. Every control maps to a working engine action
 * (no placeholders). Layout is stable; controls are enabled only in a call.
 * State comes from the caller (PhoneConsole) so call logic lives in one place.
 */
export default function CallControls({
  interaction, inCall, consulting, consult, conference, showXfer, confMode, xferBusy,
  onMute, onHold, onTransfer, onConference,
}) {
  return (
    <div className="px-4 pb-3 grid grid-cols-4 gap-2" role="toolbar" aria-label="Call controls">
      <ControlTile label={interaction?.muted ? 'Unmute' : 'Mute'} icon={interaction?.muted ? MicOff : Mic}
        pressed={!!interaction?.muted} disabled={!inCall || consulting} onClick={onMute} />
      <ControlTile label={interaction?.held ? 'Resume' : 'Hold'} icon={interaction?.held ? Play : Pause}
        pressed={!!interaction?.held} disabled={!inCall || consulting} onClick={onHold} />
      <ControlTile label="Transfer" icon={ArrowRightLeft}
        pressed={(showXfer && !confMode) || (consulting && !confMode)}
        disabled={!inCall || xferBusy || consulting} onClick={onTransfer} />
      {/* Answered call: opens the panel to call a colleague. During a consult: merges all three. */}
      <ControlTile label="Conference" icon={Users}
        pressed={conference?.status === 'joined' || (showXfer && confMode)}
        disabled={consulting ? (consult?.status !== 'active' || consult?.completing) : (!inCall || xferBusy)}
        onClick={onConference} />
    </div>
  );
}
