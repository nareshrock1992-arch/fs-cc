// FS-CC API: sign-in, roles and permissions, and settings management, against the real
// backend + disposable PostgreSQL of the isolated e2e stack (e2e/run.sh). No FreeSWITCH.
import { test, expect } from '@playwright/test';

const API = process.env.E2E_API_URL + '/api';
const tokens = {};

async function signIn(request, username, password) {
  const r = await request.post(`${API}/auth/login`, { data: { username, password } });
  expect(r.status(), `sign-in ${username}`).toBe(200);
  return (await r.json()).token;
}
const as = (who) => ({ headers: { Authorization: `Bearer ${tokens[who]}` } });

test.beforeAll(async ({ request }) => {
  tokens.admin = await signIn(request, process.env.E2E_ADMIN_USER, process.env.E2E_ADMIN_PASS);
  tokens.sup = await signIn(request, 'e2e_sup', process.env.E2E_SUP_PASS);
  tokens.supCodes = await signIn(request, 'e2e_sup_codes', process.env.E2E_SUP_PASS);
  const a = await request.post(`${API}/agent-desk/login`, { data: { agent_id: process.env.E2E_AGENT_ID, pin: process.env.E2E_AGENT_PIN } });
  expect(a.status(), 'agent sign-in').toBe(200);
  tokens.agent = (await a.json()).token;
});

test.describe('Sign-in and tokens', () => {
  test('no token or a forged token is refused (401)', async ({ request }) => {
    expect((await request.get(`${API}/agents`)).status()).toBe(401);
    expect((await request.get(`${API}/agents`, { headers: { Authorization: 'Bearer not.a.jwt' } })).status()).toBe(401);
  });
  test('wrong password is refused and gives no token', async ({ request }) => {
    const r = await request.post(`${API}/auth/login`, { data: { username: process.env.E2E_ADMIN_USER, password: 'wrong' } });
    expect(r.status()).toBe(401);
    expect((await r.json()).token).toBeUndefined();
  });
  test('an Agent Desktop token cannot use the admin API (403)', async ({ request }) => {
    for (const path of ['/agents', '/queues', '/break-codes', '/disposition-codes', '/users']) {
      expect((await request.get(`${API}${path}`, as('agent'))).status(), path).toBe(403);
    }
  });
  test('an admin token cannot use the Agent Desktop API', async ({ request }) => {
    expect((await request.get(`${API}/agent-desk/wrapup`, as('admin'))).status()).toBeGreaterThanOrEqual(401);
  });
});

test.describe('Roles', () => {
  test('user management is admin-only', async ({ request }) => {
    expect((await request.get(`${API}/users`, as('sup'))).status()).toBe(403);
    const r = await request.get(`${API}/users`, as('admin'));
    expect(r.status()).toBe(200);
    const names = (await r.json()).map((u) => u.username);
    expect(names).toEqual(expect.arrayContaining(['e2e_admin', 'e2e_sup', 'e2e_sup_codes']));
  });
  test('admin cannot grant an unknown permission (400)', async ({ request }) => {
    const users = await (await request.get(`${API}/users`, as('admin'))).json();
    const sup = users.find((u) => u.username === 'e2e_sup');
    const r = await request.patch(`${API}/users/${sup.id}/permissions`, { ...as('admin'), data: { permissions: ['become_root'] } });
    expect(r.status()).toBe(400);
  });
  test('supervisors can read agents and queues but not change agent setup', async ({ request }) => {
    expect((await request.get(`${API}/agents`, as('sup'))).status()).toBe(200);
    expect((await request.get(`${API}/queues`, as('sup'))).status()).toBe(200);
    expect((await request.post(`${API}/agents`, { ...as('sup'), data: {} })).status()).toBe(403);
    expect((await request.put(`${API}/agents/${process.env.E2E_AGENT_ID}`, { ...as('sup'), data: {} })).status()).toBe(403);
    expect((await request.post(`${API}/agents/${process.env.E2E_AGENT_ID}/set-pin`, { ...as('sup'), data: { pin: '1234' } })).status()).toBe(403);
    expect((await request.post(`${API}/queues`, { ...as('sup'), data: {} })).status()).toBe(403);
  });
  test('changing an agent status needs the change_agent_state right', async ({ request }) => {
    const r = await request.post(`${API}/agents/${process.env.E2E_AGENT_ID}/status`, { ...as('sup'), data: { status: 'On Break' } });
    expect(r.status()).toBe(403);
  });
});

