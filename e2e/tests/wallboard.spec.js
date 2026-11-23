// M2 Part C — Wallboard. Isolated stack: the phone system (ESL) is deliberately unreachable,
// so the wallboard must say so and show "—" for live numbers, while today's totals stay.
// Fixture: e2e_sla@default has 4 answered / 2 abandoned today, service level 50.0 %.
import { test, expect } from '@playwright/test';

const ADMIN = process.env.E2E_ADMIN_URL;

async function signIn(page) {
  await page.goto(ADMIN + '/');
  await page.getByPlaceholder('admin').fill('e2e_sup');                 // a plain supervisor may use it
  await page.getByPlaceholder('••••••••').fill(process.env.E2E_SUP_PASS);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('Sign in to your account')).toBeHidden();
}

test.describe('Wallboard', () => {
  test('phone system offline: plain message, live numbers "—", today totals and 50.0 % shown', async ({ page }) => {
    await signIn(page);
    await page.goto(ADMIN + '/wallboard');
    await expect(page.getByText("Live numbers paused — the phone system isn't reachable")).toBeVisible();
    await expect(page.getByTestId('wb-waiting')).toContainText('—');
    await expect(page.getByTestId('wb-agents')).toContainText('— · — · —');
    await expect(page.getByTestId('wb-sl')).toContainText('50.0%');
    await expect(page.getByTestId('wb-calls')).toContainText('4 / 2');
    await expect(page.getByTestId('wb-row-e2e_sla@default')).toContainText('50.0%');
    await expect(page.getByTestId('wb-row-e2e_q@default')).toContainText('—');   // queue without calls
    await expect(page.getByTestId('wb-updated')).toContainText(/Updated \d+ s ago/);
  });

  test('choosing a queue is kept on this screen after a reload', async ({ page }) => {
    await signIn(page);
    await page.goto(ADMIN + '/wallboard');
    await page.getByRole('button', { name: 'Choose queues' }).click();
    await page.getByLabel('E2E Queue', { exact: true }).check();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Wallboard · E2E Queue');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Wallboard · E2E Queue');
    await expect(page.getByTestId('wb-sl')).toContainText('—');               // that queue has no calls
  });

  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    test(`fits a ${w}×${h} screen without scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await signIn(page);
      await page.evaluate(() => localStorage.removeItem('fscc.wallboard.queues'));
      await page.goto(ADMIN + '/wallboard');
      await expect(page.getByTestId('wb-sl')).toBeVisible();
      const { sh, ch, sw, cw } = await page.evaluate(() => ({
        sh: document.documentElement.scrollHeight, ch: window.innerHeight,
        sw: document.documentElement.scrollWidth, cw: window.innerWidth,
      }));
      expect(sh).toBeLessThanOrEqual(ch);
      expect(sw).toBeLessThanOrEqual(cw);
    });
  }
});
