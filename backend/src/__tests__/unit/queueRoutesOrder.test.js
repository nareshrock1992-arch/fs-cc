// BUG-005: /preview-xml and /export-xml were registered after the queues router,
// so GET /api/queues/preview-xml was answered by /:queueName ("Queue not found").
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../controllers/queuesController.js', () => ({
  listQueues: vi.fn(), getQueue: vi.fn(), createQueue: vi.fn(), updateQueue: vi.fn(), deleteQueue: vi.fn(),
  addTier: vi.fn(), setTier: vi.fn(), removeTier: vi.fn(),
}));
vi.mock('../../../services/eslService.js', () => ({ checkQueueDrift: vi.fn() }));
vi.mock('../../../utils/queueXml.js', () => ({ writeAndReloadXml: vi.fn(), generateCallcenterXml: vi.fn() }));
vi.mock('../../../middleware/auth.js', () => ({ requireAdmin: (_q, _s, n) => n() }));

const { default: router } = await import('../../../routes/queues.js');
const routes = router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);

describe('queue routes order (BUG-005)', () => {
  it('fixed paths come before GET /:queueName', () => {
    const param = routes.indexOf('GET /:queueName');
    for (const r of ['GET /drift', 'GET /preview-xml', 'POST /export-xml']) {
      expect(routes).toContain(r);
      expect(routes.indexOf(r)).toBeLessThan(param);
    }
  });
});
