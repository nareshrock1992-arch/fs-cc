# FS-CC Enterprise Design System (admin portal)

One visual language for every admin page. Source of truth: `frontend/src/index.css` (CSS variables + component classes) and `frontend/tailwind.config.js` (token names). Light and dark themes switch by changing the variables only.

## 1. Colour tokens — never hard-code greys
| Use | Class | Do NOT use |
|---|---|---|
| Main text | `text-ink` | `text-gray-700/800/900` |
| Secondary text | `text-ink-dim` | `text-gray-500/600` |
| Hints, timestamps | `text-ink-faint` | `text-gray-400` |
| Disabled | `text-ink-disabled` | `text-gray-300` |
| Page / card | `bg-surface` | `bg-white` |
| Sub-surface, header rows, hover | `bg-surface-2` | `bg-gray-50/100` |
| Hairlines | `border-border`, `divide-border` | `border-gray-100/200` |
| Inputs, strong dividers | `border-border-strong` | `border-gray-300` |
| Primary action | `bg-primary`, `text-primary` | blue-500/600 |

Status (operational meaning, same on every page): `status-available` (green), `status-oncall` (blue), `status-ringing` (amber), `status-onbreak` (purple), `status-loggedout` (grey), `status-waiting`, `status-abandoned`, `status-noanswer`, `status-error` (red). Use `StatusBadge` for agent/call states.

## 2. Components
| Need | Use |
|---|---|
| Section with title / count / actions | `Panel` (`title`, `eyebrow`, `count`, `action`, `noPad` for tables) |
| Table | `<table className="data-table">` · header `th` · cells `td` / `td-secondary` / `td-num` · rows `tr-row` |
| Nothing to show | `EmptyState` (`compact` inside panels) |
| Agent / call state | `StatusBadge` |
| Form field | `FormField` + `inputClass`, buttons `buttonPrimary` / `buttonSecondary` |
| Live feed status | `LiveIndicator` |
| Supervisor summary numbers | compact metric strip (see Live Operations `HealthStrip`), not rows of large cards |

## 3. Rules
- Real data only. Missing value → "—" with a short reason ("no calls yet"); never a fake 0.
- Numbers: `tabular-nums`; durations `m:ss` / `h:mm:ss`.
- Density: table cells `px-4 py-2`, text 13 px; panels separated by `gap-4`.
- No glow, gradients or heavy shadows; 1 px borders, small radius.
- Wide screens: two-column grids (`xl:grid-cols-[2fr_1fr]`); phones: one column, tables scroll inside their panel (never the page).

## 4. Status of adoption (2026-11-14)
- All admin pages + report components moved to colour tokens (≈380 hard-coded greys replaced) and the shared table classes (≈110 cells/headers).
- Live Operations follows the full layout pattern.
- Remaining: Dashboard overlaps Live Operations (candidate to simplify), Break Codes shows its title twice, older `panel-*` dark-only classes still exist in a few report components, agent desktop not yet aligned.
