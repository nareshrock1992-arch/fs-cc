import { describe, expect, it } from 'vitest';
import {
  buildAppConfig,
  buildCredentials,
  getSoftphoneEligibility,
  isWebrtcEnabled,
  parseInternalContact,
} from '../adapters/configAdapter';

const ENV = { VITE_SIP_DOMAIN: '192.168.1.124', VITE_SIP_WSS_URL: 'wss://192.168.1.124:7443' };

describe('parseInternalContact', () => {
  it.each([
    ['{sip_cid_type=pid}user/1000@172.21.20.57', '1000', '172.21.20.57'],
    ['{sip_cid_type=pid,leg_timeout=10}user/1001@172.21.20.57', '1001', '172.21.20.57'],
    ['user/1004@pbx.local', '1004', 'pbx.local'],
    ['  user/7990001@192.168.1.124  ', '7990001', '192.168.1.124'],
  ])('parses %s', (contact, extension, domain) => {
    expect(parseInternalContact(contact)).toEqual({ extension, domain });
  });

  it.each([
    'sofia/default/1',
    'sofia/gateway/avaya/5551234',
    'user/abc@x',
    'user/1@x', // too short (engine requires 2–15 digits)
    'user/1000', // no domain
    'user/1000@a,user/1001@b', // multiple targets
    '',
    null,
    undefined,
    42,
  ])('rejects %s', (contact) => {
    expect(parseInternalContact(contact)).toBeNull();
  });
});

describe('getSoftphoneEligibility', () => {
  it('internal agent is eligible with the extension from the contact', () => {
    expect(getSoftphoneEligibility({ contact: '{sip_cid_type=pid}user/1002@x' })).toEqual({
      eligible: true,
      extension: '1002',
    });
  });

  it('gateway agent is not eligible', () => {
    const r = getSoftphoneEligibility({ contact: 'sofia/gateway/gw1/0501234567' });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/Gateway/);
  });

  it('other contacts and missing agent are not eligible', () => {
    expect(getSoftphoneEligibility({ contact: 'sofia/default/1' }).eligible).toBe(false);
    expect(getSoftphoneEligibility(null).eligible).toBe(false);
  });
});

describe('isWebrtcEnabled', () => {
  it('only the exact string "true" enables the feature', () => {
    expect(isWebrtcEnabled({ VITE_WEBRTC_ENABLED: 'true' })).toBe(true);
    for (const v of ['TRUE', '1', 'yes', '', undefined]) {
      expect(isWebrtcEnabled({ VITE_WEBRTC_ENABLED: v })).toBe(false);
    }
    expect(isWebrtcEnabled({})).toBe(false);
  });
});

describe('buildAppConfig', () => {
  it('uses configured domain and WSS URL with the agreed defaults', () => {
    expect(buildAppConfig(ENV)).toEqual({
      config: {
        defaultDomain: '192.168.1.124',
        defaultWssUrl: 'wss://192.168.1.124:7443',
        registerExpires: 300,
        iceGatheringTimeoutMs: 1000,
        iceServers: [],
      },
    });
  });

  it('reports an error instead of falling back to the page host', () => {
    expect(buildAppConfig({ VITE_SIP_DOMAIN: 'x' }).config).toBeNull();
    expect(buildAppConfig({ VITE_SIP_WSS_URL: 'wss://x' }).error).toMatch(/not configured/);
    expect(buildAppConfig({}).config).toBeNull();
  });
});

describe('buildCredentials', () => {
  const { config } = buildAppConfig(ENV);

  it('takes extension from the contact and domain/WSS from config (not from the contact)', () => {
    const { credentials } = buildCredentials({
      agent: { contact: '{sip_cid_type=pid}user/1000@172.21.20.57', full_name: 'Agent One' },
      password: 'dummy-test-value',
      config,
    });
    expect(credentials).toEqual({
      extension: '1000',
      password: 'dummy-test-value',
      domain: '192.168.1.124',
      wssUrl: 'wss://192.168.1.124:7443',
      displayName: 'Agent One',
    });
  });

  it('refuses ineligible agents and missing config', () => {
    expect(buildCredentials({ agent: { contact: 'sofia/gateway/g/1' }, password: 'p', config }).credentials).toBeNull();
    expect(buildCredentials({ agent: { contact: 'user/1000@x' }, password: 'p', config: null }).credentials).toBeNull();
  });
});
