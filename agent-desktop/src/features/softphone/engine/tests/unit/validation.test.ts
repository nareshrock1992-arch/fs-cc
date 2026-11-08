import { describe, expect, it } from 'vitest';
import {
  isDtmfTone,
  normaliseDialString,
  validateDomain,
  validateExtension,
  validatePassword,
  validateWssUrl,
} from '../../src/utils/validation';

describe('validateExtension', () => {
  it.each(['7990001', '1000', '42'])('accepts %s', (v) =>
    expect(validateExtension(v).ok).toBe(true),
  );
  it.each(['', '1', 'abc', '1000@x', '1'.repeat(16), '10 00'])('rejects %j', (v) =>
    expect(validateExtension(v).ok).toBe(false),
  );
});

describe('validatePassword', () => {
  it('requires a value', () => expect(validatePassword('').ok).toBe(false));
  it('limits length', () => expect(validatePassword('x'.repeat(129)).ok).toBe(false));
  it('accepts normal passwords', () => expect(validatePassword('A-b_c!9').ok).toBe(true));
});

describe('validateDomain', () => {
  it.each(['192.168.1.133', 'freeswitch.mylab.com', 'pbx'])('accepts %s', (v) =>
    expect(validateDomain(v).ok).toBe(true),
  );
  it.each(['', '999.1.1.1', '192.168.1', 'bad domain', 'a@b'])('rejects %j', (v) =>
    expect(validateDomain(v).ok).toBe(false),
  );
});

describe('validateWssUrl', () => {
  it('accepts wss URLs', () => {
    expect(validateWssUrl('wss://192.168.1.133:8443/sip').ok).toBe(true);
  });
  it('refuses plain ws (no insecure fallback)', () => {
    expect(validateWssUrl('ws://192.168.1.133:5066').ok).toBe(false);
  });
  it('refuses embedded credentials', () => {
    expect(validateWssUrl('wss://user:pw@host/sip').ok).toBe(false);
  });
  it('refuses garbage', () => expect(validateWssUrl('not a url').ok).toBe(false));
});

describe('normaliseDialString', () => {
  it('strips separators', () => expect(normaliseDialString(' 799-0002 ')).toBe('7990002'));
  it('keeps * # +', () => expect(normaliseDialString('*98#')).toBe('*98#'));
  it.each(['', 'sip:1000@evil', '1000;x=1', '<script>', '1'.repeat(33)])('rejects %j', (v) =>
    expect(normaliseDialString(v)).toBeUndefined(),
  );
});

describe('isDtmfTone', () => {
  it.each(['0', '9', '*', '#', 'A', 'd'])('accepts %s', (t) => expect(isDtmfTone(t)).toBe(true));
  it.each(['', '12', 'E', ' '])('rejects %j', (t) => expect(isDtmfTone(t)).toBe(false));
});
