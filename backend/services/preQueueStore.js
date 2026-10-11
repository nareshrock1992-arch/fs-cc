// ─────────────────────────────────────────────────────────────────────────────
// Pre-queue live store (Phase 1A — IVR & Pre-Queue Monitor)
//
// Holds the ACTIVE, OBSERVED pre-queue caller state that the existing FS-CC ESL
// listener already sees (IVR app executions + DTMF) BEFORE a caller enters a real
// mod_callcenter queue. This is a live, ephemeral, process-local view — NOT a
// synthetic queue and NOT a durable record. It is deliberately pure and
// dependency-free (no DB, no ESL, no timers) so it is fully unit-testable; the
// ESL service drives it and owns all side effects (event emission, the TTL
// sweep interval, reconnect reset).
//
// Identity: keyed by the FreeSWITCH channel Unique-ID (the same key as the
// existing ivrBuffer and the calls.vdn column). At real queue entry the caller
// is handed off to the normal calls row (correlated to CC-Member-UUID) and
// removed here, so a caller is never in both the pre-queue list and the queue
// list at once.
//
// IMPORTANT: observing an IVR step NEVER implies the caller is eligible or that
// a transfer succeeded. Eligibility reason / target queue / transfer success are
// deliberately NOT stored here (see the Phase-1A report, "eligibility gap").
// ─────────────────────────────────────────────────────────────────────────────

// Default stale TTL. A pre-queue entry whose last observed activity is older
// than this is swept from the ACTIVE list. A TTL expiry is a loss-of-visibility
// cleanup, NOT a confirmed hangup — it is reported with reason "stale", distinct
// from the "hangup" (CHANNEL_HANGUP_COMPLETE) and "enqueued" (member-queue-start)
// transitions.
export const PREQUEUE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const entries = new Map(); // chanUuid → entry

function iso(ms) { return new Date(ms).toISOString(); }

// Observe IVR / pre-queue activity for a channel. Idempotent: repeated events
// for the same channel update the SAME entry in place (no duplicate rows).
// `stageSince` only advances when the observable stage actually changes, so
// "time in current stage" is measured from the real stage transition.
export function observe(chanUuid, { ani = null, dnis = null, stage = null, now = Date.now() } = {}) {
  if (!chanUuid) return null;
  let e = entries.get(chanUuid);
  if (!e) {
    e = {
      chanUuid,
      ani: ani || null,
      dnis: dnis || null,
      stage: stage || null,
      firstSeen: now,
      lastUpdate: now,
      stageSince: now,
      status: 'active',
    };
    entries.set(chanUuid, e);
    return e;
  }
  // Update existing entry in place (dedupe-safe).
  if (ani && !e.ani) e.ani = ani;
  if (dnis && !e.dnis) e.dnis = dnis;
  if (stage != null && stage !== e.stage) {
    e.stage = stage;
    e.stageSince = now;
  }
  e.lastUpdate = now;
  return e;
}

// Caller reached a real mod_callcenter queue (member-queue-start). Remove from
// the active pre-queue list; the caller now lives as a normal calls row,
// correlated via CC-Member-UUID. Returns the removed entry (for logging) or null.
export function handoff(chanUuid, { callUuid = null, queueName = null, now = Date.now() } = {}) {
  const e = entries.get(chanUuid);
  if (!e) return null;
  entries.delete(chanUuid);
  return { ...e, status: 'enqueued', callUuid, queueName, removedAt: now };
}

// Channel hung up before queue entry (CHANNEL_HANGUP_COMPLETE). Returns the
// removed entry or null.
export function remove(chanUuid, { reason = 'hangup', now = Date.now() } = {}) {
  const e = entries.get(chanUuid);
  if (!e) return null;
  entries.delete(chanUuid);
  return { ...e, status: reason, removedAt: now };
}

// Sweep entries with no activity within ttlMs. Returns the removed chanUuids
// (so the caller can emit a "stale" removal for each). Not a hangup.
export function sweepStale(now = Date.now(), ttlMs = PREQUEUE_TTL_MS) {
  const removed = [];
  for (const [chanUuid, e] of entries) {
    if (now - e.lastUpdate >= ttlMs) {
      entries.delete(chanUuid);
      removed.push(chanUuid);
    }
  }
  return removed;
}

export function get(chanUuid) { return entries.get(chanUuid) || null; }
export function listActive() { return Array.from(entries.values()); }
export function size() { return entries.size; }

// Drop all state. Used on an ESL reconnect (the previous connection's live view
// is stale; it rebuilds from the resuming event stream) and by tests.
export function clear() { entries.clear(); }

// ── Caller-identifier masking ────────────────────────────────────────────────
// No caller-ID permission exists in the project today (VALID_PERMISSIONS =
// view_reports, change_agent_state, manage_break_codes). Per the Phase-1A
// security rule, the caller identifier is masked BY DEFAULT everywhere. A future
// phase may introduce a verified `view_caller_id` permission to reveal it.
export function maskAni(ani) {
  if (!ani) return null;
  const s = String(ani);
  if (s.length <= 3) return '•••';
  return '•'.repeat(s.length - 2) + s.slice(-2);
}

// Safe short display id derived from the channel UUID (not caller PII).
export function safeId(chanUuid) {
  return chanUuid ? String(chanUuid).slice(0, 8) : null;
}

// Masked, PII-safe projection for API responses and supervisor socket payloads.
//
// callerMasked is ALWAYS masked. The full caller number is included (as `caller`)
// ONLY when the caller explicitly passes { revealAni: true } — which the backend
// sets solely for users holding the `view_caller_id` permission. When not
// revealed, the raw ANI field is OMITTED ENTIRELY (never present as null or in
// any alternate field), so an unauthorized response carries no raw number.
export function publicView(e, { revealAni = false } = {}) {
  if (!e) return null;
  const out = {
    id: safeId(e.chanUuid),
    chanUuid: e.chanUuid,
    callerMasked: maskAni(e.ani),
    stage: e.stage || null,
    firstSeen: iso(e.firstSeen),
    stageSince: iso(e.stageSince),
    lastUpdate: iso(e.lastUpdate),
    // Deliberately-unknown fields (not observable/trustworthy in Phase 1A):
    eligibilityReason: null,
    targetQueue: null,
    transferSucceeded: null,
    flowName: null,
  };
  if (revealAni && e.ani) out.caller = String(e.ani); // full number, authorized only
  return out;
}
