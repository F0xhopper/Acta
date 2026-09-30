import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import site from '../src/content/site';

test('home loads on a phone with a call link and no serious a11y issues', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  if (site.business.phone_e164) await expect(page.locator(`a[href="tel:${site.business.phone_e164}"]`).first()).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
});

test('every service and area page responds', async ({ request }) => {
  for (const s of site.services) expect((await request.get(`/services/${s.slug}`)).status()).toBe(200);
  for (const a of site.areas) expect((await request.get(`/areas/${a.slug}`)).status()).toBe(200);
  expect((await request.get('/about')).status()).toBe(200);
  expect((await request.get('/does-not-exist')).status()).toBe(404);
});

test('contact form posts and lands on the sent state', async ({ page }) => {
  await page.goto('/contact');
  await page.fill('#name', 'Test Person');
  await page.fill('#phone', '07700 900123');
  await page.fill('#message', 'Hello from the smoke test.');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/sent=1/);
  await expect(page.getByRole('status')).toBeVisible();
});

test('contact form rejects an empty submission', async ({ page }) => {
  await page.goto('/contact');
  await page.evaluate(() => { document.querySelectorAll('[required]').forEach((el) => el.removeAttribute('required')); });
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/error=/);
});
