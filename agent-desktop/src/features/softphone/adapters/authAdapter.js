/**
 * authAdapter — FS-CC SIP relay tickets (CP3-E).
 *
 * The browser phone never connects to FreeSWITCH directly. Before every connect
 * AND every reconnect it asks the FS-CC backend (agent JWT, existing API client)
 * for a single-use ticket, and connects to the FS-CC relay with it.
 *
 * - The relay URL is derived from the page origin and the API base path; no
 *   domain, IP or WSS URL is built into the app.
 * - Tickets are kept only in memory for the few milliseconds until the WebSocket
 *   opens. They are never stored, logged or rendered.
 */
import { TicketError } from '../engine/src/types/phone';

/**
 * WSS URL of the FS-CC relay for a ticket response.
 * @param {{ ticket: string, relay_path?: string }} t       server ticket response
 * @param {string} apiBase    e.g. "/api" (dev) or "/cc/api" (behind nginx) or an absolute URL
 * @param {{ href: string }} loc  page location
 */
export function relayUrlFor(t, apiBase, loc = window.location) {
  if (!t?.ticket) throw new TicketError('The server did not return a phone ticket.', false);
  const relayPath = t.relay_path || '/api/sip-relay';           // backend path, starts with /api
  const base = new URL(String(apiBase || '/api'), loc.href);      // resolve relative bases
  const prefix = base.pathname.replace(/\/api\/?$/, '').replace(/\/$/, '');
  const url = new URL(`${prefix}${relayPath}`, base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = `?ticket=${encodeURIComponent(t.ticket)}`;
  return url.toString();
}

/** Plain-language message for a ticket request failure. */
export function ticketErrorMessage(err) {
  if (err?.status === 403 || err?.status === 404) return 'The browser phone is not enabled for you. Use your desk phone or ask your supervisor.';
  if (err?.status === 401) return 'Your session has expired. Sign in to the Agent Desktop again.';
  if (err?.status === 429) return 'Too many phone connection attempts. Wait a moment and try again.';
  return 'Could not reach the server to start the browser phone. Check the network and try again.';
}

/** 401/403/404 mean "not allowed any more": do not keep retrying. */
export function isFatalTicketError(err) {
  return err?.status === 401 || err?.status === 403 || err?.status === 404;
}

/**
 * Fetch a ticket and wrap failures in a TicketError (fatal or temporary).
 * @param {(kind:string) => Promise<object>} fetchTicket  e.g. api.webrtcTicket
 */
export async function requestTicket(fetchTicket, kind) {
  try {
    return await fetchTicket(kind);
  } catch (err) {
    throw new TicketError(ticketErrorMessage(err), isFatalTicketError(err));
  }
}

/**
 * Engine ticketProvider for reconnects: a fresh ticket every time, and the server
 * must still name the same extension (an admin change means: stop, sign in again).
 */
export function createTicketProvider({ fetchTicket, apiBase, extension, loc = window.location }) {
  return async (kind = 'reconnect') => {
    const t = await requestTicket(fetchTicket, kind);
    if (extension && t.extension !== extension) {
      throw new TicketError('Your phone extension was changed. Sign in to the phone again.', true);
    }
    return relayUrlFor(t, apiBase, loc);
  };
}