test.describe('Break codes', () => {
  test('need manage_break_codes: plain supervisor 403, permitted supervisor 200', async ({ request }) => {
    expect((await request.get(`${API}/break-codes`, as('sup'))).status()).toBe(403);
    expect((await request.get(`${API}/break-codes`, as('supCodes'))).status()).toBe(200);
  });
  test('create, reject duplicate and invalid code, deactivate', async ({ request }) => {
    const c = await request.post(`${API}/break-codes`, { ...as('admin'), data: { code: 'E2E_LUNCH', name: 'E2E lunch' } });
    expect(c.status()).toBe(201);
    const created = await c.json();
    expect((await request.post(`${API}/break-codes`, { ...as('admin'), data: { code: 'e2e_lunch', name: 'again' } })).status()).toBe(409);
    expect((await request.post(`${API}/break-codes`, { ...as('admin'), data: { code: 'x', name: 'bad' } })).status()).toBe(400);
    expect((await request.patch(`${API}/break-codes/${created.id}/status`, { ...as('admin'), data: { active: 'no' } })).status()).toBe(400);
    expect((await request.patch(`${API}/break-codes/${created.id}/status`, { ...as('admin'), data: { active: false } })).status()).toBe(200);
  });
});

test.describe('Call outcomes (M1)', () => {
  test('need manage_dispositions: plain supervisor 403, permitted supervisor 200', async ({ request }) => {
    expect((await request.get(`${API}/disposition-codes`, as('sup'))).status()).toBe(403);
    expect((await request.get(`${API}/disposition-codes`, as('supCodes'))).status()).toBe(200);
  });
  test('create, duplicate, reserved SYSTEM_ prefix, and limit a queue to one outcome', async ({ request }) => {
    const c = await request.post(`${API}/disposition-codes`, { ...as('admin'), data: { code: 'E2E_RESOLVED', name: 'Resolved (e2e)' } });
    expect(c.status()).toBe(201);
    const outcome = await c.json();
    expect((await request.post(`${API}/disposition-codes`, { ...as('admin'), data: { code: 'E2E_RESOLVED', name: 'dup' } })).status()).toBe(409);
    expect((await request.post(`${API}/disposition-codes`, { ...as('admin'), data: { code: 'SYSTEM_FAKE', name: 'nope' } })).status()).toBe(400);

    const queues = await (await request.get(`${API}/queues`, as('admin'))).json();
    const q = queues.find((x) => x.name === 'e2e_q@default');
    expect(q, 'seeded queue').toBeTruthy();
    expect((await request.put(`${API}/disposition-codes/queues/${q.id}`, { ...as('admin'), data: { code_ids: [outcome.id] } })).status()).toBe(200);
    expect((await request.put(`${API}/disposition-codes/queues/999999`, { ...as('admin'), data: { code_ids: [outcome.id] } })).status()).toBe(404);
    expect((await request.put(`${API}/disposition-codes/queues/${q.id}`, { ...as('admin'), data: { code_ids: 'all' } })).status()).toBe(400);

    const list = await (await request.get(`${API}/disposition-codes`, as('admin'))).json();
    const rows = Array.isArray(list) ? list : list.codes || [];
    const mine = rows.find((x) => x.code === 'E2E_RESOLVED');
    expect(mine.queue_ids).toContain(q.id);
  });
});

test.describe('Agent Desktop API', () => {
  test('agent reads its own wrap-ups (empty on a fresh database)', async ({ request }) => {
    const r = await request.get(`${API}/agent-desk/wrapup`, as('agent'));
    expect(r.status()).toBe(200);
  });
  test('Ready now is refused when there is no call to wrap up', async ({ request }) => {
    const r = await request.post(`${API}/agent-desk/wrapup/ready`, as('agent'));
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });
});
