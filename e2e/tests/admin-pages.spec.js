// Admin portal pages used every day: Call Outcomes, Break Codes, Queues, plus agent status via the API.
// Real pages, real backend, disposable PostgreSQL (e2e/run.sh). No FreeSWITCH.
import { test, expect } from '@playwright/test';

const ADMIN = process.env.E2E_ADMIN_URL;
const API = process.env.E2E_API_URL + '/api';

async function adminSignIn(page) {
  await page.goto(ADMIN + '/');
  await page.getByPlaceholder('admin').fill(process.env.E2E_ADMIN_USER);
  await page.getByPlaceholder('••••••••').fill(process.env.E2E_ADMIN_PASS);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('Sign in to your account')).toBeHidden();
}
async function adminToken(request) {
  const r = await request.post(`${API}/auth/login`, { data: { username: process.env.E2E_ADMIN_USER, password: process.env.E2E_ADMIN_PASS } });
  return { headers: { Authorization: `Bearer ${(await r.json()).token}` } };
}

test.describe('Call Outcomes page (M1)', () => {
  test('add an outcome, then limit the E2E queue to it', async ({ page, request }) => {
    await adminSignIn(page);
    await page.goto(ADMIN + '/disposition-codes');
    await page.getByRole('button', { name: /Add Outcome/ }).first().click();
    await page.getByPlaceholder('Resolved', { exact: true }).fill('Callback booked (ui)');
    await page.getByPlaceholder('RESOLVED', { exact: true }).fill('UI_CALLBACK');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Callback booked (ui)', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Choose outcomes for E2E Queue' }).click();
    await page.getByLabel('Only these outcomes').check();
    await page.getByRole('checkbox', { name: 'Callback booked (ui)' }).check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('row', { name: /E2E Queue/ })).toContainText('Callback booked (ui)');

    // Saved in the database, not just on screen.
    const auth = await adminToken(request);
    const codes = await (await request.get(`${API}/disposition-codes`, auth)).json();
    const rows = Array.isArray(codes) ? codes : codes.codes || [];
    const mine = rows.find((c) => c.code === 'UI_CALLBACK');
    const queues = await (await request.get(`${API}/queues`, auth)).json();
    const q = queues.find((x) => x.name === 'e2e_q@default');
    expect(mine.queue_ids).toContain(q.id);
  });

  test('a duplicate code is refused with a message', async ({ page }) => {
    await adminSignIn(page);
    await page.goto(ADMIN + '/disposition-codes');
    await page.getByRole('button', { name: /Add Outcome/ }).first().click();
    await page.getByPlaceholder('Resolved', { exact: true }).fill('Another');
    await page.getByPlaceholder('RESOLVED', { exact: true }).fill('UI_CALLBACK');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('An outcome with that code already exists')).toBeVisible();
  });
});

test.describe('Break Codes page', () => {
  test('add a break code; it appears in the list', async ({ page }) => {
    await adminSignIn(page);
    await page.goto(ADMIN + '/break-codes');
    await page.getByRole('button', { name: /Add Break/ }).first().click();
    await page.getByPlaceholder('FIELD_VISIT').fill('UI_TRAINING');
    await page.getByPlaceholder('Field Visit').fill('Training (ui)');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Training (ui)' })).toBeVisible();
  });
});

test.describe('Queues page', () => {
  test('lists the queue with its service level target', async ({ page }) => {
    await adminSignIn(page);
    await page.goto(ADMIN + '/queues');
    await expect(page.getByText('E2E Queue')).toBeVisible();
    await page.getByRole('button', { name: 'Edit queue E2E Queue' }).click();
    await expect(page.getByLabel('Service level target in seconds')).toHaveValue('20');
  });
});

test.describe('Agent status (API, FreeSWITCH offline)', () => {
  test('admin sets On Break then Available; invalid status refused; DB follows', async ({ request }) => {
    const auth = await adminToken(request);
    const id = process.env.E2E_AGENT_ID;
    const set = (status) => request.post(`${API}/agents/${id}/status`, { ...auth, data: { status } });
    expect((await set('On Break')).status()).toBe(200);
    expect((await (await request.get(`${API}/agents/${id}`, auth)).json()).status).toBe('On Break');
    expect((await set('Asleep')).status()).toBe(400);
    expect((await set('Available')).status()).toBe(200);
    expect((await (await request.get(`${API}/agents/${id}`, auth)).json()).status).toBe('Available');
  });
});
