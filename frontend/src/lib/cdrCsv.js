// Call Detail Record CSV export (M2 Part D). The backend returns at most EXPORT_LIMIT rows per
// request, newest first; when a period holds more, the export must say so instead of silently
// dropping the oldest calls.

export const EXPORT_LIMIT = 5000;

export const CDR_COLS = [
  'call_uuid', 'ani', 'dnis', 'queue_name', 'agent',
  'queue_wait_seconds', 'ring_seconds', 'talk_seconds', 'abandoned_seconds',
  'disposition', 'outcome_code', 'outcome_name', 'outcome_notes', 'start_time', 'end_time',
];

function cell(v) {
  if (v == null) return '';
  if (typeof v !== 'string') return v;
  // Free text (agent notes) must not run as a spreadsheet formula.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV text for CDR rows (header + one line per row). */
export function buildCdrCsv(rows) {
  const body = rows.map((r) => CDR_COLS.map((c) => cell(r[c])).join(',')).join('\n');
  return `${CDR_COLS.join(',')}\n${body}`;
}

/**
 * Fetch rows for the export and find out whether the period holds more than the limit.
 * @param {(params: object) => Promise<object[]>} fetchCdr  e.g. Reports.cdr
 * @returns {Promise<{ rows: object[], truncated: boolean }>}
 */
export async function fetchForExport(fetchCdr, { from, to }) {
  const rows = await fetchCdr({ from, to, limit: EXPORT_LIMIT, offset: 0 });
  let truncated = false;
  if (rows.length >= EXPORT_LIMIT) {
    const more = await fetchCdr({ from, to, limit: 1, offset: EXPORT_LIMIT });
    truncated = more.length > 0;
  }
  return { rows: rows.slice(0, EXPORT_LIMIT), truncated };
}

/** Plain-language result line shown after an export. */
export function exportNotice({ count, truncated }) {
  const n = count.toLocaleString('en-US');
  return truncated
    ? `Exported the ${n} newest calls only — this period has more. Choose fewer days to export the rest.`
    : `Exported ${n} call${count === 1 ? '' : 's'}.`;
}
