// M2 Part B — Activity log. Real backend + disposable PostgreSQL (e2e/run.sh).
// Owner decision 2026-11-23: admins + supervisors with view_activity_log.
import { test, expect } from '@playwright/test';

const API = process.env.E2E_API_URL + '/api';
const ADMIN = process.env.E2E_ADMIN_URL;
const AUDITOR = { username: 'e2e_auditor', password: `aud-${process.env.E2E_SUP_PASS}` };

const login = async (request, username, password) => {
  const r = await request.post(`${API}/auth/login`, { data: { username, password } });
  expect(r.status(), `sign-in ${username}`).toBe(200);
  return { headers: { Authorization: `Bearer ${(await r.json()).token}` } };
};
const activity = async (request, auth, q) =>
  (await (await request.get(`${API}/activity?days=1${q ? `&q=${encodeURIComponent(q)}` : ''}`, auth)).json()).rows;

let admin;
test.beforeAll(async ({ request }) => {
  admin = await login(request, process.env.E2E_ADMIN_USER, process.env.E2E_ADMIN_PASS);
});

test.describe.serial('Activity log', () => {
  test('access: no token 401, agent token 403, plain supervisor 403, admin 200', async ({ request }) => {
    expect((await request.get(`${API}/activity`)).status()).toBe(401);
    const g = await request.post(`${API}/agent-desk/login`, { data: { agent_id: process.env.E2E_AGENT_ID, pin: process.env.E2E_AGENT_PIN } });
    const agent = { headers: { Authorization: `Bearer ${(await g.json()).token}` } };
    expect((await request.get(`${API}/activity`, agent)).status()).toBe(403);
    const sup = await login(request, 'e2e_sup', process.env.E2E_SUP_PASS);
    expect((await request.get(`${API}/activity`, sup)).status()).toBe(403);
    expect((await request.get(`${API}/activity`, admin)).status()).toBe(200);
  });

  test('a supervisor given "view activity log" can read it; the grant itself is recorded', async ({ request }) => {
    const c = await request.post(`${API}/users`, { ...admin, data: { ...AUDITOR, role: 'supervisor' } });
    expect(c.status()).toBe(201);
    const { id } = await c.json();
    const p = await request.patch(`${API}/users/${id}/permissions`, { ...admin, data: { permissions: ['view_activity_log'] } });
    expect(p.status()).toBe(200);
    const updated = await p.json();
    expect(updated.permissions).toEqual(['view_activity_log']);
    expect(updated).not.toHaveProperty('previous_permissions');   // helper column never leaks
    const auditor = await login(request, AUDITOR.username, AUDITOR.password);
    const rows = await activity(request, auditor, AUDITOR.username);
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['USER_CREATED', 'USER_PERMISSIONS_SET']));
    const grant = rows.find((r) => r.action === 'USER_PERMISSIONS_SET');
    expect(grant.actor).toBe(process.env.E2E_ADMIN_USER);
    expect(grant.new_value.permissions).toEqual(['view_activity_log']);
    expect(grant.old_value.permissions).toEqual([]);                // "before" read in the same statement
  });

  test('settings changes appear with who and before → after', async ({ request }) => {
    expect((await request.post(`${API}/break-codes`, { ...admin, data: { code: 'ACT_TEST', name: 'Activity test' } })).status()).toBe(201);
    const id = process.env.E2E_AGENT_ID;
    expect((await request.post(`${API}/agents/${id}/status`, { ...admin, data: { status: 'On Break' } })).status()).toBe(200);
    expect((await request.post(`${API}/agents/${id}/status`, { ...admin, data: { status: 'Available' } })).status()).toBe(200);

    const bc = (await activity(request, admin, 'ACT_TEST')).find((r) => r.action === 'BREAK_CODE_CREATED');
    expect(bc?.actor).toBe(process.env.E2E_ADMIN_USER);
    const st = (await activity(request, admin, id)).filter((r) => r.action === 'AGENT_STATUS_SET');
    expect(st[0]).toMatchObject({ actor: process.env.E2E_ADMIN_USER, old_value: { status: 'On Break' }, new_value: { status: 'Available' } });
  });

  test('password resets and PIN changes are recorded as facts only, never the secret', async ({ request }) => {
    const users = await (await request.get(`${API}/users`, admin)).json();
    const aud = users.find((u) => u.username === AUDITOR.username);
    const newPass = `reset-${Date.now()}`;
    expect((await request.post(`${API}/users/${aud.id}/reset-password`, { ...admin, data: { password: newPass } })).status()).toBe(200);
    const pin = '482913';
    expect((await request.post(`${API}/agents/${process.env.E2E_AGENT_ID}/set-pin`, { ...admin, data: { pin } })).status()).toBe(200);
    const all = JSON.stringify(await activity(request, admin));
    expect(all).toContain('USER_PASSWORD_RESET');
    expect(all).toContain('AGENT_PIN_SET');
    expect(all).not.toContain(newPass);
    expect(all).not.toContain(pin);
    // put the e2e agent PIN back for other test files
    await request.post(`${API}/agents/${process.env.E2E_AGENT_ID}/set-pin`, { ...admin, data: { pin: process.env.E2E_AGENT_PIN } });
  });

  test('search treats % and _ literally', async ({ request }) => {
    expect(await activity(request, admin, '%')).toEqual([]);
  });

  test('page: admin sees plain sentences; a plain supervisor has no menu entry', async ({ page }) => {
    await page.goto(ADMIN + '/');
    await page.getByPlaceholder('admin').fill(process.env.E2E_ADMIN_USER);
    await page.getByPlaceholder('••••••••').fill(process.env.E2E_ADMIN_PASS);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Sign in to your account')).toBeHidden();
    await page.goto(ADMIN + '/activity-log');
    await expect(page.getByText('Break code "Activity test" added')).toBeVisible();
    await expect(page.getByText(`User ${AUDITOR.username} may now: view activity log`)).toBeVisible();

    await page.evaluate(() => localStorage.clear());
    await page.goto(ADMIN + '/');
    await page.getByPlaceholder('admin').fill('e2e_sup');
    await page.getByPlaceholder('••••••••').fill(process.env.E2E_SUP_PASS);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Sign in to your account')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Activity Log' })).toHaveCount(0);
    await page.goto(ADMIN + '/activity-log');
    await expect(page).not.toHaveURL(/activity-log/);
  });
});
