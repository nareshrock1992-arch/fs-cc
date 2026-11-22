import { query } from '../db/pool.js';
import { writeAudit, staffActor } from '../services/auditService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Disposition codes — the global catalog of call outcomes (M1 / CC-1), and which
// queues offer each code. Same lifecycle as break codes: never hard-deleted;
// deactivating hides a code from agents while saved outcomes keep their snapshot.
// System codes (is_system) are set by the backend only and cannot be changed here.
// Authorization: route layer, requirePermission('manage_dispositions').
// ─────────────────────────────────────────────────────────────────────────────

const CODE_RE = /^[A-Z0-9_]{2,64}$/;
const systemRefusal = { error: 'This is a system outcome and cannot be changed.', code: 'SYSTEM_DISPOSITION' };

function validatePayload(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.code !== undefined) {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!code) return { ok: false, error: 'code is required' };
    if (!CODE_RE.test(code)) return { ok: false, error: 'code must be 2–64 chars: A–Z, 0–9, underscore' };
    if (code.startsWith('SYSTEM_')) return { ok: false, error: 'codes starting with SYSTEM_ are reserved' };
    out.code = code;
  }
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name is required' };
    if (name.length > 128) return { ok: false, error: 'name must be at most 128 characters' };
    out.name = name;
  }
  if (body.description !== undefined) {
    const d = body.description === null ? null : String(body.description).trim();
    if (d && d.length > 2000) return { ok: false, error: 'description must be at most 2000 characters' };
    out.description = d || null;
  }
  if (body.display_order !== undefined) {
    const n = Number(body.display_order);
    if (!Number.isInteger(n) || n < 0 || n > 100000)
      return { ok: false, error: 'display_order must be an integer between 0 and 100000' };
    out.display_order = n;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active must be a boolean' };
    out.active = body.active;
  }
  return { ok: true, value: out };
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const LIST_SQL = `
  SELECT d.id, d.code, d.name, d.description, d.active, d.display_order, d.is_system,
         d.created_by, d.updated_by, d.created_at, d.updated_at,
         COALESCE(array_agg(q.id ORDER BY q.name) FILTER (WHERE q.id IS NOT NULL), '{}') AS queue_ids,
         COALESCE(array_agg(q.name ORDER BY q.name) FILTER (WHERE q.id IS NOT NULL), '{}') AS queue_names
    FROM disposition_codes d
    LEFT JOIN queue_disposition_codes qdc ON qdc.disposition_code_id = d.id
    LEFT JOIN queues q ON q.id = qdc.queue_id`;

async function loadOne(id) {
  const { rows } = await query(`${LIST_SQL} WHERE d.id = $1 GROUP BY d.id`, [id]);
  return rows[0] || null;
}

// ── GET /api/disposition-codes ───────────────────────────────────────────────
// All codes (incl. inactive and system) with the queues that list each one, plus
// every active queue with the code ids it offers (empty = offers all active codes).
export async function listDispositionCodes(req, res) {
  const [{ rows: codes }, { rows: queues }] = await Promise.all([
    query(`${LIST_SQL} GROUP BY d.id ORDER BY d.is_system ASC, d.display_order ASC, d.name ASC`),
    query(`SELECT q.id, q.name, q.display_name,
                  COALESCE(array_agg(qdc.disposition_code_id ORDER BY qdc.disposition_code_id)
                           FILTER (WHERE qdc.disposition_code_id IS NOT NULL), '{}') AS code_ids
             FROM queues q
             LEFT JOIN queue_disposition_codes qdc ON qdc.queue_id = q.id
            WHERE q.active = true
            GROUP BY q.id
            ORDER BY q.name`),
  ]);
  res.json({ codes, queues });
}

