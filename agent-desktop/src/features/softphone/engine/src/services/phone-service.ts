import { Invitation, Inviter, SessionState, type Session } from 'sip.js';
import {
  audioConstraints,
  describeMediaError,
  isSinkSupported,
  listAudioDevices,
  onDeviceChange,
  requestMicrophonePermission,
} from '../audio/devices';
import { RemoteAudio } from '../audio/remote-audio';
import { Ringtone } from '../audio/ringtone';
import type { AppConfig } from '../config/config';
import {
  applyHoldMedia,
  applyMute,
  remoteStreamOf,
  sendDtmf,
  sendHoldReInvite,
  switchMicrophone,
} from '../sip/call-session';
import { SipClient } from '../sip/sip-client';
import type { Credentials, PhoneState } from '../types/phone';
import { log } from '../utils/logger';
import {
  isDtmfTone,
  normaliseDialString,
  validateDomain,
  validateExtension,
  validatePassword,
  validateWssUrl,
} from '../utils/validation';
import { describeSipStatus, reduceCall, type CallEvent } from './call-state';
import { ReconnectScheduler } from './reconnect';
import { Store } from './store';

const AUTH_FAILURE_CODES = new Set([401, 403, 407]);

export function initialPhoneState(): PhoneState {
  return {
    connection: 'disconnected',
    registration: 'unregistered',
    devices: {
      inputs: [],
      outputs: [],
      selectedInput: '',
      selectedOutput: '',
      sinkSupported: isSinkSupported(),
    },
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    reconnectAttempt: 0,
  };
}

/**
 * PhoneService – the single facade the UI talks to.
 * Owns: SIP client lifecycle, registration, one call at a time, media devices,
 * reconnection and user-facing error messages. Exposes state through an observable Store.
 *
 * Credentials are held in memory only for the lifetime of the login (needed to reconnect)
 * and are dropped on logout or page unload. They are never written to storage or logs.
 */
export class PhoneService {
  readonly store = new Store<PhoneState>(initialPhoneState());

  private client: SipClient | undefined;
  private creds: Credentials | undefined;
  private session: Session | undefined;
  private extraTracks: MediaStreamTrack[] = [];
  private pendingEndReason: string | undefined;
  private intentionalDisconnect = false;
  private readonly ringtone = new Ringtone();
  private readonly remoteAudio: RemoteAudio;
  private readonly reconnector: ReconnectScheduler;

  constructor(private readonly config: AppConfig) {
    this.remoteAudio = new RemoteAudio(() =>
      this.store.update({ notice: 'The browser blocked audio playback. Click "Enable audio".' }),
    );
    this.reconnector = new ReconnectScheduler(
      async () => {
        if (!this.client) return;
        await this.client.reconnect();
      },
      (attempt, delay) => {
        this.store.update({ connection: 'reconnecting', reconnectAttempt: attempt });
        log('info', 'phone', `reconnect attempt ${attempt} in ${delay} ms`);
      },
    );
    window.addEventListener('online', () => {
      this.store.update({ online: true });
      if (this.client && !this.client.isConnected()) this.reconnector.now();
    });
    window.addEventListener('offline', () =>
      this.store.update({ online: false, error: 'Network connection lost. Waiting to reconnect…' }),
    );
    window.addEventListener('pagehide', () => void this.client?.stop());
    onDeviceChange(() => void this.refreshDevices());
  }

  // ---------------------------------------------------------------- login / logout

  validateCredentials(creds: Credentials): string | undefined {
    for (const result of [
      validateExtension(creds.extension),
      validatePassword(creds.password),
      validateDomain(creds.domain),
      validateWssUrl(creds.wssUrl),
    ]) {
      if (!result.ok) return result.message;
    }
    return undefined;
  }

  async login(creds: Credentials): Promise<void> {
    const invalid = this.validateCredentials(creds);
    if (invalid) {
      this.store.update({ error: invalid });
      return;
    }
    if (this.client) await this.logout();

    this.store.update({ error: undefined, notice: undefined, connection: 'connecting' });
    try {
      await requestMicrophonePermission();
    } catch (err) {
      this.store.update({ connection: 'disconnected', error: describeMediaError(err) });
      return;
    }
    await this.refreshDevices();

    this.creds = creds;
    this.intentionalDisconnect = false;
    this.client = new SipClient(this.config, creds, {
      onConnected: () => this.handleConnected(),
      onDisconnected: (error) => this.handleDisconnected(error),
      onRegistered: () => this.store.update({ registration: 'registered', error: undefined }),
      onUnregistered: () => {
        if (this.store.get().registration !== 'failed') {
          this.store.update({ registration: 'unregistered' });
        }
      },
      onRegistrationFailed: (code, reason) => this.handleRegistrationFailed(code, reason),
      onInvite: (invitation) => this.handleIncoming(invitation),
    });
    this.store.update({
      account: { extension: creds.extension, domain: creds.domain, wssUrl: creds.wssUrl },
    });

    try {
      await this.client.start();
    } catch (err) {
      log('warn', 'phone', `WSS connect failed: ${String(err)}`);
      await this.teardownClient();
      this.store.update({
        connection: 'disconnected',
        account: undefined,
        error:
          `Could not open the secure WebSocket (${creds.wssUrl}). ` +
          'Check that the server is running and that its certificate is trusted by this computer.',
      });
    }
  }

