import * as wrapup from '../services/wrapupService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Agent-desk wrap-up (M1): outcome + notes for the agent's own answered queue calls,
// and "Ready now". Always scoped to req.agentId (agent JWT); never trusts an agent id
// from the request body.
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/agent-desk/wrapup
// Recent answered queue calls (newest first) with their saved outcome (or null) and
// the outcomes each call's queue offers.
export async function agentWrapups(req, res) {
  const calls = await wrapup.recentWrapups(req.agentId);
  res.json({ calls, notes_max: wrapup.NOTES_MAX });
}

// POST /api/agent-desk/calls/:callUuid/wrapup   { code, notes? }
export async function agentSaveWrapup(req, res) {
  const { code, notes } = req.body || {};
  const r = await wrapup.saveWrapup({ agentId: req.agentId, callUuid: req.params.callUuid, code, notes });
  if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r.wrapup);
}

// POST /api/agent-desk/wrapup/ready
export async function agentReadyNow(req, res) {
  const r = await wrapup.readyNow(req.agentId);
  if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json({ ready: true, already_ready: r.alreadyReady });
}
