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
const { requireSupervisor } = await import('../../../middleware/auth.js');

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
