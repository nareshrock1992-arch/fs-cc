/**
 * Runtime configuration. Only NON-SECRET values live here.
 * SIP passwords are never configured – they are typed on the login screen.
 */
export interface AppConfig {
  defaultDomain: string;
  defaultWssUrl: string;
  /** REGISTER expiry in seconds */
  registerExpires: number;
  /** ms to wait for ICE gathering; LAN host candidates are gathered almost instantly */
  iceGatheringTimeoutMs: number;
  /** STUN/TURN servers. Empty on purpose: LAN-only lab, nothing leaves the network. */
  iceServers: RTCIceServer[];
}

/** Same-origin WSS endpoint served by server/server.mjs (Option A proxy). */
export function sameOriginWssUrl(loc: Pick<Location, 'host'>): string {
  return `wss://${loc.host}/sip`;
}

export function loadConfig(loc: Pick<Location, 'host' | 'hostname'> = window.location): AppConfig {
  const env = import.meta.env;
  return {
    defaultDomain: env.VITE_SIP_DOMAIN || loc.hostname,
    defaultWssUrl: env.VITE_SIP_WSS_URL || sameOriginWssUrl(loc),
    registerExpires: 300,
    iceGatheringTimeoutMs: 1000,
    iceServers: [],
  };
}
