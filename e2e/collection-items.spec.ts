import { test, expect, type Page } from '@playwright/test';

// happy-dom has no layout, so whether a hover overlay steals a click needs a real browser.

async function clickAndExpect(page: Page, name: string, event: string) {
  const control = page.getByRole('button', { name, exact: true });
  await control.hover();
  await control.click({ trial: true }); // fails if another element intercepts the pointer
  await control.click();
  await expect(page.getByLabel('Events')).toHaveText(new RegExp(`(^|\\|)${event}$`));
}

test('a control shown at rest in a row stays clickable beside the row actions', async ({ page }) => {
  await page.goto('/');
  await clickAndExpect(page, 'Disconnect', 'Gmail disconnect');
  await clickAndExpect(page, 'Gmail menu', 'Gmail menu');
});

test('always-visible row actions do not cover the meta', async ({ page }) => {
  await page.goto('/');
  const meta = await page.getByText('Updated 2h ago').boundingBox();
  const menu = await page.getByRole('button', { name: 'Slack menu' }).boundingBox();
  expect(meta!.x + meta!.width).toBeLessThanOrEqual(menu!.x);
  await clickAndExpect(page, 'Slack menu', 'Slack menu');
});

test('hover actions still overlay plain meta and open from the row', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Notion', exact: true }).hover(); // reveals the hidden menu
  await clickAndExpect(page, 'Notion menu', 'Notion menu');
  await page.getByRole('button', { name: 'Notion', exact: true }).click();
  await expect(page.getByLabel('Events')).toHaveText(/Notion open$/);
});
