import { query } from '../db/pool.js';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/activity   (M2 Part B — Activity log, read-only)
//
// One list of "who changed what, when":
//   • audit_log           — settings changes (agents, users, break codes, outcomes, queues, agents in queues)
//   • supervisor_actions  — live actions on calls (e.g. force hang-up)
// Query params (all optional):
//   days   1..90   look-back window (default 7)
//   q      text    search in who / what / which item (case-insensitive)
//   limit  1..500  page size (default 100)   offset  ≥0
// Response: { rows: [...], hasMore }  newest first. Never returns secrets (none are stored).
// ─────────────────────────────────────────────────────────────────────────────

const clampInt = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
};
// Escape LIKE wildcards so a search for "100%" or "a_b" matches literally.
const likeTerm = (s) => `%${String(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listActivity(req, res) {
  const days   = clampInt(req.query.days, 7, 1, 90);
  const limit  = clampInt(req.query.limit, 100, 1, 500);
  const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
  const q      = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 100) : null;

  const { rows } = await query(
    `SELECT * FROM (
       SELECT 'setting'::text  AS kind, a.created_at AS at, a.actor, a.actor_role,
              a.action, a.entity_type, a.entity_id, a.old_value, a.new_value, NULL::text AS result
         FROM audit_log a
       UNION ALL
       SELECT 'call_action'::text, s.performed_at, s.performed_by, NULL,
              s.action, 'call', s.call_uuid, NULL, jsonb_build_object('agent_id', s.agent_id), s.result
         FROM supervisor_actions s
     ) x
     WHERE x.at >= now() - make_interval(days => $1::int)
       AND ($2::text IS NULL
            OR x.actor ILIKE $2 OR x.action ILIKE $2 OR x.entity_type ILIKE $2 OR x.entity_id ILIKE $2
            OR x.new_value::text ILIKE $2 OR x.old_value::text ILIKE $2)
     ORDER BY x.at DESC
     LIMIT $3 OFFSET $4`,
    [days, q ? likeTerm(q) : null, limit + 1, offset]
  );
  res.json({ rows: rows.slice(0, limit), hasMore: rows.length > limit });
}
