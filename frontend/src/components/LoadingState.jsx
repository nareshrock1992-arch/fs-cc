export default function LoadingState({ rows = 3, cols = 4, label = 'Loading…' }) {
  return (
    <div role="status" aria-label={label}>
      {/* Skeleton rows */}
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-3">
            {Array.from({ length: cols }).map((_, j) => (
              <div
                key={j}
                className="skeleton h-7 flex-1 rounded-md"
                style={{ opacity: 1 - i * 0.15 }}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="text-[12px] text-ink-faint mt-3 text-center">{label}</p>
    </div>
  );
}

// Matches KpiCard's compact footprint so the layout doesn't jump on first load.
export function KpiSkeleton({ count = 5, className = 'grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]' }) {
  return (
    <div className={className} role="status" aria-label="Loading metrics">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border-border bg-surface px-3.5 py-3 space-y-2.5">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-6 w-12 rounded" />
        </div>
      ))}
    </div>
  );
}
