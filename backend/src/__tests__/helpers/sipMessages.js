// Test helper: build minimal, valid SIP-over-WebSocket requests (RFC 3261 / 7118).
export function sipRequest(method, { from = '1001', to = from, toTag = false, auth = null, extra = [], body = '', cseq = 2, callId = 'call-1' } = {}) {
  const lines = [
    `${method} sip:${method === 'REGISTER' ? 'pbx.example' : `${to}@pbx.example`} SIP/2.0`,
    'Via: SIP/2.0/WSS abc.invalid;branch=z9hG4bK123',
    'Max-Forwards: 70',
    `To: <sip:${to}@pbx.example>${toTag ? ';tag=remote1' : ''}`,
    `From: "Agent" <sip:${from}@pbx.example>;tag=local1`,
    `Call-ID: ${callId}`,
    `CSeq: ${cseq} ${method}`,
    ...(auth ? [`Authorization: Digest username="${auth}", realm="pbx.example", nonce="n", uri="sip:pbx.example", response="r"`] : []),
    ...extra,
    `Content-Length: ${Buffer.byteLength(body)}`,
  ];
  return `${lines.join('\r\n')}\r\n\r\n${body}`;
}

export function sipResponse(status, reason, method, extra = []) {
  return [`SIP/2.0 ${status} ${reason}`, 'Via: SIP/2.0/WSS abc.invalid;branch=z9hG4bK123', 'Call-ID: call-1', `CSeq: 2 ${method}`, ...extra, 'Content-Length: 0'].join('\r\n') + '\r\n\r\n';
}
