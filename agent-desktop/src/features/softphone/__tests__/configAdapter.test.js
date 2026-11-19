import { describe, expect, it } from 'vitest';
import {
  buildAppConfig,
  buildCredentials,
  getSoftphoneEligibility,
  isWebrtcEnabled,
  parseInternalContact,
  serverAllowsWebrtc,
} from '../adapters/configAdapter';

describe('parseInternalContact (display only)', () => {
  it.each([
    ['{sip_cid_type=pid}user/1000@172.21.20.57', '1000', '172.21.20.57'],
    ['{sip_cid_type=pid,leg_timeout=10}user/1001@172.21.20.57', '1001', '172.21.20.57'],
    ['{sip_cid_type=pid}{leg_timeout=10}user/1003@pbx.local', '1003', 'pbx.local'],
    ['user/1004@pbx.local', '1004', 'pbx.local'],
    ['  user/7990001@192.168.1.124  ', '7990001', '192.168.1.124'],
  ])('parses %s', (contact, extension, domain) => {
    expect(parseInternalContact(contact)).toEqual({ extension, domain });
  });

  it.each([
    'sofia/default/1', 'sofia/gateway/avaya/5551234', 'user/abc@x', 'user/1@x', 'user/1000',
    'user/1000@a,user/1001@b', '', null, undefined, 42,
  ])('rejects %s', (contact) => {
    expect(parseInternalContact(contact)).toBeNull();
  });
});

describe('server decides who may use the browser phone (CP3-E)', () => {
  const internal = { contact: '{sip_cid_type=pid}user/1002@x' };

  it('reads /me.webrtc_allowed or the login response agent.webrtc.allowed', () => {
    expect(serverAllowsWebrtc({ webrtc_allowed: true })).toBe(true);
    expect(serverAllowsWebrtc({ webrtc_allowed: false, webrtc: { allowed: true } })).toBe(false);
    expect(serverAllowsWebrtc({ webrtc: { allowed: true } })).toBe(true);
    expect(serverAllowsWebrtc({})).toBe(false);
    expect(serverAllowsWebrtc(null)).toBe(false);
  });

  it('allowed internal agent is eligible; extension shown from the contact', () => {
    expect(getSoftphoneEligibility({ ...internal, webrtc_allowed: true })).toEqual({ eligible: true, extension: '1002' });
  });

  it('internal agent NOT allowed by the server (EXTERNAL_PBX / switch off) is not eligible', () => {
    const r = getSoftphoneEligibility({ ...internal, webrtc_allowed: false });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/not enabled/);
    expect(getSoftphoneEligibility(internal).eligible).toBe(false); // unknown = not allowed
  });

  it('gateway agent is never eligible, even if a flag says otherwise', () => {
    const r = getSoftphoneEligibility({ contact: 'sofia/gateway/gw1/0501234567', webrtc_allowed: true });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/Gateway/);
  });

  it('missing agent is not eligible', () => {
    expect(getSoftphoneEligibility(null).eligible).toBe(false);
  });
});

describe('isWebrtcEnabled (installation kill switch)', () => {
  it('on unless explicitly "false"', () => {
    expect(isWebrtcEnabled({})).toBe(true);
    expect(isWebrtcEnabled({ VITE_WEBRTC_ENABLED: 'true' })).toBe(true);
    expect(isWebrtcEnabled({ VITE_WEBRTC_ENABLED: 'false' })).toBe(false);
  });
});

describe('buildAppConfig', () => {
  it('has no built-in domain or WSS URL (direct FreeSWITCH path removed)', () => {
    expect(buildAppConfig({ VITE_SIP_DOMAIN: '192.168.1.124', VITE_SIP_WSS_URL: 'wss://192.168.1.124:7443' })).toEqual({
      config: { defaultDomain: '', defaultWssUrl: '', registerExpires: 300, iceGatheringTimeoutMs: 1000, iceServers: [] },
    });
  });
  it('kill switch off → no config and a clear message', () => {
    const r = buildAppConfig({ VITE_WEBRTC_ENABLED: 'false' });
    expect(r.config).toBeNull();
    expect(r.error).toMatch(/switched off/);
  });
});

describe('buildCredentials (from the relay ticket)', () => {
  const ticket = { ticket: 't', extension: '1000', sip_domain: 'pbx.example' };
  it('extension and domain come from the server ticket; password only from the agent', () => {
    const provider = async () => 'wss://x';
    const { credentials } = buildCredentials({ ticket, password: 'dummy-test-value', wssUrl: 'wss://cc/api/sip-relay?ticket=t', ticketProvider: provider, displayName: 'Agent One' });
    expect(credentials).toEqual({
      extension: '1000', password: 'dummy-test-value', domain: 'pbx.example',
      wssUrl: 'wss://cc/api/sip-relay?ticket=t', displayName: 'Agent One', ticketProvider: provider,
    });
  });
  it('refuses a ticket without extension or SIP domain', () => {
    expect(buildCredentials({ ticket: { ...ticket, extension: undefined }, password: 'p', wssUrl: 'wss://x' }).credentials).toBeNull();
    expect(buildCredentials({ ticket: { ...ticket, sip_domain: null }, password: 'p', wssUrl: 'wss://x' }).error).toMatch(/SIP domain/);
  });
});
