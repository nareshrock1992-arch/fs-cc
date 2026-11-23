/**
 * Strict, read-only inspection of SIP-over-WebSocket frames (RFC 7118) for the
 * browser-phone relay (CP3-C). It NEVER rewrites a frame: the relay forwards
 * the original text unchanged. Only the start line and a few headers are read.
 */

export const SIP_METHODS = new Set([
  'REGISTER', 'INVITE', 'ACK', 'BYE', 'CANCEL', 'OPTIONS', 'INFO', 'REFER',
  'NOTIFY', 'SUBSCRIBE', 'MESSAGE', 'PRACK', 'UPDATE', 'PUBLISH',
]);

// Requests that create a dialog or stand alone: the sender identity (From) must be
// the agent's own extension. INVITE/REFER only when out of dialog (no To tag).
const IDENTITY_METHODS = new Set(['REGISTER', 'SUBSCRIBE', 'MESSAGE', 'OPTIONS', 'PUBLISH']);
const DIALOG_CREATING_WHEN_NO_TAG = new Set(['INVITE', 'REFER']);

const MAX_HEADER_BYTES = 16 * 1024;
const COMPACT = { f: 'from', t: 'to', i: 'call-id', m: 'contact', l: 'content-length' };

/** CRLF keep-alive ("\r\n\r\n" ping or "\r\n" pong) used by SIP.js and FreeSWITCH. */
export function isKeepAlive(text) {
  return text === '\r\n\r\n' || text === '\r\n';
}

/** User part of the first sip:/sips: URI in a From/To/Contact header value. */
export function uriUser(value) {
  if (typeof value !== 'string') return null;
  const m = /sips?:([^@;>\s]+)@/i.exec(value);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function digestUsername(value) {
  if (typeof value !== 'string') return null;
  const m = /username\s*=\s*"([^"]*)"/i.exec(value) || /username\s*=\s*([^,\s]+)/i.exec(value);
  return m ? m[1] : null;
}

/**
 * Parse a SIP message's start line and headers.
 * @returns {{ ok: true, kind: 'request'|'response', method?: string, status?: number,
 *             cseqMethod?: string, headers: Record<string,string[]> } | { ok: false, error: string }}
 */
export function parseSipFrame(text) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'empty' };
  const end = text.indexOf('\r\n\r\n');
  if (end < 0) return { ok: false, error: 'no header terminator' };
  if (end > MAX_HEADER_BYTES) return { ok: false, error: 'headers too large' };
  const lines = text.slice(0, end).split('\r\n');
  const start = lines[0];
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]/.test(line)) return { ok: false, error: 'folded header' }; // obsolete; refuse
    const c = line.indexOf(':');
    if (c <= 0) return { ok: false, error: 'malformed header' };
    let name = line.slice(0, c).trim().toLowerCase();
    name = COMPACT[name] || name;
    (headers[name] ||= []).push(line.slice(c + 1).trim());
  }
  const cseq = headers.cseq?.[0]?.split(/\s+/);
  const cseqMethod = cseq && cseq[1] ? cseq[1].toUpperCase() : undefined;

  const resp = /^SIP\/2\.0 ([1-6][0-9]{2})(?: .*)?$/.exec(start);
  if (resp) return { ok: true, kind: 'response', status: Number(resp[1]), cseqMethod, headers };

  const req = /^([A-Z]+) (sips?:\S+) SIP\/2\.0$/.exec(start);
  if (!req) return { ok: false, error: 'bad start line' };
  if (!SIP_METHODS.has(req[1])) return { ok: false, error: `method not allowed: ${req[1]}` };
  if (!headers.from || !headers.to || !headers['call-id'] || !headers.cseq || !headers.via) {
    return { ok: false, error: 'missing mandatory header' };
  }
  return { ok: true, kind: 'request', method: req[1], cseqMethod, headers };
}

/**
 * Decide whether a browser → FreeSWITCH frame may be forwarded for this extension.
 * @param {string} text
 * @param {string} extension  the ticket-bound extension
 * @param {(callId: string) => boolean} [isKnownDialog]  true for a call this relay
 *        session has seen (an INVITE FreeSWITCH sent to this phone, or one this phone
 *        sent after passing the identity check)
 * @returns {{ allow: true, parsed?: object } | { allow: false, code: number, reason: string }}
 */
export function checkOutboundFrame(text, extension, isKnownDialog = () => false) {
  if (isKeepAlive(text)) return { allow: true };
  const p = parseSipFrame(text);
  if (!p.ok) return { allow: false, code: 4400, reason: `invalid SIP frame (${p.error})` };
  if (p.kind === 'response') return { allow: true, parsed: p };

  const from = uriUser(p.headers.from[0]);
  const to = uriUser(p.headers.to[0]);
  const toHasTag = /;\s*tag=/i.test(p.headers.to[0]);

  for (const h of ['authorization', 'proxy-authorization']) {
    for (const v of p.headers[h] || []) {
      if (digestUsername(v) !== extension) return { allow: false, code: 4403, reason: 'authorization user mismatch' };
    }
  }
  const identity = IDENTITY_METHODS.has(p.method) || (DIALOG_CREATING_WHEN_NO_TAG.has(p.method) && !toHasTag);
  if (identity) {
    if (from !== extension) return { allow: false, code: 4403, reason: 'From user mismatch' };
    if (p.method === 'REGISTER' && to !== extension) return { allow: false, code: 4403, reason: 'To user mismatch' };
  } else if (from !== extension && to !== extension && !isKnownDialog(p.headers['call-id'][0])) {
    // In-dialog request. On a call FreeSWITCH sent to this phone, the browser's side
    // is addressed by its random contact user (e.g. "i5gk7ss1"), not the extension,
    // so ownership is proven by the dialog being one this relay session has seen.
    return { allow: false, code: 4403, reason: 'in-dialog request not owned by this extension' };
  }
  return { allow: true, parsed: p };
}

/** Expires value of a REGISTER 200 OK (Contact ;expires= or Expires header). */
export function registerExpires(parsed) {
  const contact = parsed.headers.contact?.[0];
  const m = contact && /;\s*expires\s*=\s*(\d+)/i.exec(contact);
  if (m) return Number(m[1]);
  const e = parsed.headers.expires?.[0];
  return e != null && /^\d+$/.test(e) ? Number(e) : null;
}
