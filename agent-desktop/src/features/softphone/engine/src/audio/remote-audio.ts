/**
 * Plays the remote party's audio through a hidden <audio> element.
 * Handles browser autoplay restrictions: if play() is blocked, onBlocked is called so the UI
 * can ask the user to click; unlock() then resumes playback inside that click.
 */
type SinkCapable = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

export class RemoteAudio {
  private readonly element: SinkCapable;

  constructor(private readonly onBlocked: () => void) {
    this.element = document.createElement('audio') as SinkCapable;
    this.element.autoplay = true;
    this.element.setAttribute('playsinline', '');
    this.element.hidden = true;
    document.body.appendChild(this.element);
  }

  attach(stream: MediaStream): void {
    if (this.element.srcObject !== stream) this.element.srcObject = stream;
    void this.play();
  }

  detach(): void {
    this.element.pause();
    this.element.srcObject = null;
  }

  async play(): Promise<boolean> {
    if (!this.element.srcObject) return true;
    try {
      await this.element.play();
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') this.onBlocked();
      return false;
    }
  }

  /** Must be called from a user gesture (click). */
  unlock(): Promise<boolean> {
    return this.play();
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    if (typeof this.element.setSinkId !== 'function') {
      throw new Error('Speaker selection is not supported by this browser.');
    }
    await this.element.setSinkId(deviceId);
  }
}
