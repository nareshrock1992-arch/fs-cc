// Activity log (M2 follow-up): queue create / change / delete and agent membership
// changes are recorded in audit_log with who did it and what changed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: {
    queueAdd: vi.fn(), queueSetParam: vi.fn(), queueDel: vi.fn(),
    tierAdd: vi.fn(), tierSetLevel: vi.fn(), tierSetPosition: vi.fn(), tierSetState: vi.fn(), tierDel: vi.fn(),
  },
}));
vi.mock('../../../services/auditService.js', () => ({
  writeAudit: vi.fn(async () => 1),
  staffActor: (req) => ({ actor: req.user.username, actorRole: req.user.role }),
}));

const { query } = await import('../../../db/pool.js');
const { writeAudit } = await import('../../../services/auditService.js');
const qc = await import('../../../controllers/queuesController.js');

const QROW = { id: 7, name: 'sales@default', display_name: 'Sales', strategy: 'longest-idle-agent',
  max_wait_time: 300, max_queue_size: 50, agent_no_answer_status: 'On Break', sla_seconds: 20, active: true,
  moh_sound: 'local_stream://moh', created_at: '2026-11-24T00:00:00Z' };

/** Answer each SQL by the first matching fragment; unmatched → no rows. */
function sql(routes) {
  query.mockImplementation(async (text) => {
    for (const [frag, result] of routes) if (text.includes(frag)) return typeof result === 'function' ? result() : result;
    return { rows: [], rowCount: 0 };
  });
}
function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  r.end = vi.fn(() => r);
  return r;
}
const req = (extra) => ({ user: { username: 'admin', role: 'admin' }, params: {}, body: {}, ...extra });
const audits = () => writeAudit.mock.calls.map(([a]) => a);

beforeEach(() => { query.mockReset(); writeAudit.mockClear(); });

