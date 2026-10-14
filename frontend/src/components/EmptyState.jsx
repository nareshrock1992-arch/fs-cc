// EmptyState — centred placeholder for an empty list/section.
// `compact` renders a single quiet row (for live sections that should collapse
// when there's nothing to show, so the rest of the page rises).
export default function EmptyState({ icon: Icon, title, body, action, compact = false, tone = 'neutral' }) {
  if (compact) {
    const dot = tone === 'ok' ? 'bg-status-available' : tone === 'warn' ? 'bg-status-ringing' : 'bg-gray-300 dark:bg-ink-faint/50';
    return (
      <div className="flex items-start gap-2.5 px-4 py-3 min-w-0">
        <span className={`h-2 w-2 rounded-full shrink-0 mt-[0.35rem] ${dot}`} aria-hidden="true" />
        <p className="min-w-0 leading-snug">
          {title && <span className="text-[0.8125rem] font-medium text-ink-dim">{title}</span>}
          {body && <span className="text-xs text-ink-faint"> — {body}</span>}
        </p>
        {action && <span className="ml-auto shrink-0">{action}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center gap-1.5 px-4">
      {Icon && (
        <div className="h-10 w-10 rounded-md flex items-center justify-center
                        bg-surface-2 text-ink-faint mb-2 shrink-0">
          <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
        </div>
      )}
      {title && (
        <p className="text-[0.8125rem] font-semibold text-ink-dim">{title}</p>
      )}
      {body && (
        <p className="text-xs text-ink-faint max-w-sm leading-relaxed">{body}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
