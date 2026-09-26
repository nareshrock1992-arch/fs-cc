/**
 * Single source of truth for per-route page identity (title + short description).
 *
 * Consumed by BOTH:
 *   • Topbar   — compact persistent title in the top bar
 *   • Layout   — renders <PageHeader> (content H1 + description) above the page
 *
 * Keeping one map guarantees the top bar and the page header can never diverge,
 * and eliminates the previous incomplete TITLES map that fell back to
 * "Switchboard" for /live-agents, /break-codes and the /reports/* routes.
 *
 * Keys are exact pathnames (react-router `useLocation().pathname`).
 */
export const PAGE_META = {
  '/':                       { title: 'Dashboard',       description: 'Live contact-center overview' },
  '/live-calls':             { title: 'Live Calls',      description: 'Calls in queue and in progress' },
  '/live-agents':            { title: 'Live Agents',     description: 'Real-time agent states and durations' },
  '/agents':                 { title: 'Agents',          description: 'Roster, status and Avaya extension mapping' },
  '/queues':                 { title: 'Queues',          description: 'ACD queues, strategy and tiers' },
  '/queue-stats':            { title: 'Queue Stats',     description: 'Live per-queue statistics' },
  '/reports':                { title: 'Reports',         description: 'Historical queue and agent performance' },
  '/reports/break-history':  { title: 'Break History',   description: 'Agent break sessions and durations' },
  '/reports/call-history':   { title: 'Call History',    description: 'Detailed call detail records (CDR)' },
  '/break-codes':            { title: 'Break Codes',     description: 'Configurable agent break reasons' },
  '/users':                  { title: 'User Management', description: 'Admin and supervisor accounts' },
};

/** Resolve meta for a pathname, with a safe generic fallback (no more "Switchboard"). */
export function pageMetaFor(pathname) {
  return PAGE_META[pathname] || { title: 'Contact Center', description: '' };
}
