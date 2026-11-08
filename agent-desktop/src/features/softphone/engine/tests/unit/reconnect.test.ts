import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, ReconnectScheduler } from '../../src/services/reconnect';

describe('backoffDelay', () => {
  const noJitter = () => 0;
  it('grows exponentially and caps', () => {
    expect(backoffDelay(1, 2000, 30000, noJitter)).toBe(2000);
    expect(backoffDelay(2, 2000, 30000, noJitter)).toBe(4000);
    expect(backoffDelay(4, 2000, 30000, noJitter)).toBe(16000);
    expect(backoffDelay(10, 2000, 30000, noJitter)).toBe(30000);
  });
  it('adds at most 20% jitter and never exceeds max', () => {
    expect(backoffDelay(1, 2000, 30000, () => 1)).toBe(2400);
    expect(backoffDelay(10, 2000, 30000, () => 1)).toBe(30000);
  });
});

describe('ReconnectScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries until the action succeeds', async () => {
    let calls = 0;
    const action = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('down');
    });
    const s = new ReconnectScheduler(
      action,
      () => {},
      () => 100,
    );
    s.schedule();
    await vi.advanceTimersByTimeAsync(100); // attempt 1 fails -> reschedule
    await vi.advanceTimersByTimeAsync(100); // attempt 2 fails -> reschedule
    await vi.advanceTimersByTimeAsync(100); // attempt 3 succeeds
    expect(action).toHaveBeenCalledTimes(3);
    expect(s.pending).toBe(false);
  });

  it('only keeps one pending timer', () => {
    const action = vi.fn(async () => {});
    const s = new ReconnectScheduler(
      action,
      () => {},
      () => 100,
    );
    s.schedule();
    s.schedule();
    expect(s.attempts).toBe(1);
  });

  it('cancel and reset stop retries', async () => {
    const action = vi.fn(async () => {});
    const s = new ReconnectScheduler(
      action,
      () => {},
      () => 100,
    );
    s.schedule();
    s.reset();
    await vi.advanceTimersByTimeAsync(500);
    expect(action).not.toHaveBeenCalled();
    expect(s.attempts).toBe(0);
  });

  it('now() runs immediately', () => {
    const action = vi.fn(async () => {});
    const s = new ReconnectScheduler(
      action,
      () => {},
      () => 100,
    );
    s.now();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
