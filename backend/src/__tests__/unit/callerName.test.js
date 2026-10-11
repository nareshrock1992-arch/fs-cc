// Caller-name normalization — pure unit tests (no real names/numbers beyond
// synthetic fixtures).
import { describe, it, expect } from 'vitest';
import { cleanCallerName } from '../../../utils/callerName.js';

describe('cleanCallerName', () => {
  it('returns a trimmed valid name', () => {
    expect(cleanCallerName('  Naresh Babu  ', '1001')).toBe('Naresh Babu');
  });
  it('null/empty/whitespace → null', () => {
    expect(cleanCallerName(null)).toBeNull();
    expect(cleanCallerName(undefined)).toBeNull();
    expect(cleanCallerName('')).toBeNull();
    expect(cleanCallerName('   ')).toBeNull();
  });
  it('generic placeholders → null (case-insensitive)', () => {
    for (const g of ['Unknown', 'anonymous', 'N/A', 'None', 'Restricted', 'PRIVATE', 'Withheld']) {
      expect(cleanCallerName(g, '1001')).toBeNull();
    }
  });
  it('name identical to the number → null', () => {
    expect(cleanCallerName('1001', '1001')).toBeNull();
    expect(cleanCallerName(' 1001 ', '1001')).toBeNull();
  });
  it('a numeric-looking name that differs from the number is kept', () => {
    expect(cleanCallerName('1002', '1001')).toBe('1002');
  });
  it('caps at 128 chars', () => {
    expect(cleanCallerName('x'.repeat(200), '1').length).toBe(128);
  });
});
