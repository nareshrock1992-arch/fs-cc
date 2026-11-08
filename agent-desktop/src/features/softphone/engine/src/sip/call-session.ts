import { Web, type Session } from 'sip.js';

/**
 * Media helpers for an established SIP.js session.
 * All functions work on the Web SessionDescriptionHandler (WebRTC RTCPeerConnection wrapper).
 */

export function sdhOf(session: Session): Web.SessionDescriptionHandler | undefined {
  const sdh = session.sessionDescriptionHandler;
  return sdh instanceof Web.SessionDescriptionHandler ? sdh : undefined;
}

export function remoteStreamOf(session: Session): MediaStream | undefined {
  return sdhOf(session)?.remoteMediaStream;
}

/** Mute = stop sending microphone audio (track disabled, no re-INVITE needed). */
export function applyMute(session: Session, muted: boolean, held: boolean): void {
  sdhOf(session)?.enableSenderTracks(!muted && !held);
}

/**
 * Hold/resume via SIP re-INVITE (a=sendonly / a=sendrecv), the standard way FreeSWITCH
 * understands (it plays hold music to the other party). Resolves when the re-INVITE is accepted.
 */
export function sendHoldReInvite(session: Session, hold: boolean): Promise<void> {
  const options =
    session.sessionDescriptionHandlerOptionsReInvite as Web.SessionDescriptionHandlerOptions;
  options.hold = hold;
  session.sessionDescriptionHandlerOptionsReInvite = options;
  return new Promise<void>((resolve, reject) => {
    session
      .invite({
        requestDelegate: {
          onAccept: () => resolve(),
          onReject: (response) =>
            reject(new Error(`Hold/resume refused (SIP ${response.message.statusCode})`)),
        },
      })
      .catch(reject);
  });
}

export function applyHoldMedia(session: Session, held: boolean, muted: boolean): void {
  const sdh = sdhOf(session);
  sdh?.enableReceiverTracks(!held);
  sdh?.enableSenderTracks(!held && !muted);
}

/**
 * DTMF: RFC 2833 / RFC 4733 telephone-events in the RTP stream (FreeSWITCH profile uses
 * dtmf rfc2833, payload 101). Falls back to SIP INFO if the browser cannot send RTP DTMF.
 */
export async function sendDtmf(session: Session, tone: string): Promise<'rtp' | 'info'> {
  const sdh = sdhOf(session);
  if (sdh?.sendDtmf(tone, { duration: 120, interToneGap: 70 })) return 'rtp';
  await session.info({
    requestOptions: {
      body: {
        contentDisposition: 'render',
        contentType: 'application/dtmf-relay',
        content: `Signal=${tone}\r\nDuration=120`,
      },
    },
  });
  return 'info';
}

/**
 * Switches the microphone during a call without renegotiation (RTCRtpSender.replaceTrack).
 * Future re-INVITEs (hold) use the same device because the re-INVITE constraints are updated.
 * Returns the new track so the caller can stop it when the call ends.
 */
export async function switchMicrophone(
  session: Session,
  constraints: MediaStreamConstraints,
  enabled: boolean,
): Promise<MediaStreamTrack> {
  const pc = sdhOf(session)?.peerConnection;
  if (!pc) throw new Error('No active media connection.');
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error('Selected microphone produced no audio track.');
  track.enabled = enabled;
  const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
  if (!sender) {
    track.stop();
    throw new Error('No audio sender on the call.');
  }
  const old = sender.track;
  await sender.replaceTrack(track);
  old?.stop();
  session.sessionDescriptionHandlerOptionsReInvite = {
    ...session.sessionDescriptionHandlerOptionsReInvite,
    constraints,
  };
  return track;
}
