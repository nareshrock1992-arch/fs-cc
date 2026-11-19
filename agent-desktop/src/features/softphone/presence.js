/**
 * Phone presence (CP3-E) — ONE place that turns the two phone sources into what
 * the Agent Desktop shows. Pure functions, no SIP.js import (safe to use even
 * when the phone code is not loaded).
 *
 *   engine : softphone engine PhoneState (this browser's SIP.js view), or null
 *   server : CP3-D phone_status from the backend relay ('none'|'online'|'grace'|'offline')
 *
 * Phone state is NEVER the agent's status: the agent can be Available / On Break /
 * Logged Out independently, and PHONE_OFFLINE is a break reason the SERVER sets.
 */

export const PHONE = {
  HIDDEN: 'hidden',         // browser phone not used by this agent (desk phone, EXTERNAL_PBX, gateway)
  SIGNED_OUT: 'signed-out', // allowed, not signed in yet
  CONNECTING: 'connecting',
  REGISTERED: 'registered',
  RECONNECTING: 'reconnecting',
  OFFLINE: 'offline',
  FAILED: 'failed',
};

const VIEW = {
  [PHONE.SIGNED_OUT]:   { level: 'warn',  label: 'Phone signed out', detail: 'Sign in to the browser phone to take and make calls.' },
  [PHONE.CONNECTING]:   { level: 'warn',  label: 'Phone connecting…', detail: 'Connecting and registering the browser phone.' },
  [PHONE.REGISTERED]:   { level: 'ok',    label: 'Phone ready', detail: 'Browser phone registered. Calls can reach you.' },
  [PHONE.RECONNECTING]: { level: 'warn',  label: 'Phone reconnecting…', detail: 'Connection lost. Reconnecting — calls in progress are not ended.' },
  [PHONE.OFFLINE]:      { level: 'error', label: 'Phone offline', detail: 'The browser phone is offline. You cannot take calls until it reconnects.' },
  [PHONE.FAILED]:       { level: 'error', label: 'Phone sign-in failed', detail: 'Check your SIP password and sign in again.' },
};

/**
 * @param {{ allowed: boolean, engine?: object|null, server?: string }} args
 * @returns {{ key: string, level?: string, label?: string, detail?: string }}
 */
export function phonePresence({ allowed, engine, server = 'none' }) {
  if (!allowed) return { key: PHONE.HIDDEN };
  const e = engine || {};
  let key;
  if (e.registration === 'registered' && e.connection === 'connected') key = PHONE.REGISTERED;
  else if (e.connection === 'reconnecting' || (e.account && server === 'grace')) key = PHONE.RECONNECTING;
  else if (server === 'offline') key = PHONE.OFFLINE;
  else if (e.registration === 'failed' || (!e.account && e.error)) key = PHONE.FAILED;
  else if (e.account && (e.connection === 'connecting' || e.registration === 'registering' || e.connection === 'connected')) key = PHONE.CONNECTING;
  else if (server === 'grace') key = PHONE.RECONNECTING;
  else key = PHONE.SIGNED_OUT;
  return { key, ...VIEW[key] };
}

/**
 * Why the agent may not choose Available now (null = allowed). The server
 * enforces the 'offline' case (409); the desktop also stops it while the phone is
 * signed out or failed, because calls would ring a phone that is not there.
 */
export function availableBlockedReason(presence) {
  switch (presence?.key) {
    case PHONE.OFFLINE: return 'Your browser phone is offline. Reconnect it before becoming Available.';
    case PHONE.SIGNED_OUT: return 'Sign in to the browser phone before becoming Available.';
    case PHONE.FAILED: return 'Sign in to the browser phone again before becoming Available.';
    default: return null;
  }
}

/** Show "phone is back" when the server put the agent on PHONE_OFFLINE and the phone is ready again. */
export function showRecoveryPrompt({ presence, agentStatus, breakCode }) {
  return presence?.key === PHONE.REGISTERED && agentStatus === 'On Break' && breakCode === 'PHONE_OFFLINE';
}
