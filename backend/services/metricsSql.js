/**
 * metricsSql.js — canonical contact-center metric SQL fragments.
 *
 * PURPOSE (Phase 3A — extraction only, NO semantic change)
 * ---------------------------------------------------------
 * Single source of truth for the small SQL predicates that were duplicated
 * verbatim across the metric queries (dashboard, queue stats, queue-performance
 * report, CDR, exports). Each helper returns a SQL string fragment that is
 * CHARACTER-IDENTICAL to what the controllers previously inlined, so endpoint
 * behavior is unchanged — this is a refactor, not a redesign.
 *
 * WHAT IS CENTRALIZED HERE (safely, because the text is identical everywhere):
 *   • answered(alias)         → the "answered call" predicate
 *   • abandoned(alias)        → the caller-abandonment predicate
 *   • agentMissedExists(...)  → "an offered agent did not answer" existence test
 *   • abandonedAgent / abandonedQueue → the mutually-exclusive split over
 *                               abandoned=true, keyed on missed (NOT bare EXISTS)
 *
 * WHAT IS **NOT** UNIFIED HERE (intentionally left in the controllers):
 *   • SLA — there are currently FOUR different implementations that differ in
 *     threshold source (q.max_wait_time vs COALESCE(subquery,300)), join
 *     (INNER vs none), inline date predicates, and cast (::INT vs ::NUMERIC(5,1)):
 *       - statsController.getDashboardStats      (global, INNER JOIN, ::INT)
 *       - statsController.getQueueStats          (per-queue, date-in-FILTER)
 *       - reportsController.queuePerformance     (per-queue, COALESCE(...,300))
 *       - agentDeskController.agentQueues        (per-queue, date-in-FILTER)
 *     These are NOT the same formula. Unifying them is a business decision and is
 *     deferred to Phase 3E. They still consume the shared answered/abandoned
 *     predicates below, but their surrounding structure is left untouched.
 *   • ASA / avg-wait — the `wait_seconds >= 0` refilter exists on the dashboard
 *     and queue-stats variants but NOT on queue-performance. That discrepancy is
 *     preserved (not normalized) per the Phase 2 audit.
 *   • Talk-time — reportsController, agentReportService and agentDeskController
 *     use genuinely different denominators / date fields / zero-duration filters.
 *     They are deferred to Phase 3D and remain separate.
 *
 * All helpers take the table alias(es) as arguments so the exact same text can be
 * reproduced wherever the query uses `c` / `ah` (the aliases every current
 * consumer already uses).
 */

/** "answered call" — the call-level handled predicate. */
export const answered = (c = 'c') => `${c}.disposition = 'answered'`;

/** "caller abandoned" — the direct caller-abandonment predicate. */
export const abandoned = (c = 'c') => `${c}.abandoned = true`;

/**
 * "an agent was offered this call and did not answer" existence test.
 * Keyed on `missed = true` (NOT a bare EXISTS on call_uuid) so a stale offering
 * row (missed=false) never makes an abandoned call vanish from both buckets.
 * Returns the full `EXISTS ( ... )` expression.
 */
export const agentMissedExists = (c = 'c', ah = 'ah') =>
  `EXISTS (SELECT 1 FROM agent_history ${ah} WHERE ${ah}.call_uuid = ${c}.call_uuid AND ${ah}.missed = true)`;

/**
 * abandoned_agent — abandoned AND an offered agent missed it.
 * (Mutually exclusive with abandonedQueue over abandoned=true.)
 */
export const abandonedAgent = (c = 'c', ah = 'ah') =>
  `${abandoned(c)} AND ${agentMissedExists(c, ah)}`;

/**
 * abandoned_queue — abandoned AND NO offered agent missed it (queue-only).
 * Complement of abandonedAgent, so abandonedQueue + abandonedAgent === abandoned.
 */
export const abandonedQueue = (c = 'c', ah = 'ah') =>
  `${abandoned(c)} AND NOT ${agentMissedExists(c, ah)}`;
