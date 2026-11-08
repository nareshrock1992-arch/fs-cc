import type { DeviceOption } from '../types/phone';

/** True when the browser can route audio output to a chosen device (Chrome/Edge). */
export function isSinkSupported(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/**
 * Asks for microphone permission once so device labels become visible.
 * The temporary stream is stopped immediately (microphone indicator turns off).
 */
export async function requestMicrophonePermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'This browser cannot access the microphone. Use Chrome or Edge over HTTPS (secure context).',
    );
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  stream.getTracks().forEach((t) => t.stop());
}

export async function listAudioDevices(): Promise<{
  inputs: DeviceOption[];
  outputs: DeviceOption[];
}> {
  const all = await navigator.mediaDevices.enumerateDevices();
  const toOption = (d: MediaDeviceInfo, i: number, kind: string): DeviceOption => ({
    deviceId: d.deviceId,
    label: d.label || `${kind} ${i + 1}`,
  });
  return {
    inputs: all.filter((d) => d.kind === 'audioinput').map((d, i) => toOption(d, i, 'Microphone')),
    outputs: all.filter((d) => d.kind === 'audiooutput').map((d, i) => toOption(d, i, 'Speaker')),
  };
}

export function onDeviceChange(handler: () => void): () => void {
  navigator.mediaDevices?.addEventListener('devicechange', handler);
  return () => navigator.mediaDevices?.removeEventListener('devicechange', handler);
}

/** getUserMedia constraints for the chosen microphone (browser default when empty). */
export function audioConstraints(deviceId: string): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio, video: false };
}

/** Maps getUserMedia errors to plain-language messages. */
export function describeMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Microphone permission was denied. Click the padlock in the address bar and allow the microphone.';
    case 'NotFoundError':
      return 'No microphone was found. Connect a microphone or headset.';
    case 'NotReadableError':
      return 'The microphone is in use by another application.';
    case 'OverconstrainedError':
      return 'The selected microphone is no longer available. Choose another one.';
    case 'SecurityError':
      return 'Microphone access requires HTTPS.';
    default:
      return err instanceof Error ? err.message : 'Unknown microphone error.';
  }
}
