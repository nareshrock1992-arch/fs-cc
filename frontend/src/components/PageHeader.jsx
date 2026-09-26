/**
 * PageHeader — the canonical in-content page header for FS-CC Admin.
 *
 * Structure (compact, single row on desktop; stacks on mobile):
 *   ┌───────────────────────────────────────────────┐
 *   │ Title                              [ actions ] │
 *   │ short description                              │
 *   └───────────────────────────────────────────────┘
 *
 * Uses the Phase 1 typography tokens (.text-page-title / .text-secondary-sm) —
 * it does NOT introduce a new type system. Light/dark come from semantic tokens.
 *
 * Props:
 *   title       — string | node (required)
 *   description — string | node (optional; omit to keep the header short)
 *   actions     — node (optional; right-aligned controls: buttons, pills, etc.)
 *   icon        — optional lucide icon component rendered before the title
 */
export default function PageHeader({ title, description, actions, icon: Icon }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span className="shrink-0 h-8 w-8 rounded-lg bg-primary/10 text-primary
                             flex items-center justify-center">
              <Icon size={17} strokeWidth={2} />
            </span>
          )}
          <h1 className="text-page-title truncate">{title}</h1>
        </div>
        {description && (
          <p className="text-secondary-sm mt-1 max-w-2xl">{description}</p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 flex-wrap sm:justify-end shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
