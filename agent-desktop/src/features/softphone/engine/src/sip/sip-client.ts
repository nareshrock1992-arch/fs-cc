import {
  Inviter,
  Registerer,
  RegistererState,
  UserAgent,
  type Invitation,
  type URI,
  type UserAgentOptions,
} from 'sip.js';
import type { AppConfig } from '../config/config';
import type { Credentials } from '../types/phone';
import { log, type LogLevel } from '../utils/logger';

/**
 * Thin wrapper around SIP.js 0.21 UserAgent + Registerer.
 * Responsibilities: WSS transport, REGISTER / un-REGISTER, creating outgoing Inviters,
 * forwarding incoming Invitations. Contains no UI code (reusable for FS-CC / FS-ENRS later).
 */
export interface SipClientEvents {
  onConnected(): void;
  onDisconnected(error?: Error): void;
  onRegistered(): void;
  onUnregistered(): void;
  onRegistrationFailed(statusCode: number, reasonPhrase: string): void;
  onInvite(invitation: Invitation): void;
}

const SIP_JS_LEVEL: Record<string, LogLevel> = {
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
};

export class SipClient {
  private readonly ua: UserAgent;
  private readonly registerer: Registerer;

  constructor(
    config: AppConfig,
    creds: Credentials,
    private readonly events: SipClientEvents,
  ) {
    const uri = UserAgent.makeURI(`sip:${creds.extension}@${creds.domain}`);
    if (!uri) throw new Error('Invalid SIP address.');

    const options: UserAgentOptions = {
      uri,
      transportOptions: {
        server: creds.wssUrl,
        connectionTimeout: 10, // seconds
        keepAliveInterval: 30, // seconds, CRLF keep-alive detects dead connections
      },
      authorizationUsername: creds.extension,
      authorizationPassword: creds.password,
      displayName: creds.displayName || creds.extension,
      userAgentString: 'FS-WebRTC/0.1 (SIP.js 0.21.2)',
      logBuiltinEnabled: false,
      logLevel: import.meta.env.DEV ? 'debug' : 'warn',
      logConnector: (level, category, label, content) =>
        log(SIP_JS_LEVEL[level] ?? 'info', label ? `${category}|${label}` : category, content),
      noAnswerTimeout: 60,
      sessionDescriptionHandlerFactoryOptions: {
        iceGatheringTimeout: config.iceGatheringTimeoutMs,
        peerConnectionConfiguration: { iceServers: config.iceServers },
      },
      delegate: {
        onConnect: () => events.onConnected(),
        onDisconnect: (error?: Error) => events.onDisconnected(error),
        onInvite: (invitation: Invitation) => events.onInvite(invitation),
      },
    };

    this.ua = new UserAgent(options);
    this.registerer = new Registerer(this.ua, { expires: config.registerExpires });
    this.registerer.stateChange.addListener((state) => {
      if (state === RegistererState.Registered) events.onRegistered();
      else if (state === RegistererState.Unregistered) events.onUnregistered();
    });
  }

  /** Opens the WSS connection. Rejects if the WebSocket cannot be established. */
  start(): Promise<void> {
    return this.ua.start();
  }

  /** Re-opens a dropped WSS connection. Rejects on failure. */
  reconnect(): Promise<void> {
    return this.ua.reconnect();
  }

  isConnected(): boolean {
    return this.ua.isConnected();
  }

  async register(): Promise<void> {
    await this.registerer.register({
      requestDelegate: {
        onReject: (response) =>
          this.events.onRegistrationFailed(
            response.message.statusCode ?? 0,
            response.message.reasonPhrase ?? '',
          ),
      },
    });
  }

  /** SIP URI for a dial target on the account's domain (used as a transfer target). */
  makeTarget(target: string, domain: string): URI {
    const uri = UserAgent.makeURI(`sip:${target}@${domain}`);
    if (!uri) throw new Error('Invalid destination.');
    return uri;
  }

  createInviter(target: string, domain: string, constraints: MediaStreamConstraints): Inviter {
    const targetUri = UserAgent.makeURI(`sip:${target}@${domain}`);
    if (!targetUri) throw new Error('Invalid destination.');
    return new Inviter(this.ua, targetUri, {
      earlyMedia: true,
      sessionDescriptionHandlerOptions: { constraints },
    });
  }

  /** Un-registers (best effort, max 3 s) and closes the transport. */
  async stop(): Promise<void> {
    if (this.registerer.state === RegistererState.Registered && this.ua.isConnected()) {
      await Promise.race([
        this.registerer.unregister().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    await this.registerer.dispose().catch(() => undefined);
    await this.ua.stop().catch(() => undefined);
  }
}
