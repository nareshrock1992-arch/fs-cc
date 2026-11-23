/**
 * CP3-C — SIP-over-WebSocket frame validation (sipFrame.js).
 * Run: cd backend && npx vitest run src/__tests__/unit/sipFrame.test.js
 */
import { describe, it, expect } from 'vitest';
import { parseSipFrame, checkOutboundFrame, uriUser, isKeepAlive, registerExpires } from '../../../services/sipFrame.js';
import { sipRequest } from '../helpers/sipMessages.js';

describe('parseSipFrame', () => {
  it('parses a REGISTER request', () => {
    const p = parseSipFrame(sipRequest('REGISTER'));
    expect(p).toMatchObject({ ok: true, kind: 'request', method: 'REGISTER', cseqMethod: 'REGISTER' });
  });
  it('parses a response and its CSeq method', () => {
    const p = parseSipFrame('SIP/2.0 401 Unauthorized\r\nCSeq: 1 REGISTER\r\nCall-ID: x\r\n\r\n');
    expect(p).toMatchObject({ ok: true, kind: 'response', status: 401, cseqMethod: 'REGISTER' });
  });
  it('understands compact header names', () => {
    const t = 'OPTIONS sip:1001@d SIP/2.0\r\nv: SIP/2.0/WSS x;branch=z9hG4bK1\r\nf: <sip:1001@d>;tag=1\r\nt: <sip:1001@d>\r\ni: c\r\nCSeq: 1 OPTIONS\r\n\r\n';
    expect(checkOutboundFrame(t.replace('v:', 'Via:'), '1001').allow).toBe(true);
  });
  it.each([
    ['empty', ''],
    ['no terminator', 'REGISTER sip:d SIP/2.0\r\nVia: x'],
    ['bad start line', 'HELLO world\r\n\r\n'],
    ['unknown method', 'HACK sip:d SIP/2.0\r\nVia: a\r\nFrom: <sip:1@d>\r\nTo: <sip:1@d>\r\nCall-ID: c\r\nCSeq: 1 HACK\r\n\r\n'],
    ['missing headers', 'INVITE sip:1@d SIP/2.0\r\nVia: a\r\n\r\n'],
    ['malformed header', 'INVITE sip:1@d SIP/2.0\r\nnot-a-header\r\n\r\n'],
    ['folded header', 'INVITE sip:1@d SIP/2.0\r\nVia: a\r\n continued\r\n\r\n'],
    ['JSON payload', '{"type":"hello"}'],
  ])('rejects %s', (_n, text) => {
    expect(parseSipFrame(text).ok).toBe(false);
  });
  it('rejects oversized header sections', () => {
    const big = sipRequest('OPTIONS', { extra: [`X-Pad: ${'a'.repeat(17_000)}`] });
    expect(parseSipFrame(big)).toEqual({ ok: false, error: 'headers too large' });
  });
});

describe('checkOutboundFrame — identity binding', () => {
  it('keep-alives pass', () => {
    expect(isKeepAlive('\r\n\r\n')).toBe(true);
    expect(checkOutboundFrame('\r\n\r\n', '1001').allow).toBe(true);
  });
  it('REGISTER for own extension passes; with auth username = own extension passes', () => {
    expect(checkOutboundFrame(sipRequest('REGISTER'), '1001').allow).toBe(true);
    expect(checkOutboundFrame(sipRequest('REGISTER', { auth: '1001' }), '1001').allow).toBe(true);
  });
  it('REGISTER for another extension is blocked (From, To or digest username)', () => {
    expect(checkOutboundFrame(sipRequest('REGISTER', { from: '1002' }), '1001')).toMatchObject({ allow: false, code: 4403 });
    expect(checkOutboundFrame(sipRequest('REGISTER', { from: '1001', to: '1002' }), '1001').allow).toBe(false);
    expect(checkOutboundFrame(sipRequest('REGISTER', { auth: '1002' }), '1001').reason).toMatch(/authorization/);
  });
  it('new outbound INVITE must come from own extension', () => {
    expect(checkOutboundFrame(sipRequest('INVITE', { from: '1001', to: '5000' }), '1001').allow).toBe(true);
    expect(checkOutboundFrame(sipRequest('INVITE', { from: '1002', to: '5000' }), '1001').allow).toBe(false);
  });
  it('in-dialog BYE on an inbound call (agent is To) passes; unrelated dialog is blocked', () => {
    expect(checkOutboundFrame(sipRequest('BYE', { from: '0500000000', to: '1001', toTag: true }), '1001').allow).toBe(true);
    expect(checkOutboundFrame(sipRequest('BYE', { from: '0500000000', to: '1002', toTag: true }), '1001').allow).toBe(false);
  });
  it('in-dialog request on a call sent to the random contact user passes only for a known Call-ID', () => {
    const bye = sipRequest('BYE', { from: 'i5gk7ss1', to: '1002', toTag: true, callId: 'in-1' });
    expect(checkOutboundFrame(bye, '1003')).toMatchObject({ allow: false, code: 4403 });
    expect(checkOutboundFrame(bye, '1003', (id) => id === 'in-1').allow).toBe(true);
    expect(checkOutboundFrame(bye, '1003', (id) => id === 'other').allow).toBe(false);
  });
  it('a known Call-ID never relaxes identity checks', () => {
    const known = () => true;
    expect(checkOutboundFrame(sipRequest('REGISTER', { from: '1002' }), '1003', known).allow).toBe(false);
    expect(checkOutboundFrame(sipRequest('INVITE', { from: '1002', to: '5000' }), '1003', known).allow).toBe(false);
    expect(checkOutboundFrame(sipRequest('BYE', { from: 'x', to: '1002', toTag: true, auth: '1002' }), '1003', known).allow).toBe(false);
  });
  it('responses (e.g. 200 OK to an inbound INVITE) pass', () => {
    expect(checkOutboundFrame('SIP/2.0 200 OK\r\nCSeq: 1 INVITE\r\nCall-ID: c\r\n\r\n', '1001').allow).toBe(true);
  });
  it('invalid payloads are blocked with 4400', () => {
    expect(checkOutboundFrame('garbage', '1001')).toMatchObject({ allow: false, code: 4400 });
  });
});

describe('helpers', () => {
  it('uriUser', () => {
    expect(uriUser('"A" <sip:1001@d>;tag=1')).toBe('1001');
    // Percent-encoding is decoded, so "%31%30%30%32" cannot sneak past as 1002.
    expect(uriUser('<sips:%31001@d>')).toBe('1001');
    expect(checkOutboundFrame(sipRequest('REGISTER').replace(/sip:1001@/g, 'sip:%31%30%30%32@'), '1001').allow).toBe(false);
    expect(uriUser('<tel:+1>')).toBeNull();
  });
  it('registerExpires reads Contact expires then Expires header', () => {
    const r = (h) => parseSipFrame(`SIP/2.0 200 OK\r\nCSeq: 1 REGISTER\r\n${h}\r\n\r\n`);
    expect(registerExpires(r('Contact: <sip:x@y>;expires=300'))).toBe(300);
    expect(registerExpires(r('Expires: 0'))).toBe(0);
    expect(registerExpires(r('X: y'))).toBeNull();
  });
});
