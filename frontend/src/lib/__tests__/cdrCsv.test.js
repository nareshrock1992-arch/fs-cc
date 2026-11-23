import { describe, expect, it, vi } from 'vitest';
import { buildCdrCsv, fetchForExport, exportNotice, EXPORT_LIMIT, CDR_COLS } from '../cdrCsv.js';

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ call_uuid: `c${i}` }));

describe('CDR export', () => {
  it('builds a header plus one line per row; quotes and formulas are made safe', () => {
    const csv = buildCdrCsv([{ call_uuid: 'a', outcome_notes: '=HYPERLINK("x")', ani: 'say "hi", ok' }]);
    const [head, line] = csv.split('\n');
    expect(head).toBe(CDR_COLS.join(','));
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);      // formula neutralised, quotes doubled
    expect(line).toContain('"say ""hi"", ok"');
  });

  it('under the limit: one request, not cut', async () => {
    const f = vi.fn(async () => rowsOf(12));
    const r = await fetchForExport(f, { from: 'a', to: 'b' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ truncated: false });
    expect(r.rows.length).toBe(12);
  });

  it('exactly the limit and nothing more: checked, not cut', async () => {
    const f = vi.fn(async (p) => (p.offset === 0 ? rowsOf(EXPORT_LIMIT) : []));
    const r = await fetchForExport(f, { from: 'a', to: 'b' });
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1][0]).toMatchObject({ limit: 1, offset: EXPORT_LIMIT });
    expect(r.truncated).toBe(false);
  });

  it('more than the limit: the export says it was cut', async () => {
    const f = vi.fn(async (p) => (p.offset === 0 ? rowsOf(EXPORT_LIMIT) : rowsOf(1)));
    const r = await fetchForExport(f, { from: 'a', to: 'b' });
    expect(r.truncated).toBe(true);
    expect(r.rows.length).toBe(EXPORT_LIMIT);
  });

  it('plain-language notices', () => {
    expect(exportNotice({ count: 5000, truncated: true }))
      .toBe('Exported the 5,000 newest calls only — this period has more. Choose fewer days to export the rest.');
    expect(exportNotice({ count: 1, truncated: false })).toBe('Exported 1 call.');
    expect(exportNotice({ count: 42, truncated: false })).toBe('Exported 42 calls.');
  });
});