  async logout(): Promise<void> {
    this.intentionalDisconnect = true;
    this.reconnector.reset();
    if (this.session) await this.hangup();
    await this.teardownClient();
    this.store.update({
      ...initialPhoneState(),
      devices: this.store.get().devices,
      online: this.store.get().online,
      error: this.store.get().registration === 'failed' ? this.store.get().error : undefined,
    });
  }

  private async teardownClient(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.creds = undefined; // drop the password from memory
    await client?.stop();
  }

  // ---------------------------------------------------------------- transport / registration

  private handleConnected(): void {
    this.reconnector.reset();
    this.store.update({ connection: 'connected', reconnectAttempt: 0, error: undefined });
    void this.register();
  }

  private async register(): Promise<void> {
    if (!this.client) return;
    this.store.update({ registration: 'registering' });
    try {
      await this.client.register();
    } catch (err) {
      this.store.update({
        registration: 'unregistered',
        error: `Registration error: ${String(err)}`,
      });
    }
  }

  private handleDisconnected(error?: Error): void {
    this.store.update({ registration: 'unregistered' });
    if (this.intentionalDisconnect || !this.client) {
      this.store.update({ connection: 'disconnected' });
      return;
    }
    log('warn', 'phone', `transport lost: ${error?.message ?? 'closed'}`);
    this.store.update({
      error: 'Connection to the phone server was lost. Reconnecting…',
    });
    this.reconnector.schedule();
  }

  private handleRegistrationFailed(code: number, reason: string): void {
    if (AUTH_FAILURE_CODES.has(code)) {
      // Wrong extension/password: never retry automatically (avoids lock-outs / retry storms).
      this.store.update({
        registration: 'failed',
        error: 'Sign-in failed: wrong extension or password.',
      });
      void this.logout();
      return;
    }
    this.store.update({
      registration: 'failed',
      error: `Registration failed (SIP ${code} ${reason}). Retrying in 15 seconds…`,
    });
    setTimeout(() => {
      if (this.client?.isConnected() && this.store.get().registration === 'failed') {
        void this.register();
      }
    }, 15000);
  }

  // ---------------------------------------------------------------- calls

  async dial(input: string): Promise<void> {
    const target = normaliseDialString(input);
    if (!target) {
      this.store.update({ error: 'Enter a valid number (digits, *, #, + only).' });
      return;
    }
    if (!this.client || !this.creds || this.store.get().registration !== 'registered') {
      this.store.update({ error: 'Not registered – cannot place a call.' });
      return;
    }
    if (this.session) {
      this.store.update({ error: 'A call is already in progress.' });
      return;
    }
    let inviter: Inviter;
    try {
      inviter = this.client.createInviter(
        target,
        this.creds.domain,
        audioConstraints(this.store.get().devices.selectedInput),
      );
    } catch (err) {
      this.store.update({ error: String(err) });
      return;
    }
    this.trackSession(inviter, 'outbound', target);
    this.ringtone.startRingback();
    try {
      await inviter.invite({
        requestDelegate: {
          onProgress: (response) => {
            const code = response.message.statusCode;
            if (code === 180 || code === 183) this.callEvent({ type: 'progress' });
            if (code === 183) this.ringtone.stop(); // early media (e.g. remote ringback) plays instead
            this.attachRemoteAudio(inviter);
          },
          onReject: (response) => {
            this.pendingEndReason = describeSipStatus(response.message.statusCode);
          },
        },
      });
    } catch (err) {
      this.pendingEndReason = describeMediaError(err);
      log('warn', 'phone', `invite failed: ${String(err)}`);
    }
  }

  async answer(): Promise<void> {
    const session = this.session;
    if (!(session instanceof Invitation) || session.state !== SessionState.Initial) return;
    this.ringtone.stop();
    this.callEvent({ type: 'answering' });
    try {
      await session.accept({
        sessionDescriptionHandlerOptions: {
          constraints: audioConstraints(this.store.get().devices.selectedInput),
        },
      });
    } catch (err) {
      this.store.update({ error: `Could not answer: ${describeMediaError(err)}` });
      await session.reject().catch(() => undefined);
    }
  }

  async reject(): Promise<void> {
    const session = this.session;
    if (!(session instanceof Invitation) || session.state !== SessionState.Initial) return;
    this.pendingEndReason = 'Rejected';
    await session.reject({ statusCode: 603 }).catch(() => undefined);
  }

  async hangup(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.pendingEndReason = 'You hung up';
    try {
      if (session.state === SessionState.Established) await session.bye();
      else if (session instanceof Inviter) await session.cancel();
      else if (session instanceof Invitation) await session.reject({ statusCode: 603 });
    } catch (err) {
      log('warn', 'phone', `hangup error: ${String(err)}`);
      session.dispose().catch(() => undefined);
    }
  }

