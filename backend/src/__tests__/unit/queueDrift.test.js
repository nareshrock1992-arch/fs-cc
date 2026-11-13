// BUG-004: FreeSWITCH 1.10.12 mod_callcenter has no "queue add" / "queue set";
// queue parameters come only from callcenter.conf.xml. The backend loads queues and
// reports drift between the database and the running queue instead of sending
// commands FreeSWITCH silently ignores.
import { describe, it, expect, vi } from 'vitest';

vi.mock('modesl', () => ({ default: { Connection: vi.fn() } }));
vi.mock('../../../config/index.js', () => ({
  config: { esl: { host: 'localhost', port: 8021, password: 'x', reconnectMs: 3000 }, fs: {} },
}));
vi.mock('../../../db/pool.js', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../../../services/agentSessionService.js', () => ({
  handleStatusTransition: vi.fn(), reconcileOnStartup: vi.fn(),
}));

const { queueDrift, checkQueueDrift, cc } = await import('../../../services/eslService.js');

const db = {
  strategy: 'longest-idle-agent', moh_sound: 'local_stream://moh', max_wait_time: 300,
  max_wait_time_w_no_agent: 0, agent_no_answer_status: 'On Break',
};
const fsRow = {
  strategy: 'longest-idle-agent', moh_sound: 'local_stream://moh', max_wait_time: '0',
  max_wait_time_with_no_agent: '0', agent_no_answer_status: 'On Break',
};

describe('queueDrift (BUG-004)', () => {
  it('reports the DEV case: max wait 300 in DB, 0 in FreeSWITCH', () => {
    expect(queueDrift(db, fsRow)).toEqual([{ field: 'max_wait_time', db: '300', fs: '0' }]);
  });
  it('no drift when the XML matches the database (number vs string, defaults)', () => {
    expect(queueDrift({ ...db, max_wait_time: 0, moh_sound: null }, fsRow)).toEqual([]);
  });
  it('queue not loaded is reported', () => {
    expect(queueDrift(db, undefined)).toEqual([{ field: 'loaded', db: 'yes', fs: 'not loaded' }]);
  });
  it('several differences are all listed', () => {
    const d = queueDrift({ ...db, strategy: 'round-robin', agent_no_answer_status: 'Logged Out' }, fsRow).map((x) => x.field);
    expect(d).toEqual(['strategy', 'max_wait_time', 'agent_no_answer_status']);
  });
});

describe('cc queue helpers send only commands mod_callcenter supports', () => {
  it('queueSetParam sends nothing and says why', async () => {
    const r = await cc.queueSetParam('q@d', 'strategy', 'round-robin');
    expect(r).toMatch(/not supported/);
  });
});

describe('checkQueueDrift (UI-1)', () => {
  const dbQ = { name: 'A@d', ...db };
  it('lists differences per queue', async () => {
    const r = await checkQueueDrift({ fetchDbQueues: async () => [dbQ], listFsQueues: async () => [{ name: 'A@d', ...fsRow }] });
    expect(r).toEqual({ checked: 1, eslConnected: true, drift: [{ queue: 'A@d', field: 'max_wait_time', db: '300', fs: '0' }] });
  });
  it('in sync → empty drift', async () => {
    const r = await checkQueueDrift({ fetchDbQueues: async () => [{ ...dbQ, max_wait_time: 0 }], listFsQueues: async () => [{ name: 'A@d', ...fsRow }] });
    expect(r.drift).toEqual([]);
  });
  it('ESL down → eslConnected false, no false alarm', async () => {
    const r = await checkQueueDrift({ fetchDbQueues: async () => [dbQ], listFsQueues: async () => { throw new Error('ESL not connected'); } });
    expect(r).toEqual({ checked: 1, eslConnected: false, drift: [] });
  });
});
