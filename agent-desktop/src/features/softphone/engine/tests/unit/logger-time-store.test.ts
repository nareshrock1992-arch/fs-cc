import { describe, expect, it, vi } from 'vitest';
import { redact } from '../../src/utils/logger';
import { formatDuration } from '../../src/utils/time';
import { Store } from '../../src/services/store';
import { sameOriginWssUrl } from '../../src/config/config';

describe('redact', () => {
  it('masks Authorization headers and digest fields', () => {
    const msg =
      'REGISTER sip:192.168.1.133 SIP/2.0\r\n' +
      'Authorization: Digest username="7990001", realm="192.168.1.133", nonce="abc", response="deadbeef"\r\n' +
      'Proxy-Authorization: Digest response="x"\r\n';
    const out = redact(msg);
    expect(out).not.toContain('deadbeef');
    expect(out).not.toContain('nonce="abc"');
    expect(out).toContain('Authorization: ***REDACTED***');
    expect(out).toContain('Proxy-Authorization: ***REDACTED***');
  });
  it('masks password fields', () => {
    expect(redact('{"password":"secret"}')).not.toContain('secret');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [9_999, '0:09'],
    [65_000, '1:05'],
    [3_726_000, '1:02:06'],
    [-5, '0:00'],
  ])('%i ms -> %s', (ms, text) => expect(formatDuration(ms)).toBe(text));
});

describe('Store', () => {
  it('merges updates and notifies listeners with new and previous state', () => {
    const store = new Store({ a: 1, b: 'x' });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.update({ a: 2 });
    store.update((s) => ({ b: s.b + 'y' }));
    expect(store.get()).toEqual({ a: 2, b: 'xy' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]?.[1]).toEqual({ a: 1, b: 'x' });
    unsubscribe();
    store.update({ a: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('sameOriginWssUrl', () => {
  it('builds the Option A proxy URL', () => {
    expect(sameOriginWssUrl({ host: '192.168.1.133:8443' })).toBe('wss://192.168.1.133:8443/sip');
  });
});