describe('queues', () => {
  it('create → QUEUE_CREATED with the settings, by the signed-in admin', async () => {
    sql([['INSERT INTO queues', { rows: [QROW] }]]);
    const r = res();
    await qc.createQueue(req({ body: { name: 'sales', displayName: 'Sales' } }), r);
    expect(r.statusCode).toBe(201);
    expect(audits()).toEqual([{ actor: 'admin', actorRole: 'admin', action: 'QUEUE_CREATED', entityType: 'queue',
      entityId: 'sales@default',
      newValue: { display_name: 'Sales', strategy: 'longest-idle-agent', max_wait_time: 300, max_queue_size: 50,
                  agent_no_answer_status: 'On Break', sla_seconds: 20, active: true } }]);
  });

  it('change → QUEUE_UPDATED with only the changed fields (+ name), response without the helper column', async () => {
    sql([['UPDATE queues SET', { rows: [{ ...QROW, sla_seconds: 30, strategy: 'ring-all',
      previous_values: { ...QROW } }] }]]);
    const r = res();
    await qc.updateQueue(req({ params: { queueName: 'sales@default' }, body: { slaSeconds: 30, strategy: 'ring-all' } }), r);
    expect(r.body).not.toHaveProperty('previous_values');
    expect(r.body.sla_seconds).toBe(30);
    expect(audits()).toEqual([expect.objectContaining({ action: 'QUEUE_UPDATED', entityId: 'sales@default',
      oldValue: { display_name: 'Sales', strategy: 'longest-idle-agent', sla_seconds: 20 },
      newValue: { display_name: 'Sales', strategy: 'ring-all', sla_seconds: 30 } })]);
    const [text] = query.mock.calls.find(([t]) => t.includes('UPDATE queues SET'));
    expect(text).toContain('WITH prev AS (SELECT * FROM queues WHERE name = $1)');
  });

  it('save without real changes → no activity row', async () => {
    sql([['UPDATE queues SET', { rows: [{ ...QROW, previous_values: { ...QROW } }] }]]);
    await qc.updateQueue(req({ params: { queueName: 'sales@default' }, body: { displayName: 'Sales' } }), res());
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('change of an unknown queue → 404, nothing recorded', async () => {
    sql([['UPDATE queues SET', { rows: [] }]]);
    const r = res();
    await qc.updateQueue(req({ params: { queueName: 'nope@default' }, body: { slaSeconds: 30 } }), r);
    expect(r.statusCode).toBe(404);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('delete → QUEUE_DELETED with what the queue was; unknown queue → 404, nothing recorded', async () => {
    sql([['DELETE FROM queues', { rows: [QROW] }]]);
    const r = res();
    await qc.deleteQueue(req({ params: { queueName: 'sales@default' } }), r);
    expect(r.statusCode).toBe(204);
    expect(audits()[0]).toMatchObject({ action: 'QUEUE_DELETED', entityId: 'sales@default',
      oldValue: { display_name: 'Sales', sla_seconds: 20 } });

    writeAudit.mockClear();
    sql([['DELETE FROM queues', { rows: [] }]]);
    const r2 = res();
    await qc.deleteQueue(req({ params: { queueName: 'gone@default' } }), r2);
    expect(r2.statusCode).toBe(404);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe('agents in a queue', () => {
  const ids = [['SELECT id FROM queues', { rows: [{ id: 7 }] }], ['SELECT id FROM agents', { rows: [{ id: 3 }] }]];

  it('add a new member → QUEUE_AGENT_ADDED', async () => {
    sql([...ids, ['SELECT level, position FROM agent_tiers', { rows: [] }]]);
    await qc.addTier(req({ params: { queueName: 'sales@default' }, body: { agentId: 'alice@default', level: 1, position: 2 } }), res());
    expect(audits()).toEqual([expect.objectContaining({ action: 'QUEUE_AGENT_ADDED', entityId: 'sales@default',
      newValue: { agent_id: 'alice@default', level: 1, position: 2 } })]);
  });

  it('re-add with a new level → QUEUE_AGENT_UPDATED; same values → nothing', async () => {
    sql([...ids, ['SELECT level, position FROM agent_tiers', { rows: [{ level: 1, position: 2 }] }]]);
    await qc.addTier(req({ params: { queueName: 'sales@default' }, body: { agentId: 'alice@default', level: 3, position: 2 } }), res());
    expect(audits()).toEqual([expect.objectContaining({ action: 'QUEUE_AGENT_UPDATED',
      oldValue: { agent_id: 'alice@default', level: 1, position: 2 },
      newValue: { agent_id: 'alice@default', level: 3, position: 2 } })]);

    writeAudit.mockClear();
    await qc.addTier(req({ params: { queueName: 'sales@default' }, body: { agentId: 'alice@default', level: 1, position: 2 } }), res());
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('change level → QUEUE_AGENT_UPDATED from the same statement', async () => {
    sql([...ids, ['UPDATE agent_tiers', { rows: [{ level: 2, position: 1, prev_level: 1, prev_position: 1 }] }]]);
    const r = res();
    await qc.setTier(req({ params: { queueName: 'sales@default', agentId: 'alice@default' }, body: { level: 2 } }), r);
    expect(r.statusCode).toBe(200);
    expect(audits()).toEqual([expect.objectContaining({ action: 'QUEUE_AGENT_UPDATED',
      oldValue: { agent_id: 'alice@default', level: 1, position: 1 },
      newValue: { agent_id: 'alice@default', level: 2, position: 1 } })]);
  });

  it('not a member → 404, nothing recorded', async () => {
    sql([...ids, ['UPDATE agent_tiers', { rows: [] }]]);
    const r = res();
    await qc.setTier(req({ params: { queueName: 'sales@default', agentId: 'bob@default' }, body: { level: 2 } }), r);
    expect(r.statusCode).toBe(404);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('state change → QUEUE_AGENT_STATE_SET', async () => {
    sql(ids);
    await qc.setTier(req({ params: { queueName: 'sales@default', agentId: 'alice@default' }, body: { state: 'Standby' } }), res());
    expect(audits()).toEqual([expect.objectContaining({ action: 'QUEUE_AGENT_STATE_SET',
      newValue: { agent_id: 'alice@default', state: 'Standby' } })]);
  });

  it('remove → QUEUE_AGENT_REMOVED only when the agent really was a member', async () => {
    sql([...ids, ['DELETE FROM agent_tiers', { rows: [{ level: 1, position: 2 }] }]]);
    await qc.removeTier(req({ params: { queueName: 'sales@default', agentId: 'alice@default' } }), res());
    expect(audits()).toEqual([expect.objectContaining({ action: 'QUEUE_AGENT_REMOVED',
      oldValue: { agent_id: 'alice@default', level: 1, position: 2 } })]);

    writeAudit.mockClear();
    sql([...ids, ['DELETE FROM agent_tiers', { rows: [] }]]);
    await qc.removeTier(req({ params: { queueName: 'sales@default', agentId: 'bob@default' } }), res());
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe('queueChanges', () => {
  it('lists only changed fields, null when nothing changed', () => {
    expect(qc.queueChanges(QROW, { ...QROW })).toBeNull();
    expect(qc.queueChanges(QROW, { ...QROW, active: false })).toEqual({ oldValue: { active: true }, newValue: { active: false } });
  });
});
