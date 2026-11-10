import type { CallDirection, CallInfo, TransferStatus } from '../types/phone';

/**
 * Pure call-state transitions. Kept free of SIP.js so it can be unit tested and reused.
 * Invalid transitions return the call unchanged.
 */
export type CallEvent =
  | { type: 'start'; id: string; direction: CallDirection; remoteIdentity: string }
  | { type: 'progress' }
  | { type: 'answering' }
  | { type: 'established'; at: number }
  | { type: 'mute'; muted: boolean }
  | { type: 'hold'; held: boolean }
  | { type: 'transfer'; target: string; status: TransferStatus; reason?: string }
  | { type: 'ended'; reason: string };

export function reduceCall(call: CallInfo | undefined, event: CallEvent): CallInfo | undefined {
  if (event.type === 'start') {
    return {
      id: event.id,
      direction: event.direction,
      remoteIdentity: event.remoteIdentity,
      status: event.direction === 'outbound' ? 'dialing' : 'ringing-in',
      muted: false,
      held: false,
    };
  }
  if (!call || call.status === 'ended') return call;

  switch (event.type) {
    case 'progress':
      return call.status === 'dialing' ? { ...call, status: 'ringing-out' } : call;
    case 'answering':
      return call.status === 'ringing-in' ? { ...call, status: 'connecting' } : call;
    case 'established':
      return call.status === 'active' ? call : { ...call, status: 'active', answeredAt: event.at };
    case 'mute':
      return call.status === 'active' ? { ...call, muted: event.muted } : call;
    case 'hold':
      return call.status === 'active' ? { ...call, held: event.held } : call;
    case 'transfer':
      return call.status === 'active'
        ? { ...call, transfer: { target: event.target, status: event.status, reason: event.reason } }
        : call;
    case 'ended':
      return { ...call, status: 'ended', endReason: event.reason };
  }
}

/** Status code from a REFER progress NOTIFY body (message/sipfrag, e.g. "SIP/2.0 200 OK"). */
export function sipfragStatus(body: string | undefined): number | undefined {
  const m = /^SIP\/2\.0\s+(\d{3})/i.exec((body || '').trim());
  return m ? Number(m[1]) : undefined;
}

/** Human-readable reason for a SIP final response code. */
export function describeSipStatus(code: number | undefined): string {
  switch (code) {
    case undefined:
      return 'Call ended';
    case 403:
      return 'Forbidden (not allowed to call this number)';
    case 404:
      return 'Number not found';
    case 408:
      return 'No answer (timeout)';
    case 480:
      return 'Unavailable (not registered)';
    case 486:
      return 'Busy';
    case 487:
      return 'Cancelled';
    case 488:
      return 'Not acceptable (codec / media negotiation failed)';
    case 503:
      return 'Service unavailable';
    case 603:
      return 'Declined';
    default:
      return `Call failed (SIP ${code})`;
  }
}
