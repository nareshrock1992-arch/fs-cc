// BUG-004: queues already loaded from callcenter.conf.xml answer "-ERR no reply" to
// "queue add"; DB parameters must still be applied.
import { describe, it, expect, vi } from 'vitest';

vi.mock('modesl', () => ({ default: { Connection: vi.fn() } }));
vi.mock('../../../config/index.js', () => ({
  config: { esl: { host: 'localhost', port: 8021, password: 'x', reconnectMs: 3000 }, fs: {} },
}));
vi.mock('../../../db/pool.js', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../../../services/agentSessionService.js', () => ({
  handleStatusTransition: vi.fn(), reconcileOnStartup: vi.fn(),
}));

const { queueAddUsable } = await import('../../../services/eslService.js');

describe('queueAddUsable (BUG-004)', () => {
  it('+OK / empty → apply parameters', () => {
    expect(queueAddUsable('+OK', false)).toBe(true);
    expect(queueAddUsable('', false)).toBe(true);
  });
  it('"-ERR no reply" for an already-loaded queue → apply parameters', () => {
    expect(queueAddUsable('-ERR no reply', true)).toBe(true);
  });
  it('"already exists" wording → apply parameters', () => {
    expect(queueAddUsable('-ERR queue already exists', false)).toBe(true);
  });
  it('real failure for a queue FreeSWITCH does not have → skip', () => {
    expect(queueAddUsable('-ERR no reply', false)).toBe(false);
    expect(queueAddUsable('-ERR Invalid Queue not found!', false)).toBe(false);
  });
});
