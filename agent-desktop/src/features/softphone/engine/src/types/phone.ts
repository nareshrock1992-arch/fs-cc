/** Shared types for the softphone. No UI or SIP.js types leak into this file (reusable in M4). */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type RegistrationStatus = 'unregistered' | 'registering' | 'registered' | 'failed';

export type CallDirection = 'inbound' | 'outbound';

/**
 * Call lifecycle:
 *  outbound: dialing -> ringing-out -> active -> ended
 *  inbound:  ringing-in -> connecting -> active -> ended
 */
export type CallStatus =
  'dialing' | 'ringing-out' | 'ringing-in' | 'connecting' | 'active' | 'ended';

export interface CallInfo {
  id: string;
  direction: CallDirection;
  remoteIdentity: string;
  status: CallStatus;
  muted: boolean;
  held: boolean;
  /** epoch ms when the call was answered (status became active) */
  answeredAt?: number;
  endReason?: string;
  /** blind transfer progress (SIP REFER) for this call */
  transfer?: TransferInfo;
}

/**
 * Blind transfer: requesting (REFER sent) -> accepted (202, server is transferring)
 * -> done (target reached; this call ends) | failed (reason; this call continues).
 */
export type TransferStatus = 'requesting' | 'accepted' | 'done' | 'failed';

/**
 * Consult (attended) transfer: a second, outbound call to a colleague while the customer
 * call (PhoneState.call) is on hold.
 *  dialing -> ringing-out -> active -> ended
 * `held` = colleague on hold (agent swapped back to the customer).
 * `completing` = REFER with Replaces sent; both calls end when FreeSWITCH joins them.
 */
export interface ConsultInfo {
  id: string;
  target: string;
  status: 'dialing' | 'ringing-out' | 'active' | 'ended';
  held: boolean;
  completing: boolean;
  answeredAt?: number;
  endReason?: string;
}

export interface TransferInfo {
  target: string;
  status: TransferStatus;
  reason?: string;
}

export interface Credentials {
  extension: string;
  password: string;
  domain: string;
  wssUrl: string;
  displayName?: string;
}

export interface DeviceOption {
  deviceId: string;
  label: string;
}

export interface DeviceState {
  inputs: DeviceOption[];
  outputs: DeviceOption[];
  selectedInput: string;
  selectedOutput: string;
  /** true when HTMLMediaElement.setSinkId is available (speaker selection) */
  sinkSupported: boolean;
}

export interface PhoneState {
  connection: ConnectionStatus;
  registration: RegistrationStatus;
  /** the signed-in identity, never contains the password */
  account?: { extension: string; domain: string; wssUrl: string };
  call?: CallInfo;
  /** second line: consult call to a colleague (attended transfer) */
  consult?: ConsultInfo;
  /** 3-way conference: 'merging' while the calls move to the room, then 'joined' */
  conference?: { room: string; status: 'merging' | 'joined' };
  devices: DeviceState;
  /** last user-facing error message */
  error?: string;
  /** user-facing informational notice (e.g. "click to enable audio") */
  notice?: string;
  online: boolean;
  reconnectAttempt: number;
}
