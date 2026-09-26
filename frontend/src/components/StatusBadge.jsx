/**
 * StatusBadge — the canonical semantic status pill for FS-CC.
 *
 * Backed by the Phase 1 `status.*` design tokens (crisp, theme-aware, NO glow,
 * NO animation, NO shadow). One component for every contact-center state so the
 * whole app speaks the same status language.
 *
 * NOTE (Phase 3A): this is the PRIMITIVE only. Migrating the existing status
 * implementations (StatusLamp, LiveAgents STATE_META pills, Agents STATUS_SELECT)
 * onto it is Phase 3C and is intentionally NOT done here.
 *
 * Props:
 *   status   — canonical state string (see STATUS_TONE keys)
 *   label    — override text (defaults to the status string)
 *   showDot  — leading dot (default true)
 *   size     — 'sm' | 'md' (default 'sm')
 *   subtle   — true (default): tinted pill;  false: dot + plain text (no pill)
 */

// Full static class strings (purge-safe — never build Tailwind classes dynamically).
const STATUS_TONE = {
  'Available':  { dot: 'bg-status-available', text: 'text-status-available', pill: 'bg-status-available/10' },
  'Idle':       { dot: 'bg-status-available', text: 'text-status-available', pill: 'bg-status-available/10' },
  'Ringing':    { dot: 'bg-status-ringing',   text: 'text-status-ringing',   pill: 'bg-status-ringing/10' },
  'On Call':    { dot: 'bg-status-oncall',    text: 'text-status-oncall',    pill: 'bg-status-oncall/10' },
  'Talking':    { dot: 'bg-status-oncall',    text: 'text-status-oncall',    pill: 'bg-status-oncall/10' },
  'On Break':   { dot: 'bg-status-onbreak',   text: 'text-status-onbreak',   pill: 'bg-status-onbreak/10' },
  'Logged Out': { dot: 'bg-status-loggedout', text: 'text-status-loggedout', pill: 'bg-status-loggedout/10' },
  'Offline':    { dot: 'bg-status-loggedout', text: 'text-status-loggedout', pill: 'bg-status-loggedout/10' },
  'Waiting':    { dot: 'bg-status-waiting',   text: 'text-status-waiting',   pill: 'bg-status-waiting/10' },
  'Abandoned':  { dot: 'bg-status-abandoned', text: 'text-status-abandoned', pill: 'bg-status-abandoned/10' },
  'No Answer':  { dot: 'bg-status-noanswer',  text: 'text-status-noanswer',  pill: 'bg-status-noanswer/10' },
  'Error':      { dot: 'bg-status-error',     text: 'text-status-error',     pill: 'bg-status-error/10' },
};

const FALLBACK = { dot: 'bg-status-loggedout', text: 'text-status-loggedout', pill: 'bg-status-loggedout/10' };

const SIZE = {
  sm: { pad: 'px-2 py-0.5', textGap: 'text-[11px] gap-1.5', dot: 'h-1.5 w-1.5' },
  md: { pad: 'px-2.5 py-1',  textGap: 'text-xs gap-2',       dot: 'h-2 w-2' },
};

export default function StatusBadge({
  status,
  label,
  showDot = true,
  size = 'sm',
  subtle = true,
}) {
  const tone = STATUS_TONE[status] || FALLBACK;
  const s = SIZE[size] || SIZE.sm;
  const text = label ?? status ?? 'Unknown';
  const dot = showDot && (
    <span className={`rounded-full shrink-0 ${s.dot} ${tone.dot}`} aria-hidden="true" />
  );

  // subtle → tinted pill; otherwise dot + plain semantic text (no background).
  const cls = subtle
    ? `inline-flex items-center rounded-full font-semibold ${s.pad} ${s.textGap} ${tone.pill} ${tone.text}`
    : `inline-flex items-center font-semibold ${s.textGap} ${tone.text}`;

  return <span className={cls}>{dot}{text}</span>;
}
