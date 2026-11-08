/**
 * Synthesised ring tones (Web Audio) – no audio files needed.
 * Incoming: two-tone ring. Outgoing ringback: 440+480 Hz, 2 s on / 4 s off.
 */
type Pattern = { freqs: number[]; onMs: number; offMs: number };

const INCOMING: Pattern = { freqs: [480, 620], onMs: 1000, offMs: 2000 };
const RINGBACK: Pattern = { freqs: [440, 480], onMs: 2000, offMs: 4000 };

export class Ringtone {
  private ctx: AudioContext | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private oscillators: OscillatorNode[] = [];
  private gain: GainNode | undefined;
  private sinkId = '';

  setOutputDevice(deviceId: string): void {
    this.sinkId = deviceId;
  }

  startIncoming(): void {
    this.start(INCOMING);
  }

  startRingback(): void {
    this.start(RINGBACK);
  }

  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.silence();
    void this.ctx?.close().catch(() => {});
    this.ctx = undefined;
  }

  private start(pattern: Pattern): void {
    this.stop();
    try {
      this.ctx = new AudioContext();
      const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (this.sinkId && typeof ctx.setSinkId === 'function') {
        void ctx.setSinkId(this.sinkId).catch(() => {});
      }
    } catch {
      return; // no Web Audio – ringing is cosmetic, never fatal
    }
    const cycle = () => {
      this.sound(pattern.freqs);
      this.timer = setTimeout(() => {
        this.silence();
        this.timer = setTimeout(cycle, pattern.offMs);
      }, pattern.onMs);
    };
    cycle();
  }

  private sound(freqs: number[]): void {
    if (!this.ctx) return;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.08;
    this.gain.connect(this.ctx.destination);
    this.oscillators = freqs.map((f) => {
      const osc = this.ctx!.createOscillator();
      osc.frequency.value = f;
      osc.connect(this.gain!);
      osc.start();
      return osc;
    });
  }

  private silence(): void {
    this.oscillators.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
    this.oscillators = [];
    this.gain?.disconnect();
    this.gain = undefined;
  }
}