  toggleMute(): void {
    const call = this.store.get().call;
    if (!this.session || call?.status !== 'active') return;
    const muted = !call.muted;
    applyMute(this.session, muted, call.held);
    this.extraTracks.forEach((t) => (t.enabled = !muted && !call.held));
    this.callEvent({ type: 'mute', muted });
  }

  async toggleHold(): Promise<void> {
    const call = this.store.get().call;
    if (!this.session || call?.status !== 'active') return;
    const held = !call.held;
    try {
      await sendHoldReInvite(this.session, held);
      applyHoldMedia(this.session, held, call.muted);
      this.extraTracks.forEach((t) => (t.enabled = !held && !call.muted));
      this.callEvent({ type: 'hold', held });
    } catch (err) {
      this.store.update({ error: String(err instanceof Error ? err.message : err) });
    }
  }

  async sendDtmf(tone: string): Promise<void> {
    if (!this.session || this.store.get().call?.status !== 'active' || !isDtmfTone(tone)) return;
    try {
      const via = await sendDtmf(this.session, tone);
      log('debug', 'phone', `DTMF ${tone} sent via ${via}`);
    } catch (err) {
      this.store.update({ error: `DTMF failed: ${String(err)}` });
    }
  }

  // ---------------------------------------------------------------- devices / audio

  async refreshDevices(): Promise<void> {
    try {
      const { inputs, outputs } = await listAudioDevices();
      const current = this.store.get().devices;
      const keep = (id: string, list: { deviceId: string }[]) =>
        list.some((d) => d.deviceId === id) ? id : '';
      this.store.update({
        devices: {
          ...current,
          inputs,
          outputs,
          selectedInput: keep(current.selectedInput, inputs),
          selectedOutput: keep(current.selectedOutput, outputs),
        },
      });
    } catch (err) {
      log('warn', 'phone', `device enumeration failed: ${String(err)}`);
    }
  }

  async selectInput(deviceId: string): Promise<void> {
    const { devices, call } = this.store.get();
    this.store.update({ devices: { ...devices, selectedInput: deviceId } });
    if (this.session && call?.status === 'active') {
      try {
        const track = await switchMicrophone(
          this.session,
          audioConstraints(deviceId),
          !call.muted && !call.held,
        );
        this.extraTracks.push(track);
      } catch (err) {
        this.store.update({ error: describeMediaError(err) });
      }
    }
  }

  async selectOutput(deviceId: string): Promise<void> {
    const { devices } = this.store.get();
    try {
      await this.remoteAudio.setOutputDevice(deviceId);
      this.ringtone.setOutputDevice(deviceId);
      this.store.update({ devices: { ...devices, selectedOutput: deviceId } });
    } catch (err) {
      this.store.update({ error: String(err instanceof Error ? err.message : err) });
    }
  }

  async unlockAudio(): Promise<void> {
    if (await this.remoteAudio.unlock()) this.store.update({ notice: undefined });
  }

  clearError(): void {
    this.store.update({ error: undefined });
  }

  // ---------------------------------------------------------------- internals

  private handleIncoming(invitation: Invitation): void {
    if (this.session) {
      void invitation.reject({ statusCode: 486 }).catch(() => undefined); // Busy Here
      return;
    }
    const identity = invitation.remoteIdentity;
    const who = identity.displayName
      ? `${identity.displayName} <${identity.uri.user ?? ''}>`
      : (identity.uri.user ?? 'Unknown');
    this.trackSession(invitation, 'inbound', who);
    this.ringtone.startIncoming();
  }

  private trackSession(session: Session, direction: 'inbound' | 'outbound', remote: string): void {
    this.session = session;
    this.pendingEndReason = undefined;
    this.callEvent({ type: 'start', id: session.id, direction, remoteIdentity: remote });

    session.stateChange.addListener((state) => {
      switch (state) {
        case SessionState.Established:
          this.ringtone.stop();
          this.callEvent({ type: 'established', at: Date.now() });
          this.attachRemoteAudio(session);
          break;
        case SessionState.Terminated:
          this.finishSession(session, direction);
          break;
        default:
          break;
      }
    });
  }

  private attachRemoteAudio(session: Session): void {
    const stream = remoteStreamOf(session);
    if (!stream) return;
    this.remoteAudio.attach(stream);
    stream.onaddtrack = () => this.remoteAudio.attach(stream);
  }

  private finishSession(session: Session, direction: 'inbound' | 'outbound'): void {
    if (this.session !== session) return;
    const wasActive = this.store.get().call?.status === 'active';
    const reason =
      this.pendingEndReason ??
      (wasActive
        ? 'Remote party hung up'
        : direction === 'inbound'
          ? 'Missed call (caller hung up)'
          : 'Call ended');
    this.ringtone.stop();
    this.remoteAudio.detach();
    this.extraTracks.forEach((t) => t.stop());
    this.extraTracks = [];
    this.session = undefined;
    this.callEvent({ type: 'ended', reason });
    const endedId = session.id;
    setTimeout(() => {
      if (this.store.get().call?.id === endedId) this.store.update({ call: undefined });
    }, 3000);
  }

  private callEvent(event: CallEvent): void {
    this.store.update((s) => ({ call: reduceCall(s.call, event) }));
  }
}
