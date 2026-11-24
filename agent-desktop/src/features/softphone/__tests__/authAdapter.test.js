import { describe, expect, it, vi } from 'vitest';
import { relayUrlFor, createTicketProvider, requestTicket, ticketErrorMessage, isFatalTicketError } from '../adapters/authAdapter';
import { TicketError } from '../engine/src/types/phone';
import { redactUrl } from '../engine/src/utils/validation';

const T = { ticket: 'abc_DEF-123', extension: '1000', sip_domain: 'pbx.example', relay_path: '/api/sip-relay' };

describe('relayUrlFor — FS-CC relay, never FreeSWITCH directly', () => {
  it('dev: API base /api on the page origin', () => {
    expect(relayUrlFor(T, '/api', { href: 'https://desk.example:8080/' })).toBe('wss://desk.example:8080/api/sip-relay?ticket=abc_DEF-123');
  });
  it('behind nginx: /cc/api → /cc/api/sip-relay', () => {
    expect(relayUrlFor(T, '/cc/api', { href: 'https://cc.example/agent/' })).toBe('wss://cc.example/cc/api/sip-relay?ticket=abc_DEF-123');
  });
  it('absolute API base is honoured; http pages get ws://', () => {
    expect(relayUrlFor(T, 'https://api.example/cc/api', { href: 'https://x/' })).toBe('wss://api.example/cc/api/sip-relay?ticket=abc_DEF-123');
    expect(relayUrlFor(T, '/api', { href: 'http://localhost:8080/' })).toBe('ws://localhost:8080/api/sip-relay?ticket=abc_DEF-123');
  });
  it('the ticket is URL-encoded and required', () => {
    expect(relayUrlFor({ ticket: 'a b' }, '/api', { href: 'https://h/' })).toMatch(/ticket=a%20b$/);
    expect(() => relayUrlFor({}, '/api', { href: 'https://h/' })).toThrow(TicketError);
  });
});

describe('ticket errors', () => {
  it.each([[401, true], [403, true], [404, true], [429, false], [500, false], [undefined, false]])('status %s fatal=%s', (status, fatal) => {
    expect(isFatalTicketError({ status })).toBe(fatal);
  });
  it('plain-language messages', () => {
    expect(ticketErrorMessage({ status: 403 })).toMatch(/not enabled for you/);
    expect(ticketErrorMessage({ status: 429 })).toMatch(/Too many/);
    expect(ticketErrorMessage({})).toMatch(/Could not reach/);
  });
  it('requestTicket wraps failures in TicketError with the fatal flag', async () => {
    const err = await requestTicket(async () => { throw Object.assign(new Error('x'), { status: 403 }); }, 'connect').catch((e) => e);
    expect(err).toBeInstanceOf(TicketError);
    expect(err.fatal).toBe(true);
  });
});

describe('createTicketProvider — reconnects', () => {
  it('fetches a NEW ticket on every call (never reuses one)', async () => {
    let n = 0;
    const fetchTicket = vi.fn(async (kind) => ({ ...T, ticket: `t${++n}`, kind }));
    const provider = createTicketProvider({ fetchTicket, apiBase: '/api', extension: '1000', loc: { href: 'https://h/' } });
    const a = await provider('reconnect');
    const b = await provider('reconnect');
    expect(a).not.toBe(b);
    expect(fetchTicket).toHaveBeenCalledTimes(2);
    expect(fetchTicket).toHaveBeenCalledWith('reconnect');
  });
  it('extension changed by an admin → fatal (stop and sign in again)', async () => {
    const provider = createTicketProvider({ fetchTicket: async () => ({ ...T, extension: '2000' }), apiBase: '/api', extension: '1000', loc: { href: 'https://h/' } });
    const err = await provider('reconnect').catch((e) => e);
    expect(err.fatal).toBe(true);
  });
  it('permission removed (403) → fatal; rate limited (429) → temporary', async () => {
    const mk = (status) => createTicketProvider({ fetchTicket: async () => { throw Object.assign(new Error('x'), { status }); }, apiBase: '/api', extension: '1000', loc: { href: 'https://h/' } });
    expect((await mk(403)('reconnect').catch((e) => e)).fatal).toBe(true);
    expect((await mk(429)('reconnect').catch((e) => e)).fatal).toBe(false);
  });
});

describe('phone locked after refused passwords (lab 2026-11-24)', () => {
  const locked = Object.assign(new Error('Too many failed phone sign-ins. Check your phone password and try again in 4 minutes.'),
    { status: 429, code: 'PHONE_SIGNIN_LOCKED' });

  it('shows the server message (with minutes), not a certificate or network hint', () => {
    expect(ticketErrorMessage(locked)).toBe('Too many failed phone sign-ins. Check your phone password and try again in 4 minutes.');
    expect(ticketErrorMessage({ status: 429, code: 'PHONE_SIGNIN_LOCKED' })).toMatch(/^Too many failed phone sign-ins/);
  });

  it('is final: the desk stops reconnecting instead of knocking every few seconds', async () => {
    expect(isFatalTicketError(locked)).toBe(true);
    expect(isFatalTicketError({ status: 429 })).toBe(false);        // plain rate limit stays temporary
    const provider = createTicketProvider({ fetchTicket: vi.fn().mockRejectedValue(locked), apiBase: '/api', extension: '1000',
      loc: { href: 'https://desk.example/' } });
    const err = await provider('reconnect').catch((e) => e);
    expect(err).toBeInstanceOf(TicketError);
    expect(err.fatal).toBe(true);
    expect(err.message).toMatch(/try again in 4 minutes/);
  });
});

describe('redactUrl — tickets never reach logs or UI', () => {
  it('hides ticket values in URLs and in free text', () => {
    expect(redactUrl('wss://h/api/sip-relay?ticket=abc_DEF-123')).toBe('wss://h/api/sip-relay?ticket=***');
    expect(redactUrl('Connecting wss://h/x?a=1&ticket=SECRET&b=2 now')).toBe('Connecting wss://h/x?a=1&ticket=***&b=2 now');
    expect(redactUrl('WebSocket closed wss://h/x?ticket=SECRET (code: 1006)')).not.toContain('SECRET');
  });
});
