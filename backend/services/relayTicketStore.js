/**
 * Single-use, short-lived tickets for the browser-phone SIP relay (CP3).
 *
 *  - 256-bit random value (base64url); stored only in memory in this process.
 *  - Bound to { agentId, extension, kind }.
 *  - consume() deletes the ticket on first lookup → replay is impossible.
 *  - Expired tickets are refused and swept.
 *  - At most MAX_LIVE_PER_AGENT unexpired tickets per agent (oldest dropped).
 *  - revokeAgent() invalidates every ticket of an agent (logout / permission change).
 *
 * Tickets are secrets: never log them. Use ticketHint() for diagnostics.
 * Single backend instance today (same assumption as loginLimiter.js); a shared
 * store would be needed if the backend is scaled horizontally.
 */
import crypto from 'node:crypto';

export const MAX_LIVE_PER_AGENT = 3;
const KINDS = new Set(['connect', 'reconnect']);

export function createTicketStore({ ttlMs = 30_000, now = Date.now, random = crypto.randomBytes } = {}) {
  const tickets = new Map(); // ticket -> { agentId, extension, kind, exp }

  function sweep() {
    const t = now();
    for (const [k, v] of tickets) if (v.exp <= t) tickets.delete(k);
  }

  function liveFor(agentId) {
    return [...tickets.entries()].filter(([, v]) => v.agentId === agentId);
  }

  function issue({ agentId, extension, kind = 'connect' }) {
    if (!agentId || !extension) throw new Error('agentId and extension are required');
    if (!KINDS.has(kind)) throw new Error('invalid ticket kind');
    sweep();
    const live = liveFor(agentId);
    // Map keeps insertion order → first entries are the oldest.
    for (let i = 0; i <= live.length - MAX_LIVE_PER_AGENT; i++) tickets.delete(live[i][0]);
    const ticket = random(32).toString('base64url');
    const exp = now() + ttlMs;
    tickets.set(ticket, { agentId, extension, kind, exp });
    return { ticket, expiresInMs: ttlMs };
  }

  /** Returns the binding and deletes the ticket, or null if unknown/used/expired. */
  function consume(ticket) {
    if (typeof ticket !== 'string' || !ticket) return null;
    const entry = tickets.get(ticket);
    if (!entry) return null;
    tickets.delete(ticket);
    if (entry.exp <= now()) return null;
    return { agentId: entry.agentId, extension: entry.extension, kind: entry.kind };
  }

  function revokeAgent(agentId) {
    let n = 0;
    for (const [k, v] of tickets) if (v.agentId === agentId) { tickets.delete(k); n++; }
    return n;
  }

  return { issue, consume, revokeAgent, sweep, size: () => tickets.size };
}

/** Safe diagnostic label: never the full ticket. */
export function ticketHint(ticket) {
  return typeof ticket === 'string' && ticket.length >= 4 ? `ticket#${ticket.slice(0, 4)}…` : 'ticket#?';
}

/**
 * Per-agent request limiter for the ticket endpoint: max `max` requests per
 * sliding `windowMs` (default 10 per minute). Counts every request.
 */
export function createAgentRateLimiter({ max = 10, windowMs = 60_000, now = Date.now } = {}) {
  const hits = new Map(); // agentId -> timestamps
  return function limit(req, res, next) {
    const key = req.agentId || 'unknown';
    const cutoff = now() - windowMs;
    const list = (hits.get(key) || []).filter((t) => t > cutoff);
    if (list.length >= max) {
      hits.set(key, list);
      const retryAfter = Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000));
      res.set?.('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many phone connection requests. Try again shortly.', code: 'RATE_LIMITED' });
    }
    list.push(now());
    hits.set(key, list);
    next();
  };
}

// Process-wide store used by the ticket endpoint and (CP3-C) the relay.
let shared = null;
export function getTicketStore(ttlMs) {
  if (!shared) {
    shared = createTicketStore({ ttlMs });
    setInterval(() => shared.sweep(), 30_000).unref?.();
  }
  return shared;
}
