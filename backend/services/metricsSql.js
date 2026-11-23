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
 *   • slaPct(...)             → the ONE service-level formula (M2, owner decision
 *                               2026-11-23), used by the dashboard, queue stats,
 *                               queue-performance report + export and the Agent
 *                               Desktop queue cards.
 *
 * WHAT IS **NOT** UNIFIED HERE (intentionally left in the controllers):
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
 * Service level % — the single definition (M2, owner decision 2026-11-23):
 *   calls answered within the queue's service level target
 *   ÷ (answered calls + ALL abandoned calls)          (no short-abandon exclusion)
 * Rounded to one decimal. NULL when there are no answered or abandoned calls, so
 * screens show "—" instead of a fake 0 %. Must be used inside a grouped query.
 * @param {{ c?: string, thr: string, where?: string }} o
 *   thr   SQL expression for the threshold in seconds (e.g. 'q.sla_seconds')
 *   where optional extra condition applied to every count (e.g. a date range)
 */
export const slaPct = ({ c = 'c', thr, where } = {}) => {
  if (!thr) throw new Error('slaPct: thr is required');
  const w = where ? ` AND (${where})` : '';
  return `ROUND(100.0
    * COUNT(*) FILTER (WHERE ${answered(c)} AND ${c}.wait_seconds <= ${thr}${w})
    / NULLIF(COUNT(*) FILTER (WHERE ${answered(c)}${w})
           + COUNT(*) FILTER (WHERE ${abandoned(c)}${w}), 0), 1)`;
};

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
