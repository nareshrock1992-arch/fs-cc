export default function Panel({ title, eyebrow, action, children, className = '', noPad = false }) {
  return (
    <section className={`
      rounded-[10px] border shadow-card
      bg-white dark:bg-panel-surface
      border-gray-200 dark:border-panel-border
      ${className}
    `}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-3
          border-b border-gray-100 dark:border-panel-border">
          <div>
            {eyebrow && (
              <p className="text-[10px] uppercase tracking-[0.12em] font-semibold
                text-ink-faint font-display mb-0.5">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="font-display font-bold text-[15px] tracking-wide
                text-gray-900 dark:text-ink">
                {title}
              </h2>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'p-4'}>{children}</div>
    </section>
  );
}
