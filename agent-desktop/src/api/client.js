const API_BASE = import.meta.env.VITE_API_URL || '/api';

function authHeaders() {
  const token = localStorage.getItem('agent_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    // Same message as before; status and server error code are attached so callers
    // can tell e.g. "browser phone not allowed" (403) from "too many requests" (429).
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

/** The API base (e.g. "/api" or "/cc/api"); the SIP relay lives next to it. */
export function apiBase() {
  return API_BASE;
}

/**
 * Tell the backend this page is reloading so a browser refresh does not count as
 * a lost browser phone (CP3-E). Fire-and-forget during 'pagehide'; keepalive lets
 * the request outlive the page. Uses the same agent JWT header as every call.
 */
export function notifyPageReload() {
  try {
    fetch(`${API_BASE}/agent-desk/webrtc/page-reload`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: '{}',
    }).catch(() => {});
  } catch { /* page is going away */ }
}

// Build a query string from a params object, skipping empty/undefined values.
function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.append(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  login:       (agent_id, pin) => request('POST', '/agent-desk/login', { agent_id, pin }),
  me:          ()              => request('GET',  '/agent-desk/me'),
  // setStatus keeps backward compatibility: with no breakCode it sends only
  // { status }. A break code is included only when explicitly provided.
  setStatus:   (status, breakCode) =>
    request('POST', '/agent-desk/status',
      breakCode ? { status, break_code: breakCode } : { status }),
  queues:      ()              => request('GET',  '/agent-desk/queues'),
  calls:       ()              => request('GET',  '/agent-desk/calls'),
  performance: ()              => request('GET',  '/agent-desk/performance'),
  eslStatus:   ()              => request('GET',  '/agent-desk/esl-status'),
  // Browser phone (CP3): single-use SIP relay ticket. Never stored anywhere.
  webrtcTicket: (kind = 'connect') => request('POST', '/agent-desk/webrtc/ticket', { kind }),

  // ── Break management ──────────────────────────────────────────────────────
  breakCodes:   ()        => request('GET', '/agent-desk/break-codes'),
  breakHistory: (params)  => request('GET', `/agent-desk/break-history${qs(params)}`),

  // ── Call history ──────────────────────────────────────────────────────────
  callHistory:  (params)  => request('GET', `/agent-desk/call-history${qs(params)}`),
  callDetail:   (uuid)    => request('GET', `/agent-desk/call-history/${encodeURIComponent(uuid)}`),
};
