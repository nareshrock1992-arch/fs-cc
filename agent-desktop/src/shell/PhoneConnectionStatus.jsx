import React from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { StatusDot } from '../ui/primitives.jsx';
import { PHONE } from '../features/softphone/presence.js';

/**
 * PhoneConnectionStatus — the browser phone's connectivity in the top bar,
 * deliberately SEPARATE from the agent status selector next to it.
 * Renders nothing for agents who do not use the browser phone (desk phone,
 * EXTERNAL_PBX, gateway), so they never see misleading phone warnings.
 *
 * @param {{ presence: { key: string, level?: string, label?: string, detail?: string } }} props
 */
const ICON_TONE = { ok: 'text-status-available', warn: 'text-status-ringing', error: 'text-status-error' };

export default function PhoneConnectionStatus({ presence }) {
  if (!presence || presence.key === PHONE.HIDDEN) return null;
  const down = presence.key === PHONE.OFFLINE || presence.key === PHONE.FAILED;
  const Icon = down ? PhoneOff : Phone;
  const tone = presence.level === 'error'
    ? 'border-status-error/40 bg-status-error/10 text-status-error'
    : presence.level === 'warn'
      ? 'border-status-ringing/40 bg-status-ringing/10 text-ink'
      : 'border-panel-border text-ink-dim';
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`Browser phone: ${presence.label}`}
      title={presence.detail}
      data-phone={presence.key}
      className={`inline-flex items-center gap-1.5 h-9 px-2 sm:px-2.5 rounded-md border text-[0.75rem] font-medium whitespace-nowrap ${tone}`}
    >
      {/* Phone width: a coloured icon only; the dot and label appear from 640 px. */}
      <Icon size={14} aria-hidden="true" className={`${ICON_TONE[presence.level] || ''} sm:text-current`} />
      <span className="hidden sm:inline-flex"><StatusDot level={presence.level} /></span>
      <span className="hidden sm:inline">{presence.label}</span>
    </span>
  );
}
