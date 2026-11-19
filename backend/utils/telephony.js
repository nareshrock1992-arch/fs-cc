/**
 * Telephony rules (CP3) — the ONLY place that decides whether an agent may use
 * the browser phone (WebRTC). Every backend check calls effectiveWebrtc().
 *
 * Precedence: the customer mode (TELEPHONY_MODE) always wins. An agent-level
 * webrtc_enabled flag can never override an EXTERNAL_PBX prohibition, and
 * gateway agents are never eligible.
 */

// Internal FreeSWITCH contact: optional "{...}" variable prefix, then user/<ext>@<domain>.
// Same limits as the agent-desktop configAdapter and the softphone engine (2–15 digits).
const INTERNAL_CONTACT = /^(?:\{[^}]*\})*user\/([0-9]{2,15})@([^\s,;{}]+)$/;

/**
 * Parse an FS-CC agent contact string.
 * @param {unknown} contact e.g. "{sip_cid_type=pid}user/1000@pbx.example"
 * @returns {{ extension: string, domain: string } | null}
 */
export function parseInternalContact(contact) {
  if (typeof contact !== 'string') return null;
  const m = INTERNAL_CONTACT.exec(contact.trim());
  return m ? { extension: m[1], domain: m[2] } : null;
}

/** True when the customer mode allows any browser phone at all. */
export function modeAllowsWebrtc(mode) {
  return mode === 'FREESWITCH_WEBRTC' || mode === 'HYBRID';
}

/**
 * Effective browser-phone permission for one agent.
 * @param {{ agent_type?: string, webrtc_enabled?: boolean, active?: boolean, contact?: string } | null} agent
 * @param {string} mode TELEPHONY_MODE
 * @returns {{ allowed: boolean, reason?: string, extension?: string }}
 */
export function effectiveWebrtc(agent, mode) {
  if (!modeAllowsWebrtc(mode)) return { allowed: false, reason: 'MODE_PROHIBITS' };
  if (!agent) return { allowed: false, reason: 'NO_AGENT' };
  if (agent.active === false) return { allowed: false, reason: 'AGENT_INACTIVE' };
  if (agent.agent_type !== 'internal') return { allowed: false, reason: 'NOT_INTERNAL' };
  if (agent.webrtc_enabled !== true) return { allowed: false, reason: 'AGENT_NOT_ENABLED' };
  const parsed = parseInternalContact(agent.contact);
  if (!parsed) return { allowed: false, reason: 'NO_EXTENSION' };
  return { allowed: true, extension: parsed.extension };
}
