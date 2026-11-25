// M2 Part D — CDR export says when the 5 000-row limit cut the period.
// Loads 5 001 non-queue calls dated 3 days ago into the disposable e2e database (inside the
// Reports page's default 7-day range, outside every "today" figure other tests check).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const ADMIN = process.env.E2E_ADMIN_URL;
const require = createRequire(new URL('../../backend/package.json', import.meta.url));

test.beforeAll(async () => {
  if (!/_e2e$/.test(process.env.DB_NAME || '')) throw new Error('refusing: not the e2e database');
  const { Client } = require('pg');
  const db = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER });
  await db.connect();
  await db.query(
    `INSERT INTO calls (call_uuid, start_time, end_time, disposition)
     SELECT 'e2e-bulk-' || g, now() - interval '3 days' - g * interval '1 second',
            now() - interval '3 days' - g * interval '1 second' + interval '30 seconds', 'answered'
       FROM generate_series(1, 5001) g
     ON CONFLICT (call_uuid) DO NOTHING`,
  );
  await db.end();
});

test('exporting a period with more than 5 000 calls: file has 5 000 rows and the page says it was cut', async ({ page }) => {
  await page.goto(ADMIN + '/');
  await page.getByPlaceholder('admin').fill(process.env.E2E_ADMIN_USER);
  await page.getByPlaceholder('••••••••').fill(process.env.E2E_ADMIN_PASS);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('Sign in to your account')).toBeHidden();
  await page.goto(ADMIN + '/reports');
  await page.getByRole('button', { name: 'CDR Report' }).click();
  await expect(page.getByText('Call Detail Records')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const lines = fs.readFileSync(await download.path(), 'utf8').trim().split('\n');
  expect(lines.length).toBe(1 + 5000);   // header + the limit
  await expect(page.getByTestId('cdr-export-note'))
    .toHaveText('Exported the 5,000 newest calls only — this period has more. Choose fewer days to export the rest.');
});
