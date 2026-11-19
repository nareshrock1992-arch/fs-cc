/**
 * configAdapter — browser-phone configuration and eligibility (CP3-E).
 *
 * Rules:
 *  - Whether an agent may use the browser phone is decided by the SERVER
 *    (`/me.webrtc_allowed`, login `agent.webrtc.allowed`): customer telephony mode,
 *    per-agent switch, internal-only, active. The browser never decides on its own.
 *  - Extension and SIP domain come from the server's relay ticket, never from
 *    what the agent types and never from build-time configuration.
 *  - There is no direct FreeSWITCH WSS URL any more (VITE_SIP_WSS_URL and
 *    VITE_SIP_DOMAIN are not used). The phone always goes through the FS-CC relay.
 *  - The password is passed in by the caller and only placed in the Credentials
 *    object handed to the engine. It is never stored or logged here.
 */

/** Same limits as the engine's EXTENSION_PATTERN (2–15 digits); display only. */
const INTERNAL_CONTACT = /^(?:\{[^}]*\})*user\/([0-9]{2,15})@([^\s,;{}]+)$/;

/**
 * Parse an FS-CC agent contact string (used only to SHOW the extension before sign-in).
 * @param {unknown} contact e.g. "{sip_cid_type=pid}user/1000@pbx.example"
 * @returns {{ extension: string, domain: string } | null}
 */
export function parseInternalContact(contact) {
  if (typeof contact !== 'string') return null;
  const match = INTERNAL_CONTACT.exec(contact.trim());
  return match ? { extension: match[1], domain: match[2] } : null;
}

/** The server's browser-phone permission for this agent (from /me or login). */
export function serverAllowsWebrtc(agent) {
  if (!agent) return false;
  if (typeof agent.webrtc_allowed === 'boolean') return agent.webrtc_allowed;
  return agent.webrtc?.allowed === true;
}

/**
 * Whether this agent may use the browser phone.
 * @returns {{ eligible: boolean, extension?: string, reason?: string }}
 */
export function getSoftphoneEligibility(agent) {
  if (!agent) return { eligible: false, reason: 'Not signed in.' };
  const contact = agent.contact;
  if (typeof contact === 'string' && contact.includes('sofia/gateway/')) {
    return { eligible: false, reason: 'Gateway agents use their desk phone, not the browser phone.' };
  }
  if (!serverAllowsWebrtc(agent)) {
    return { eligible: false, reason: 'The browser phone is not enabled for you. Use your desk phone.' };
  }
  const parsed = parseInternalContact(contact);
  return { eligible: true, extension: parsed?.extension };
}

/**
 * Build-time kill switch. The browser phone is ON unless the build sets
 * VITE_WEBRTC_ENABLED=false; the per-agent/customer decision is made at runtime.
 */
export function isWebrtcEnabled(env = import.meta.env) {
  return env?.VITE_WEBRTC_ENABLED !== 'false';
}

/** Engine AppConfig. No domain or WSS URL: both come from the relay ticket. */
export function buildAppConfig(env = import.meta.env) {
  if (!isWebrtcEnabled(env)) {
    return { config: null, error: 'The browser phone is switched off in this installation.' };
  }
  return {
    config: {
      defaultDomain: '',
      defaultWssUrl: '',
      registerExpires: 300, // Q13: registration renewal 300 s
      iceGatheringTimeoutMs: 1000,
      iceServers: [],
    },
  };
}

/**
 * Engine Credentials from a relay ticket response.
 * @param {{ ticket: object, password: string, displayName?: string, wssUrl: string, ticketProvider?: Function }} args
 */
export function buildCredentials({ ticket, password, displayName, wssUrl, ticketProvider }) {
  if (!ticket?.extension) return { credentials: null, error: 'The server did not return your phone extension.' };
  if (!ticket?.sip_domain) return { credentials: null, error: 'The browser phone is not configured on the server (SIP domain missing).' };
  return {
    credentials: {
      extension: String(ticket.extension),
      password: typeof password === 'string' ? password : '',
      domain: String(ticket.sip_domain),
      wssUrl,
      displayName: displayName || undefined,
      ticketProvider,
    },
  };
}
