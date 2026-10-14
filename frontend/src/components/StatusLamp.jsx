// StatusLamp — agent/tier state as dot + label (lamp) or tinted pill (badge).
// Colours come from the shared `status.*` tokens so every screen uses the same
// status language as StatusBadge / Live Operations (e.g. On Break is always
// violet, On Call always blue). Labels are unchanged.
const LAMP_MAP = {
  Available:        { color: 'bg-status-available', pulse: false, text: 'text-status-available', badge: 'bg-status-available/10 border-status-available/25', label: 'Available' },
  'On Break':       { color: 'bg-status-onbreak',   pulse: false, text: 'text-status-onbreak',   badge: 'bg-status-onbreak/10 border-status-onbreak/25',     label: 'On Break' },
  'Logged Out':     { color: 'bg-status-loggedout', pulse: false, text: 'text-status-loggedout', badge: 'bg-status-loggedout/10 border-status-loggedout/25', label: 'Logged Out' },
  Receiving:        { color: 'bg-status-ringing',   pulse: true,  text: 'text-status-ringing',   badge: 'bg-status-ringing/10 border-status-ringing/25',     label: 'Ringing' },
  'In a queue call':{ color: 'bg-status-oncall',    pulse: false, text: 'text-status-oncall',    badge: 'bg-status-oncall/10 border-status-oncall/25',       label: 'In Call' },
  InQueue:          { color: 'bg-status-waiting',   pulse: false, text: 'text-status-waiting',   badge: 'bg-status-waiting/10 border-status-waiting/25',     label: 'In Queue' },
  Waiting:          { color: 'bg-status-available', pulse: false, text: 'text-status-available', badge: 'bg-status-available/10 border-status-available/25', label: 'Waiting' },
  Abandoned:        { color: 'bg-status-abandoned', pulse: false, text: 'text-status-abandoned', badge: 'bg-status-abandoned/10 border-status-abandoned/25', label: 'Abandoned' },
  Offline:          { color: 'bg-status-error',     pulse: false, text: 'text-status-error',     badge: 'bg-status-error/10 border-status-error/25',         label: 'Offline' },
};

const FALLBACK = {
  color: 'bg-status-loggedout', pulse: false,
  text: 'text-ink-dim',
  badge: 'bg-surface-2 border-border',
  label: '',
};

const DOT_SIZE = { sm: 'h-2 w-2', md: 'h-2 w-2', lg: 'h-2.5 w-2.5' };

// lamp — classic dot + text inline
// badge — pill badge with background (for tables, cards)
export default function StatusLamp({ status, label, size = 'md', showLabel = true, variant = 'lamp' }) {
  const cfg = LAMP_MAP[status] || { ...FALLBACK, label: status || 'Unknown' };
  const displayLabel = label || cfg.label;

  if (variant === 'badge') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full whitespace-nowrap
        text-[0.6875rem] font-semibold border ${cfg.badge} ${cfg.text}`}>
        <span
          className={`rounded-full h-1.5 w-1.5 shrink-0 ${cfg.color}
            ${cfg.pulse ? 'animate-pulse-soft' : ''}`}
          aria-hidden="true"
        />
        {displayLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span
        className={`rounded-full shrink-0 ${DOT_SIZE[size] ?? DOT_SIZE.md}
          ${cfg.color} ${cfg.pulse ? 'animate-pulse-soft' : ''}`}
        aria-hidden="true"
      />
      {showLabel && (
        <span className={`text-xs font-semibold ${cfg.text}`}>
          {displayLabel}
        </span>
      )}
    </span>
  );
}
