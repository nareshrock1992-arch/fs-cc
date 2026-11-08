/**
 * configAdapter — turns FS-CC configuration and the signed-in agent into the
 * engine's AppConfig and Credentials.
 *
 * Rules (Phase 2 plan R-3, decisions Q14/E-5):
 *  - SIP domain and WSS URL come from build configuration, never from what the agent types.
 *  - The extension is derived from the agent's existing internal contact
 *    ("user/<ext>@<domain>", optionally with a "{...}" variable prefix). No new DB field.
 *  - Gateway (and any non-internal) contacts are not eligible for WebRTC.
 *  - The password is passed in by the caller and only ever placed in the Credentials
 *    object handed to the engine. It is never stored or logged here.
 */

/** Same limits as the engine's EXTENSION_PATTERN (2–15 digits). */
const INTERNAL_CONTACT = /^(?:\{[^}]*\})?user\/([0-9]{2,15})@([^\s,;{}]+)$/;

/**
 * Parse an FS-CC agent contact string.
 * @param {unknown} contact e.g. "{sip_cid_type=pid}user/1000@192.168.1.124"
 * @returns {{ extension: string, domain: string } | null}
 */
export function parseInternalContact(contact) {
  if (typeof contact !== 'string') return null;
  const match = INTERNAL_CONTACT.exec(contact.trim());
  return match ? { extension: match[1], domain: match[2] } : null;
}

/**
 * Whether this agent may use the browser softphone.
 * @param {{ contact?: string } | null | undefined} agent
 * @returns {{ eligible: boolean, extension?: string, reason?: string }}
 */
export function getSoftphoneEligibility(agent) {
  if (!agent) return { eligible: false, reason: 'Not signed in.' };
  const contact = agent.contact;
  if (typeof contact === 'string' && contact.includes('sofia/gateway/')) {
    return { eligible: false, reason: 'Gateway agents cannot use the browser phone.' };
  }
  const parsed = parseInternalContact(contact);
  if (!parsed) {
    return { eligible: false, reason: 'This agent has no internal extension for the browser phone.' };
  }
  return { eligible: true, extension: parsed.extension };
}

/** Build-time feature flag (R-4). Anything other than the exact string "true" is off. */
export function isWebrtcEnabled(env = import.meta.env) {
  return env?.VITE_WEBRTC_ENABLED === 'true';
}

/**
 * Engine AppConfig from FS-CC build configuration.
 * Unlike the engine's own loadConfig(), there is NO fallback to the page host name:
 * a missing domain or WSS URL is reported as a configuration error.
 * @returns {{ config: object | null, error?: string }}
 */
export function buildAppConfig(env = import.meta.env) {
  const domain = (env?.VITE_SIP_DOMAIN || '').trim();
  const wssUrl = (env?.VITE_SIP_WSS_URL || '').trim();
  if (!domain || !wssUrl) {
    return {
      config: null,
      error: 'Browser phone is not configured (VITE_SIP_DOMAIN / VITE_SIP_WSS_URL).',
    };
  }
  return {
    config: {
      defaultDomain: domain,
      defaultWssUrl: wssUrl,
      registerExpires: 300, // Q13: registration renewal 300 s
      iceGatheringTimeoutMs: 1000,
      iceServers: [],
    },
  };
}

/**
 * Engine Credentials for a login attempt.
 * @param {{ agent: object, password: string, config: object }} args
 * @returns {{ credentials: object | null, error?: string }}
 */
export function buildCredentials({ agent, password, config }) {
  const eligibility = getSoftphoneEligibility(agent);
  if (!eligibility.eligible) return { credentials: null, error: eligibility.reason };
  if (!config) return { credentials: null, error: 'Browser phone is not configured.' };
  return {
    credentials: {
      extension: eligibility.extension,
      password: typeof password === 'string' ? password : '',
      domain: config.defaultDomain,
      wssUrl: config.defaultWssUrl,
      displayName: agent.full_name || undefined,
    },
  };
}
