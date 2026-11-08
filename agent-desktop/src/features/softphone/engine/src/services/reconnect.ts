/**
 * Exponential back-off for re-connecting the WebSocket transport.
 * attempt 1 -> ~base, attempt 2 -> ~2*base, ... capped at max. Jitter (0..20%) spreads retries.
 */
export function backoffDelay(
  attempt: number,
  baseMs = 2000,
  maxMs = 30000,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = exp * 0.2 * random();
  return Math.round(Math.min(maxMs, exp + jitter));
}

/** Schedules at most one pending retry at a time. */
export class ReconnectScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;

  constructor(
    private readonly action: (attempt: number) => Promise<void>,
    private readonly onAttempt: (attempt: number, delayMs: number) => void = () => {},
    private readonly delayFor: (attempt: number) => number = (a) => backoffDelay(a),
  ) {}

  get attempts(): number {
    return this.attempt;
  }

  get pending(): boolean {
    return this.timer !== undefined;
  }

  schedule(): void {
    if (this.timer !== undefined) return;
    this.attempt += 1;
    const delay = this.delayFor(this.attempt);
    this.onAttempt(this.attempt, delay);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.action(this.attempt).catch(() => this.schedule());
    }, delay);
  }

  /** Retry immediately (e.g. browser came back online). */
  now(): void {
    this.cancel();
    this.attempt += 1;
    this.onAttempt(this.attempt, 0);
    this.action(this.attempt).catch(() => this.schedule());
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  reset(): void {
    this.cancel();
    this.attempt = 0;
  }
}
