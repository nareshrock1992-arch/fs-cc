/**
 * Duration-bug fix — fmtSec normalization mirror.
 *
 * The frontend has no test runner (frontend/package.json has no vitest), so the
 * actual fmtSec lives in frontend/src/pages/AgentPerformanceDashboard.jsx and is
 * verified by code inspection + production build. This file mirrors that exact
 * implementation and locks the required behavior: fractional/float seconds must
 * be rounded to whole seconds before formatting, so values like 14.4 or
 * 14.999999999999 can never leak decimals into the rendered mm:ss / h:mm:ss.
 *
 * Keep this in sync with fmtSec in AgentPerformanceDashboard.jsx.
 */
import { describe, it, expect } from 'vitest';

// ── Exact mirror of the hardened fmtSec ──────────────────────────────────────
function fmtSec(s) {
  if (s == null || s === '') return '—';
  const raw = Number(s);
  if (Number.isNaN(raw) || raw < 0) return '—';
  const n = Math.round(raw); // normalize fractional/float seconds → whole seconds
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), r = String(n % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

describe('fmtSec — fractional seconds never leak into the UI', () => {
  it('rounds the reported bug value 14.4 → 0:14 (was 0:14.399999999999999)', () => {
    expect(fmtSec(14.399999999999999)).toBe('0:14');
    expect(fmtSec(14.4)).toBe('0:14');
  });
  it('rounds upward: 14.999999999999 → 0:15', () => {
    expect(fmtSec(14.999999999999)).toBe('0:15');
  });
  it('zero seconds → 0:00', () => {
    expect(fmtSec(0)).toBe('0:00');
  });
  it('exactly 60 seconds → 1:00', () => {
    expect(fmtSec(60)).toBe('1:00');
  });
  it('integer under a minute → 0:57', () => {
    expect(fmtSec(57)).toBe('0:57');
  });
  it('values greater than 60 seconds pad the seconds field', () => {
    expect(fmtSec(75)).toBe('1:15');
    expect(fmtSec(65)).toBe('1:05');
  });
  it('hours roll over into h:mm:ss', () => {
    expect(fmtSec(3661)).toBe('1:01:01');
    expect(fmtSec(3599.6)).toBe('1:00:00'); // rounds up across the hour boundary
  });
  it('null / empty / negative / NaN render the em-dash placeholder', () => {
    expect(fmtSec(null)).toBe('—');
    expect(fmtSec('')).toBe('—');
    expect(fmtSec(-3)).toBe('—');
    expect(fmtSec('abc')).toBe('—');
  });
});
