// FS-CC browser smoke tests: real pages, real backend, real (disposable) PostgreSQL.
// No FreeSWITCH: ESL points at a closed port on purpose (see e2e/run.sh).
import { test, expect } from '@playwright/test';

const ADMIN = process.env.E2E_ADMIN_URL;
const AGENT = process.env.E2E_AGENT_URL;
const admin = { user: process.env.E2E_ADMIN_USER, pass: process.env.E2E_ADMIN_PASS };
const agent = { id: process.env.E2E_AGENT_ID, pin: process.env.E2E_AGENT_PIN };

async function adminSignIn(page, pass = admin.pass, { expectSuccess = true } = {}) {
  await page.goto(ADMIN + '/');
  await page.getByPlaceholder('admin').fill(admin.user);
  await page.getByPlaceholder('••••••••').fill(pass);
  await page.locator('button[type="submit"]').click();
  // Wait for the sign-in to finish before navigating, or the portal (correctly) sends us back to sign-in.
  if (expectSuccess) await expect(page.getByText('Sign in to your account')).toBeHidden();
}

test.describe('Admin portal', () => {
  test('wrong password: stays on sign-in with an error', async ({ page }) => {
    await adminSignIn(page, 'wrong-password', { expectSuccess: false });
    await expect(page.getByText('Sign in to your account')).toBeVisible();
    await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible();
  });

  test('sign in, open Agents, see the seeded agent', async ({ page }) => {
    await adminSignIn(page);
    await page.goto(ADMIN + '/agents');
    await expect(page.getByText(agent.id)).toBeVisible();
  });

  test('external-phone mode: Edit agent shows no browser phone option', async ({ page }) => {
    await adminSignIn(page);
    await page.goto(ADMIN + '/agents');
    await page.getByRole('button', { name: 'Edit agent' }).first().click();
    await expect(page.getByText(`Edit Agent — ${agent.id}`)).toBeVisible();
    await expect(page.getByText('Endpoint Type', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('1002')).toHaveValue('1999');   // internal agent, extension parsed from contact
    await expect(page.getByText('Enable browser phone')).toHaveCount(0);
  });
});

test.describe('Agent Desktop', () => {
  test('wrong PIN: stays on sign-in', async ({ page }) => {
    await page.goto(AGENT + '/');
    await page.getByPlaceholder('e.g. agent_1001').fill(agent.id);
    await page.getByPlaceholder('••••').fill('000000');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible();
    await expect(page.getByPlaceholder('e.g. agent_1001')).toBeVisible();
  });

  test('sign in with PIN: workspace loads, no browser phone in external-phone mode', async ({ page }) => {
    await page.goto(AGENT + '/');
    await page.getByPlaceholder('e.g. agent_1001').fill(agent.id);
    await page.getByPlaceholder('••••').fill(agent.pin);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByPlaceholder('e.g. agent_1001')).toBeHidden();
    await expect(page.getByText('MY QUEUES NOW', { exact: false })).toBeVisible();
    await expect(page.getByPlaceholder('SIP password')).toHaveCount(0);
  });
});
