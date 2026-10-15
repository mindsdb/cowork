import { test, expect } from '@playwright/test';

/* happy-dom has no layout, so whether a figure's popover fits a small screen
   needs a real browser. The app's page never scrolls (globals.css pins html
   and body to overflow: hidden), so a popup that runs past the viewport
   leaves its title or its buttons out of reach. The fixture page does scroll,
   so each check pads the page above the first case and scrolls its figure to
   the middle of the screen, where the popup has the least room on either
   side. 640x400 is a 1280x800 window at 200% zoom. Run with `npx playwright test --config playwright.figure-sources.config.ts`. */

const SIZES = [
  { name: 'a 375x667 phone', width: 375, height: 667 },
  { name: 'a 320x568 phone', width: 320, height: 568 },
  { name: 'a 1280x800 window at 200% zoom', width: 640, height: 400 },
];

for (const size of SIZES) {
  test(`a two-source popover stays on screen on ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/figure-sources-fixture.html');
    await page.locator('main').evaluate((el) => { el.style.paddingTop = '100vh'; });
    const mark = page.locator('#case-sourced-and-unsourced').getByRole('button', { name: '250, from a file' });
    await mark.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const markBox = (await mark.boundingBox())!;
    expect(Math.abs(markBox.y + markBox.height / 2 - size.height / 2)).toBeLessThan(size.height / 8);
    await mark.click();

    const popup = page.getByRole('dialog', { name: 'Where 250 came from' });
    await expect(popup).toBeVisible();
    const box = (await popup.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);

    // Every action stays reachable: the list scrolls inside the popup.
    const last = popup.getByRole('button', { name: 'Open step' }).last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y).toBeGreaterThanOrEqual(box.y);
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(box.y + box.height);
  });
}

test('a one-source popover is as wide as its content, not the widest it may be', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/figure-sources-fixture.html');
  await page.locator('#case-attached-file').getByRole('button', { name: '118, from a file' }).click();
  const popup = page.getByRole('dialog', { name: 'Where 118 came from' });
  await expect(popup).toBeVisible();
  const { width } = (await popup.boundingBox())!;
  expect(width).toBeGreaterThanOrEqual(240);
  expect(width).toBeLessThan(400);
});

test('a long file name ends in an ellipsis inside the widest popover, whole on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/figure-sources-fixture.html');
  await page.locator('#case-long-file-name').getByRole('button', { name: '96, from a file' }).click();
  const popup = page.getByRole('dialog', { name: 'Where 96 came from' });
  await expect(popup).toBeVisible();
  expect((await popup.boundingBox())!.width).toBeLessThanOrEqual(440);
  const name = 'q3-2026-inventory-snapshot-by-site-and-part-exported-from-the-planning-system.csv';
  const label = popup.getByTitle(name);
  await expect(label).toHaveText(name);
  expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});
