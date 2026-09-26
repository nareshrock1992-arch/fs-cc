/**
 * PageHeader — the canonical in-content page header for FS-CC Admin.
 *
 * Page IDENTITY (the title) lives in the persistent Topbar — this header carries
 * page CONTEXT: a short description and the page's actions. It deliberately does
 * NOT repeat the title by default, so pages don't read "Agents / Agents / …".
 *
 * Structure (compact, single row on desktop; stacks on mobile):
 *   ┌───────────────────────────────────────────────┐
 *   │ short description                  [ actions ] │
 *   └───────────────────────────────────────────────┘
 *
 * It still SUPPORTS a `title` (optional) for any future in-content use, and
 * renders NOTHING (no empty gap) when there is no description, title or actions.
 *
 * Uses the Phase 1 typography tokens (.text-page-title / .text-secondary-sm) —
 * it does NOT introduce a new type system. Light/dark come from semantic tokens.
 *
 * Props:
 *   title       — string | node (optional; omitted for the Topbar-titled pages)
 *   description — string | node (optional)
 *   actions     — node (optional; right-aligned controls)
 *   icon        — optional lucide icon component (only shown alongside a title)
 */
export default function PageHeader({ title, description, actions, icon: Icon }) {
  // Nothing to show → render nothing (avoids an empty spacer above the page).
  if (!title && !description && !actions) return null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
      <div className="min-w-0">
        {title && (
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <span className="shrink-0 h-8 w-8 rounded-lg bg-primary/10 text-primary
                               flex items-center justify-center">
                <Icon size={17} strokeWidth={2} />
              </span>
            )}
            <h1 className="text-page-title truncate">{title}</h1>
          </div>
        )}
        {description && (
          <p className={`text-secondary-sm max-w-2xl ${title ? 'mt-1' : ''}`}>{description}</p>
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
