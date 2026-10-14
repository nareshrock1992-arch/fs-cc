/**
 * Panel — the canonical section container.
 *
 * Compact header (title · context · count · actions) over a body. The old
 * uppercase "eyebrow" label is kept as a prop for compatibility but rendered as
 * quiet inline context after the title ("Queue Health · Live + Today") instead
 * of a separate decorative line.
 *
 * Props:
 *   title     — section title
 *   eyebrow   — short context (e.g. "Live", "Today"); shown inline, muted
 *   count     — optional number shown in a count pill next to the title
 *   live      — optional 'live' | 'stale' | 'offline' indicator dot + label
 *   action    — right-aligned controls
 *   noPad     — body without padding (tables)
 *   className — extra classes on the section
 *   headerProps — extra props for the header row (e.g. a toggle button wrapper)
 */
const LIVE = {
  live:    { dot: 'bg-status-available', text: 'text-status-available', label: 'Live' },
  stale:   { dot: 'bg-status-ringing',   text: 'text-status-ringing',   label: 'Stale' },
  offline: { dot: 'bg-status-error',     text: 'text-status-error',     label: 'Offline' },
};

export function LiveIndicator({ state = 'live', label }) {
  const m = LIVE[state] || LIVE.live;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
      {label ?? m.label}
    </span>
  );
}

export default function Panel({ title, eyebrow, count, live, action, children, className = '', noPad = false }) {
  const hasHeader = title || action;
  return (
    <section className={`card ${className}`}>
      {hasHeader && (
        <div className="flex items-center justify-between gap-3 min-h-[44px] px-4 py-2 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            {title && <h2 className="text-section-title truncate">{title}</h2>}
            {count != null && <span className="count-pill">{count}</span>}
            {eyebrow && (
              <span className="hidden sm:inline text-[12px] text-ink-faint whitespace-nowrap">· {eyebrow}</span>
            )}
            {live && <span className="ml-1"><LiveIndicator state={live} /></span>}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'p-4'}>{children}</div>
    </section>
  );
}
