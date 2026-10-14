/**
 * StatusBadge — the canonical semantic status pill for FS-CC.
 *
 * Backed by the `status.*` design tokens (theme-aware, no glow). One component
 * for every contact-center state so the whole app speaks the same status
 * language. Status is always conveyed by a dot AND a text label — never colour
 * alone.
 *
 * Props:
 *   status   — canonical state string (see STATUS_TONE keys)
 *   label    — override text (defaults to the canonical label for the status)
 *   showDot  — leading dot (default true)
 *   size     — 'sm' | 'md' (default 'sm')
 *   subtle   — true (default): tinted pill;  false: dot + plain text (no pill)
 */

// Full static class strings (purge-safe — never build Tailwind classes dynamically).
const T = {
  available: { dot: 'bg-status-available', text: 'text-status-available', pill: 'bg-status-available/10' },
  oncall:    { dot: 'bg-status-oncall',    text: 'text-status-oncall',    pill: 'bg-status-oncall/10' },
  ringing:   { dot: 'bg-status-ringing',   text: 'text-status-ringing',   pill: 'bg-status-ringing/10' },
  onbreak:   { dot: 'bg-status-onbreak',   text: 'text-status-onbreak',   pill: 'bg-status-onbreak/10' },
  offline:   { dot: 'bg-status-loggedout', text: 'text-status-loggedout', pill: 'bg-status-loggedout/10' },
  waiting:   { dot: 'bg-status-waiting',   text: 'text-status-waiting',   pill: 'bg-status-waiting/10' },
  abandoned: { dot: 'bg-status-abandoned', text: 'text-status-abandoned', pill: 'bg-status-abandoned/10' },
  noanswer:  { dot: 'bg-status-noanswer',  text: 'text-status-noanswer',  pill: 'bg-status-noanswer/10' },
  error:     { dot: 'bg-status-error',     text: 'text-status-error',     pill: 'bg-status-error/10' },
};

// status string → [tone, default label]
const STATUS_TONE = {
  'Available':  [T.available, 'Available'],
  'Idle':       [T.available, 'Available'],
  'Ringing':    [T.ringing,   'Ringing'],
  'On Call':    [T.oncall,    'On Call'],
  'Connected':  [T.oncall,    'On Call'],
  'Talking':    [T.oncall,    'On Call'],
  'On Break':   [T.onbreak,   'On Break'],
  'Logged Out': [T.offline,   'Logged Out'],
  'Offline':    [T.offline,   'Offline'],
  'Waiting':    [T.waiting,   'Waiting'],
  'Abandoned':  [T.abandoned, 'Abandoned'],
  'No Answer':  [T.noanswer,  'No Answer'],
  'Error':      [T.error,     'Error'],
};

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
  const [tone, defLabel] = STATUS_TONE[status] || [T.offline, status || 'Unknown'];
  const s = SIZE[size] || SIZE.sm;
  const text = label ?? defLabel;
  const dot = showDot && (
    <span className={`rounded-full shrink-0 ${s.dot} ${tone.dot}`} aria-hidden="true" />
  );

  // subtle → tinted pill; otherwise dot + plain semantic text (no background).
  const cls = subtle
    ? `inline-flex items-center rounded-full font-semibold whitespace-nowrap ${s.pad} ${s.textGap} ${tone.pill} ${tone.text}`
    : `inline-flex items-center font-semibold whitespace-nowrap ${s.textGap} ${tone.text}`;

  return <span className={cls}>{dot}{text}</span>;
}
