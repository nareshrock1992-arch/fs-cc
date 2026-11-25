/**
 * Real PostgreSQL migration tests (OPS-4). Run only when FSCC_REAL_DB=1 and the DB_* env
 * points at a DISPOSABLE database (scripts/test-all.sh suite "cc-db" creates one on the
 * dev socket, port 5433). Skipped in normal unit runs.
 */
import { afterAll, describe, expect, it } from 'vitest';

const REAL = process.env.FSCC_REAL_DB === '1';
const d = REAL ? describe : describe.skip;

d('fs-cc migrations on a real database', () => {
  let pool, runMigrations;
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const viewUses = async (col) => (await q(`SELECT pg_get_viewdef('queue_history') ~ $1 AS ok`, [col]))[0].ok;

  afterAll(async () => { await pool?.end(); });

  it('safety: refuses anything but a disposable *_test_* database', () => {
    expect(process.env.DB_NAME).toMatch(/_test_/);
  });

  it('fresh install: baseline + every numbered migration apply in order', async () => {
    ({ pool } = await import('../../../db/pool.js'));
    ({ runMigrations } = await import('../../../db/migrationRunner.js'));
    await runMigrations();
    const applied = (await q('SELECT version FROM schema_migrations')).map((r) => r.version);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(import.meta.dirname, '../../../db/migrations');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) expect(applied).toContain(f);
    expect(await viewUses('sla_seconds')).toBe(true);
  });

  it('existing install still on the old view: migration 016 switches it to sla_seconds', async () => {
    // Recreate the pre-016 state of a long-running deployment.
    await q(`DELETE FROM schema_migrations WHERE version = '016_queue_history_sla_seconds.sql'`);
    // Only the queue_history statement of the baseline (call_history was since extended by 011).
    const fs = await import('node:fs');
    const path = await import('node:path');
    const baseline = fs.readFileSync(path.resolve(import.meta.dirname, '../../../db/migrate_cdr_views.sql'), 'utf8');
    const oldView = baseline.slice(baseline.indexOf('CREATE OR REPLACE VIEW queue_history'));
    expect(oldView).toMatch(/q\.max_wait_time\s+AS queue_sla_threshold/);
    await pool.query(oldView);
    expect(await viewUses('max_wait_time')).toBe(true);
    await runMigrations();
    expect(await viewUses('sla_seconds')).toBe(true);
  });

  it('running migrations again changes nothing', async () => {
    const before = await q('SELECT count(*)::int AS n FROM schema_migrations');
    await runMigrations();
    const after = await q('SELECT count(*)::int AS n FROM schema_migrations');
    expect(after[0].n).toBe(before[0].n);
  });

  it('queue_history reports the service level target, not max wait time', async () => {
    await q(`INSERT INTO queues (name, display_name, strategy, max_wait_time, max_queue_size, sla_seconds)
             VALUES ('ops4_q@test', 'OPS4', 'longest-idle-agent', 0, 10, 25) ON CONFLICT (name) DO NOTHING`);
    await q(`INSERT INTO calls (call_uuid, queue_name, queue_enter_time) VALUES (gen_random_uuid()::text, 'ops4_q@test', now())`);
    const rows = await q(`SELECT queue_sla_threshold FROM queue_history WHERE queue_name = 'ops4_q@test'`);
    expect(rows[0].queue_sla_threshold).toBe(25);
  });
});
