// ─────────────────────────────────────────────────────────────────────────────
// Shared query helpers for paginated / date-filtered history endpoints.
// Keep pagination and date handling consistent (and safe) across agent and
// supervisor history APIs. All values are validated and pushed as bound
// parameters by the caller — these helpers never concatenate user input.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 200;

/**
 * Parse page/limit into a safe { page, limit, offset }.
 * page >= 1, 1 <= limit <= MAX_LIMIT (default 50).
 */
export function parsePagination(q = {}) {
  let page  = Number.parseInt(q.page, 10);
  let limit = Number.parseInt(q.limit, 10);
  if (!Number.isInteger(page)  || page  < 1) page  = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  return { page, limit, offset: (page - 1) * limit };
}

/** True if value is a parseable date. */
function isValidDate(v) {
  if (v == null || v === '') return false;
  const t = Date.parse(v);
  return !Number.isNaN(t);
}

/**
 * Build date-range SQL conditions for `column`, pushing bound params onto
 * `params`. Accepts start_date (inclusive) and end_date (inclusive). Invalid
 * dates are ignored (not an error) so a bad filter never leaks or throws.
 * Returns an array of condition strings to spread into the WHERE clause.
 */
export function applyDateRange(q = {}, params, column) {
  const conds = [];
  if (isValidDate(q.start_date)) {
    params.push(new Date(q.start_date).toISOString());
    conds.push(`${column} >= $${params.length}`);
  }
  if (isValidDate(q.end_date)) {
    params.push(new Date(q.end_date).toISOString());
    conds.push(`${column} <= $${params.length}`);
  }
  return conds;
}
