/**
 * M1 — disposition code catalog (admin): validation, system-code protection, queue
 * assignment, and route permission (manage_dispositions; agents/other staff refused).
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/dispositionCodesController.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/auditService.js', () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  staffActor: () => ({ actor: 'admin@test', actorRole: 'admin' }),
}));

import { query } from '../../../db/pool.js';
import { writeAudit } from '../../../services/auditService.js';
import * as ctl from '../../../controllers/dispositionCodesController.js';
import router from '../../../routes/dispositionCodes.js';
import { requirePermission } from '../../../middleware/auth.js';

function makeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b)   { this.body = b; return this; },
  };
}
const ROW = { id: 3, code: 'RESOLVED', name: 'Resolved', active: true, is_system: false, queue_ids: [], queue_names: [] };
const SYSTEM_ROW = { ...ROW, id: 1, code: 'SYSTEM_DISCONNECTED', is_system: true };

beforeEach(() => { vi.clearAllMocks(); query.mockResolvedValue({ rows: [] }); });

describe('create', () => {
  it('validates code format, reserved SYSTEM_ prefix and name', async () => {
    for (const body of [{ name: 'x' }, { code: 'a b', name: 'x' }, { code: 'SYSTEM_X', name: 'x' }, { code: 'OK1' }]) {
      const res = makeRes();
      await ctl.createDispositionCode({ body }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('creates an upper-cased code, audited, 201', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 3 }] }).mockResolvedValueOnce({ rows: [ROW] });
    const res = makeRes();
    await ctl.createDispositionCode({ body: { code: 'resolved', name: ' Resolved ' } }, res);
    expect(res.statusCode).toBe(201);
    expect(query.mock.calls[0][1].slice(0, 2)).toEqual(['RESOLVED', 'Resolved']);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DISPOSITION_CODE_CREATED' }));
  });

  it('duplicate code → 409', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = makeRes();
    await ctl.createDispositionCode({ body: { code: 'RESOLVED', name: 'Resolved' } }, res);
    expect(res.statusCode).toBe(409);
  });
});

describe('system codes are read-only', () => {
  it('update, status and queue assignment refuse a system code (403)', async () => {
    for (const [fn, body] of [
      [ctl.updateDispositionCode, { name: 'x' }],
      [ctl.setDispositionCodeStatus, { active: false }],
    ]) {
      query.mockReset();
      query.mockResolvedValueOnce({ rows: [SYSTEM_ROW] });
      const res = makeRes();
      await fn({ params: { id: '1' }, body }, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('SYSTEM_DISPOSITION');
      expect(query).toHaveBeenCalledTimes(1);       // no UPDATE / DELETE / INSERT
    }
  });
});

describe('deactivate (soft)', () => {
  it('sets active=false, never deletes', async () => {
    query.mockResolvedValueOnce({ rows: [ROW] }).mockResolvedValueOnce({ rows: [] })
         .mockResolvedValueOnce({ rows: [{ ...ROW, active: false }] });
    const res = makeRes();
    await ctl.setDispositionCodeStatus({ params: { id: '3' }, body: { active: false } }, res);
    expect(res.statusCode).toBe(200);
    expect(query.mock.calls.some(([sql]) => /DELETE/i.test(sql))).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DISPOSITION_CODE_DEACTIVATED' }));
  });
});

describe('queue assignment (per queue)', () => {
  const params = { queueId: '7' };

  it('rejects bad input, unknown queues and system/unknown outcomes', async () => {
    let res = makeRes();
    await ctl.setQueueDispositions({ params, body: { code_ids: 'all' } }, res);
    expect(res.statusCode).toBe(400);

    query.mockResolvedValueOnce({ rows: [] });                                   // queue lookup
    res = makeRes();
    await ctl.setQueueDispositions({ params, body: { code_ids: [3] } }, res);
    expect(res.statusCode).toBe(404);

    query.mockResolvedValueOnce({ rows: [{ id: 7, name: 'support@default' }] })
         .mockResolvedValueOnce({ rows: [{ id: 3 }] });                          // 1 = system → not returned
    res = makeRes();
    await ctl.setQueueDispositions({ params, body: { code_ids: [3, 1] } }, res);
    expect(res.statusCode).toBe(400);
    const check = query.mock.calls.find(([sql]) => /FROM disposition_codes WHERE id = ANY/.test(sql));
    expect(check[0]).toContain('is_system = false');
    expect(query.mock.calls.some(([sql]) => /INSERT INTO queue_disposition_codes/.test(sql))).toBe(false);
  });

  it('replaces the queue\'s set: removes unlisted outcomes, adds listed ones idempotently, audited', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7, name: 'support@default' }] })  // queue
         .mockResolvedValueOnce({ rows: [{ id: 3 }, { id: 4 }] })                // codes valid
         .mockResolvedValueOnce({ rows: [{ disposition_code_id: 5 }] })          // before
         .mockResolvedValueOnce({ rows: [] })                                    // DELETE
         .mockResolvedValueOnce({ rows: [] });                                   // INSERT
    const res = makeRes();
    await ctl.setQueueDispositions({ params, body: { code_ids: [4, 3, 4] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ queue_id: 7, code_ids: [3, 4] });
    const del = query.mock.calls.find(([sql]) => /DELETE FROM queue_disposition_codes/.test(sql));
    expect(del[1]).toEqual([7, [4, 3]]);
    const ins = query.mock.calls.find(([sql]) => /INSERT INTO queue_disposition_codes/.test(sql));
    expect(ins[0]).toContain('ON CONFLICT DO NOTHING');
    expect(ins[1]).toEqual([7, [4, 3]]);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'QUEUE_DISPOSITIONS_SET', oldValue: { code_ids: [5] }, newValue: { code_ids: [3, 4] } }));
  });

  it('an empty list returns the queue to "all active outcomes"', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7, name: 'support@default' }] })
         .mockResolvedValueOnce({ rows: [{ disposition_code_id: 3 }] })
         .mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await ctl.setQueueDispositions({ params, body: { code_ids: [] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.code_ids).toEqual([]);
    expect(query.mock.calls.some(([sql]) => /INSERT INTO queue_disposition_codes/.test(sql))).toBe(false);
  });
});

describe('route permission', () => {
  it('the router is guarded by requirePermission(manage_dispositions) as its first layer', () => {
    const first = router.stack[0];
    expect(first.route).toBeUndefined();                 // router-level middleware
    const guard = requirePermission('manage_dispositions');
    const run = (user) => {
      const res = makeRes(); let passed = false;
      first.handle({ user }, res, () => { passed = true; });
      return { passed, status: res.statusCode };
    };
    expect(run({ role: 'admin' }).passed).toBe(true);
    expect(run({ role: 'supervisor', permissions: ['manage_dispositions'] }).passed).toBe(true);
    expect(run({ role: 'supervisor', permissions: ['manage_break_codes'] })).toEqual({ passed: false, status: 403 });
    expect(run({ role: 'agent' })).toEqual({ passed: false, status: 403 });
    expect(typeof guard).toBe('function');
  });
});
