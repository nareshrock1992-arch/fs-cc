// Phase 1A — protected pre-queue API + supervisor authorization.
// Dependency-free: the controller reads the pure in-memory store; the DB pool is
// mocked only because callsController imports it at module load (eslService →
// pool). No DB call is made by listPreQueueCalls.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
// eslService (imported by callsController) pulls in modesl/db at load; stub it
// to a minimal surface so the controller import is side-effect free in tests.
vi.mock('../../../services/eslService.js', () => ({ cc: {}, isConnected: () => false }));

const store = await import('../../../services/preQueueStore.js');
const { listPreQueueCalls } = await import('../../../controllers/callsController.js');
const { requireSupervisor, hasExplicitPermission, hasPermission } = await import('../../../middleware/auth.js');

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json   = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => store.clear());

describe('requireSupervisor — authorization', () => {
  const run = (role) => {
    const req = { user: role ? { role } : null };
    const res = mockRes();
    const next = vi.fn();
    requireSupervisor(req, res, next);
    return { res, next };
  };
  it('allows admin and supervisor', () => {
    expect(run('admin').next).toHaveBeenCalledOnce();
    expect(run('supervisor').next).toHaveBeenCalledOnce();
  });
  it('denies agent, unknown role, and unauthenticated', () => {
    for (const role of ['agent', 'viewer', null]) {
      const { res, next } = run(role);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });
});

describe('GET /calls/prequeue controller', () => {
  it('returns masked, unknown-safe rows for active pre-queue callers', async () => {
    store.observe('0123456789abcdef', { ani: '96650009999', stage: 'play:welcome', now: 1000 });
    const res = mockRes();
    await listPreQueueCalls({}, res);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('01234567');
    expect(body[0].callerMasked).toBe('•••••••••99');
    expect(body[0].eligibilityReason).toBeNull();
    expect(body[0].targetQueue).toBeNull();
    expect(JSON.stringify(body)).not.toContain('96650009999'); // raw ANI never leaves
  });
  it('returns an empty array when no callers are in the IVR', async () => {
    const res = mockRes();
    await listPreQueueCalls({}, res);
    expect(res.json.mock.calls[0][0]).toEqual([]);
  });
});

// ── view_caller_id: explicit permission only (Option B — no admin bypass) ──────
describe('hasExplicitPermission — view_caller_id (no admin bypass)', () => {
  const P = 'view_caller_id';
  it('grants ONLY when the permission is explicitly listed', () => {
    expect(hasExplicitPermission({ role: 'supervisor', permissions: ['view_caller_id'] }, P)).toBe(true);
    expect(hasExplicitPermission({ role: 'admin',      permissions: ['view_caller_id'] }, P)).toBe(true);
  });
  it('denies admin role WITHOUT the explicit permission (Option B: no implicit admin grant)', () => {
    expect(hasExplicitPermission({ role: 'admin', permissions: [] }, P)).toBe(false);
    expect(hasExplicitPermission({ role: 'admin' }, P)).toBe(false);
  });
  it('denies supervisor without it, unknown shapes, and unauthenticated', () => {
    expect(hasExplicitPermission({ role: 'supervisor', permissions: ['view_reports'] }, P)).toBe(false);
    expect(hasExplicitPermission({ role: 'supervisor' }, P)).toBe(false);
    expect(hasExplicitPermission(null, P)).toBe(false);
    expect(hasExplicitPermission({ permissions: 'not-an-array' }, P)).toBe(false);
  });
});

// Option A: admins implicitly hold all permissions, plus explicit grants.
describe('hasPermission — view_caller_id (admin implicit + explicit grant)', () => {
  const P = 'view_caller_id';
  it('grants to admin (implicitly) and to anyone with the explicit permission', () => {
    expect(hasPermission({ role: 'admin', permissions: [] }, P)).toBe(true);     // admin: all rights
    expect(hasPermission({ role: 'admin' }, P)).toBe(true);
    expect(hasPermission({ role: 'supervisor', permissions: ['view_caller_id'] }, P)).toBe(true);
  });
  it('denies supervisor without the permission, and unauthenticated', () => {
    expect(hasPermission({ role: 'supervisor', permissions: ['view_reports'] }, P)).toBe(false);
    expect(hasPermission({ role: 'supervisor' }, P)).toBe(false);
    expect(hasPermission(null, P)).toBe(false);
  });
});

describe('GET /calls/prequeue — full caller ID + name gating', () => {
  const RAW = '96650007788';
  const NAME = 'Naresh Babu';
  beforeEach(() => store.observe('0123456789abcdef', { ani: RAW, name: NAME, stage: 'pressed_1', now: 1000 }));

  it('AUTHORIZED (explicit view_caller_id) → includes full number AND caller name', async () => {
    const res = mockRes();
    await listPreQueueCalls({ user: { role: 'supervisor', permissions: ['view_caller_id'] } }, res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.caller).toBe(RAW);           // full number revealed
    expect(row.callerName).toBe(NAME);      // name revealed
    expect(row.callerMasked).toBe('•••••••••88'); // masked still present
  });

  it('UNAUTHORIZED supervisor → masked only; NO raw ANI AND NO caller name in any field', async () => {
    const res = mockRes();
    await listPreQueueCalls({ user: { role: 'supervisor', permissions: [] } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body[0].caller).toBeUndefined();            // raw number field omitted
    expect(body[0].callerName).toBeUndefined();        // name field omitted
    expect(body[0].callerMasked).toBe('•••••••••88');
    expect(JSON.stringify(body)).not.toContain(RAW);   // number not recoverable
    expect(JSON.stringify(body)).not.toContain(NAME);  // name not recoverable
  });

  it('ADMIN → full number AND name (admin has all rights — Option C)', async () => {
    const res = mockRes();
    await listPreQueueCalls({ user: { role: 'admin', permissions: [] } }, res);
    const row = res.json.mock.calls[0][0][0];
    expect(row.caller).toBe(RAW);
    expect(row.callerName).toBe(NAME);
    expect(row.callerMasked).toBe('•••••••••88');
  });

  it('missing/unauthenticated req.user → fails closed to masked (no raw ANI, no name)', async () => {
    const res = mockRes();
    await listPreQueueCalls({}, res);                  // no user (route-level requireAuth gates access separately)
    const body = res.json.mock.calls[0][0];
    expect(body[0].caller).toBeUndefined();
    expect(body[0].callerName).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(RAW);
    expect(JSON.stringify(body)).not.toContain(NAME);
  });
});
