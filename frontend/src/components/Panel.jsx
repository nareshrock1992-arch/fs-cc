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
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
      {label ?? m.label}
    </span>
  );
}

export default function Panel({ title, eyebrow, count, live, action, children, className = '', noPad = false }) {
  const hasHeader = title || action;
  return (
    <section className={`card ${className}`}>
      {/* Header wraps instead of truncating: on narrow widths / high zoom the
          actions drop below the title rather than squeezing it. */}
      {hasHeader && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-h-[2.75rem] px-4 py-2 border-b border-border">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            {title && <h2 className="text-section-title">{title}</h2>}
            {count != null && <span className="count-pill">{count}</span>}
            {eyebrow && (
              <span className="text-xs text-ink-faint">· {eyebrow}</span>
            )}
            {live && <span className="ml-1"><LiveIndicator state={live} /></span>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'p-4'}>{children}</div>
    </section>
  );
}
