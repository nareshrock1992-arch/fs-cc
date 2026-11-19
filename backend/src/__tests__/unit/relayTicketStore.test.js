/**
 * CP3-B — single-use relay tickets and per-agent rate limit (scenarios 8, 9).
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/relayTicketStore.test.js
 */
import { describe, it, expect } from 'vitest';
import {
  createTicketStore, createAgentRateLimiter, ticketHint, MAX_LIVE_PER_AGENT,
} from '../../../services/relayTicketStore.js';

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

describe('ticket store', () => {
  it('issues a 256-bit base64url ticket bound to agent + extension', () => {
    const s = createTicketStore({ ttlMs: 30_000 });
    const { ticket, expiresInMs } = s.issue({ agentId: 'alice', extension: '1001' });
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresInMs).toBe(30_000);
    expect(s.consume(ticket)).toEqual({ agentId: 'alice', extension: '1001', kind: 'connect' });
  });

  it('is single use — replay is refused', () => {
    const s = createTicketStore();
    const { ticket } = s.issue({ agentId: 'alice', extension: '1001' });
    expect(s.consume(ticket)).not.toBeNull();
    expect(s.consume(ticket)).toBeNull();
  });

  it('expires after the TTL (30 s)', () => {
    const now = clock();
    const s = createTicketStore({ ttlMs: 30_000, now });
    const { ticket } = s.issue({ agentId: 'alice', extension: '1001' });
    now.advance(30_000);
    expect(s.consume(ticket)).toBeNull();
  });

  it('is still valid just before expiry', () => {
    const now = clock();
    const s = createTicketStore({ ttlMs: 30_000, now });
    const { ticket } = s.issue({ agentId: 'alice', extension: '1001' });
    now.advance(29_999);
    expect(s.consume(ticket)).not.toBeNull();
  });

  it('refuses unknown, empty and non-string tickets', () => {
    const s = createTicketStore();
    expect(s.consume('nope')).toBeNull();
    expect(s.consume('')).toBeNull();
    expect(s.consume(undefined)).toBeNull();
    expect(s.consume({})).toBeNull();
  });

  it('keeps reconnect kind and rejects unknown kinds', () => {
    const s = createTicketStore();
    const { ticket } = s.issue({ agentId: 'a', extension: '10', kind: 'reconnect' });
    expect(s.consume(ticket).kind).toBe('reconnect');
    expect(() => s.issue({ agentId: 'a', extension: '10', kind: 'admin' })).toThrow();
    expect(() => s.issue({ agentId: 'a' })).toThrow();
  });

  it(`caps live tickets per agent at ${MAX_LIVE_PER_AGENT} (oldest dropped)`, () => {
    const s = createTicketStore();
    const issued = Array.from({ length: MAX_LIVE_PER_AGENT + 2 }, () => s.issue({ agentId: 'alice', extension: '1001' }).ticket);
    expect(s.size()).toBe(MAX_LIVE_PER_AGENT);
    expect(s.consume(issued[0])).toBeNull();
    expect(s.consume(issued[issued.length - 1])).not.toBeNull();
  });

  it('revokeAgent invalidates only that agent (logout)', () => {
    const s = createTicketStore();
    const a = s.issue({ agentId: 'alice', extension: '1001' }).ticket;
    const b = s.issue({ agentId: 'bob', extension: '1002' }).ticket;
    expect(s.revokeAgent('alice')).toBe(1);
    expect(s.consume(a)).toBeNull();
    expect(s.consume(b)).not.toBeNull();
  });

  it('sweep removes expired tickets', () => {
    const now = clock();
    const s = createTicketStore({ ttlMs: 30_000, now });
    s.issue({ agentId: 'a', extension: '10' });
    now.advance(31_000);
    s.sweep();
    expect(s.size()).toBe(0);
  });

  it('ticketHint never reveals the full ticket', () => {
    const { ticket } = createTicketStore().issue({ agentId: 'a', extension: '10' });
    expect(ticketHint(ticket)).toBe(`ticket#${ticket.slice(0, 4)}…`);
    expect(ticketHint(ticket)).not.toContain(ticket.slice(4, 12));
  });
});

describe('per-agent rate limit (10 per minute)', () => {
  function res() {
    return { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  }
  it('allows 10 and refuses the 11th with 429', () => {
    const now = clock();
    const limit = createAgentRateLimiter({ max: 10, windowMs: 60_000, now });
    let passed = 0;
    for (let i = 0; i < 10; i++) limit({ agentId: 'alice' }, res(), () => passed++);
    const r = res();
    limit({ agentId: 'alice' }, r, () => passed++);
    expect(passed).toBe(10);
    expect(r.statusCode).toBe(429);
    expect(r.body.code).toBe('RATE_LIMITED');
    expect(Number(r.headers['Retry-After'])).toBeGreaterThan(0);
  });
  it('is per agent and resets after the window', () => {
    const now = clock();
    const limit = createAgentRateLimiter({ max: 10, windowMs: 60_000, now });
    for (let i = 0; i < 10; i++) limit({ agentId: 'alice' }, res(), () => {});
    let bob = 0; limit({ agentId: 'bob' }, res(), () => bob++);
    expect(bob).toBe(1);
    now.advance(60_001);
    let again = 0; limit({ agentId: 'alice' }, res(), () => again++);
    expect(again).toBe(1);
  });
});