// ── POST /api/disposition-codes ──────────────────────────────────────────────
export async function createDispositionCode(req, res) {
  const v = validatePayload(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  const p = v.value;
  const { actor, actorRole } = staffActor(req);
  try {
    const { rows } = await query(
      `INSERT INTO disposition_codes (code, name, description, display_order, active, created_by, updated_by)
       VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,true),$6,$6)
       RETURNING id`,
      [p.code, p.name, p.description ?? null, p.display_order ?? null, p.active ?? null, actor]
    );
    const created = await loadOne(rows[0].id);
    await writeAudit({ actor, actorRole, action: 'DISPOSITION_CODE_CREATED',
      entityType: 'disposition_code', entityId: created.code, newValue: created });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An outcome with that code already exists' });
    throw err;
  }
}

// ── PUT /api/disposition-codes/:id ───────────────────────────────────────────
export async function updateDispositionCode(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid outcome id' });
  const v = validatePayload(req.body || {}, { partial: true });
  if (!v.ok) return res.status(400).json({ error: v.error });
  const p = v.value;
  if (Object.keys(p).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  const before = await loadOne(id);
  if (!before) return res.status(404).json({ error: 'Outcome not found' });
  if (before.is_system) return res.status(403).json(systemRefusal);

  const { actor, actorRole } = staffActor(req);
  const cols = []; const vals = []; let i = 1;
  for (const [k, val] of Object.entries(p)) { cols.push(`${k} = $${i++}`); vals.push(val); }
  cols.push(`updated_by = $${i++}`); vals.push(actor);
  vals.push(id);
  try {
    await query(`UPDATE disposition_codes SET ${cols.join(', ')} WHERE id = $${i}`, vals);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An outcome with that code already exists' });
    throw err;
  }
  const after = await loadOne(id);
  await writeAudit({ actor, actorRole, action: 'DISPOSITION_CODE_UPDATED',
    entityType: 'disposition_code', entityId: after.code, oldValue: before, newValue: after });
  res.json(after);
}

// ── PATCH /api/disposition-codes/:id/status ──────────────────────────────────
export async function setDispositionCodeStatus(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid outcome id' });
  const { active } = req.body || {};
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });

  const before = await loadOne(id);
  if (!before) return res.status(404).json({ error: 'Outcome not found' });
  if (before.is_system) return res.status(403).json(systemRefusal);

  const { actor, actorRole } = staffActor(req);
  await query(`UPDATE disposition_codes SET active = $2, updated_by = $3 WHERE id = $1`, [id, active, actor]);
  const after = await loadOne(id);
  await writeAudit({ actor, actorRole,
    action: active ? 'DISPOSITION_CODE_ACTIVATED' : 'DISPOSITION_CODE_DEACTIVATED',
    entityType: 'disposition_code', entityId: after.code,
    oldValue: { active: before.active }, newValue: { active } });
  res.json(after);
}

// ── PUT /api/disposition-codes/queues/:queueId ───────────────────────────────
// Replace the outcomes a queue offers. An empty list means "offer all active
// outcomes" (the default for every queue). System outcomes cannot be assigned.
export async function setQueueDispositions(req, res) {
  const queueId = parseId(req.params.queueId);
  if (!queueId) return res.status(400).json({ error: 'Invalid queue id' });
  const raw = req.body?.code_ids;
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'code_ids must be a list' });
  const codeIds = [...new Set(raw.map(Number))];
  if (codeIds.some((c) => !Number.isInteger(c) || c <= 0) || codeIds.length > 500)
    return res.status(400).json({ error: 'code_ids must be outcome ids' });

  const { rows: qRows } = await query(`SELECT id, name FROM queues WHERE id = $1`, [queueId]);
  const queue = qRows[0];
  if (!queue) return res.status(404).json({ error: 'Queue not found' });

  if (codeIds.length) {
    const { rows } = await query(
      `SELECT id FROM disposition_codes WHERE id = ANY($1::int[]) AND is_system = false`, [codeIds]);
    if (rows.length !== codeIds.length)
      return res.status(400).json({ error: 'Unknown or system outcome in code_ids' });
  }

  const { rows: beforeRows } = await query(
    `SELECT disposition_code_id FROM queue_disposition_codes WHERE queue_id = $1 ORDER BY 1`, [queueId]);

  // Two idempotent statements (re-running converges on the requested set).
  await query(
    `DELETE FROM queue_disposition_codes
      WHERE queue_id = $1 AND NOT (disposition_code_id = ANY($2::int[]))`,
    [queueId, codeIds]
  );
  if (codeIds.length) {
    await query(
      `INSERT INTO queue_disposition_codes (queue_id, disposition_code_id)
       SELECT $1, unnest($2::int[])
       ON CONFLICT DO NOTHING`,
      [queueId, codeIds]
    );
  }

  const { actor, actorRole } = staffActor(req);
  await writeAudit({ actor, actorRole, action: 'QUEUE_DISPOSITIONS_SET',
    entityType: 'queue', entityId: queue.name,
    oldValue: { code_ids: beforeRows.map((r) => r.disposition_code_id) },
    newValue: { code_ids: [...codeIds].sort((a, b) => a - b) } });
  res.json({ queue_id: queueId, code_ids: [...codeIds].sort((a, b) => a - b) });
}
