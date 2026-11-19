/**
 * CP3-B — customer telephony mode + per-agent browser-phone rule.
 * Covers design-addendum scenarios 1, 5, 6, 7 (rule level) and 15 (config).
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/telephonyRules.test.js
 */
import { describe, it, expect } from 'vitest';
import { effectiveWebrtc, modeAllowsWebrtc, parseInternalContact } from '../../../utils/telephony.js';
import { telephonyConfigErrors, TELEPHONY_MODES } from '../../../config/index.js';

const internalOn  = { agent_type: 'internal', webrtc_enabled: true,  active: true, contact: '{sip_cid_type=pid}user/1001@pbx.example' };
const internalOff = { ...internalOn, webrtc_enabled: false };
const gateway     = { agent_type: 'gateway', webrtc_enabled: true, active: true, contact: '{sip_cid_type=pid}sofia/gateway/sp/0500000000' };

describe('parseInternalContact', () => {
  it('reads the extension from the canonical internal contact', () => {
    expect(parseInternalContact('{sip_cid_type=pid}user/1001@pbx.example')).toEqual({ extension: '1001', domain: 'pbx.example' });
  });
  it('accepts several {..} prefix blocks (ring timeout)', () => {
    expect(parseInternalContact('{sip_cid_type=pid}{leg_timeout=20}user/42@d')).toEqual({ extension: '42', domain: 'd' });
  });
  it('rejects gateway contacts and junk', () => {
    expect(parseInternalContact(gateway.contact)).toBeNull();
    expect(parseInternalContact('user/abc@d')).toBeNull();
    expect(parseInternalContact(null)).toBeNull();
  });
});

describe('effectiveWebrtc — customer mode always wins', () => {
  it('EXTERNAL_PBX prohibits even an enabled internal agent (scenario 1)', () => {
    expect(effectiveWebrtc(internalOn, 'EXTERNAL_PBX')).toEqual({ allowed: false, reason: 'MODE_PROHIBITS' });
  });
  for (const mode of ['FREESWITCH_WEBRTC', 'HYBRID']) {
    it(`${mode}: enabled internal agent allowed, with extension`, () => {
      expect(effectiveWebrtc(internalOn, mode)).toEqual({ allowed: true, extension: '1001' });
    });
    it(`${mode}: internal agent not enabled is refused (scenario 5)`, () => {
      expect(effectiveWebrtc(internalOff, mode).allowed).toBe(false);
    });
    it(`${mode}: gateway agent always refused, even if flagged (scenario 6)`, () => {
      expect(effectiveWebrtc(gateway, mode)).toEqual({ allowed: false, reason: 'NOT_INTERNAL' });
    });
    it(`${mode}: inactive agent refused`, () => {
      expect(effectiveWebrtc({ ...internalOn, active: false }, mode).allowed).toBe(false);
    });
  }
  it('HYBRID mixed population: only the enabled internal agent gets the phone (scenario 7)', () => {
    const results = [gateway, internalOff, internalOn].map((a) => effectiveWebrtc(a, 'HYBRID').allowed);
    expect(results).toEqual([false, false, true]);
  });
  it('unknown mode is treated as prohibited', () => {
    expect(modeAllowsWebrtc('SOMETHING')).toBe(false);
    expect(modeAllowsWebrtc(undefined)).toBe(false);
  });
});

describe('telephonyConfigErrors (scenario 15)', () => {
  const base = { mode: 'EXTERNAL_PBX', relayUpstreamUrl: '', ticketTtlMs: 30000, graceMs: 15000 };
  it('lists exactly the three modes', () => {
    expect(TELEPHONY_MODES).toEqual(['EXTERNAL_PBX', 'FREESWITCH_WEBRTC', 'HYBRID']);
  });
  it('EXTERNAL_PBX needs no relay URL', () => {
    expect(telephonyConfigErrors(base)).toEqual([]);
  });
  it('rejects an invalid mode', () => {
    expect(telephonyConfigErrors({ ...base, mode: 'AVAYA' })[0]).toMatch(/TELEPHONY_MODE="AVAYA" is invalid/);
  });
  it('a WebRTC mode without SIP_RELAY_UPSTREAM_URL is refused', () => {
    expect(telephonyConfigErrors({ ...base, mode: 'HYBRID' }).join()).toMatch(/SIP_RELAY_UPSTREAM_URL is required/);
  });
  it('a WebRTC mode with a non-WebSocket URL is refused', () => {
    expect(telephonyConfigErrors({ ...base, mode: 'HYBRID', relayUpstreamUrl: 'http://x' }).join()).toMatch(/must start with wss/);
  });
  it('a WebRTC mode with a wss URL is valid', () => {
    expect(telephonyConfigErrors({ ...base, mode: 'FREESWITCH_WEBRTC', relayUpstreamUrl: 'wss://fs.example:7443' })).toEqual([]);
  });
  it('rejects out-of-range ticket TTL and grace', () => {
    const e = telephonyConfigErrors({ ...base, ticketTtlMs: 1000, graceMs: 999999 }).join();
    expect(e).toMatch(/WEBRTC_TICKET_TTL_MS/);
    expect(e).toMatch(/WEBRTC_GRACE_MS/);
  });
});
