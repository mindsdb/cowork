import { test, expect, type Locator } from '@playwright/test';

// happy-dom has no layout, so whether a long project name truncates inside its
// row needs a real browser. Covers both row types: a task and a schedule group.

const ROWS = ['Unbroken task', 'Spaced task', 'Unbroken schedule', 'Spaced schedule'];
const VIEWPORTS = [{ width: 320, height: 700 }, { width: 390, height: 800 }, { width: 1280, height: 900 }];

// The row is the closest ancestor that holds both the title and the project link.
function rowOf(title: string, page: import('@playwright/test').Page): Locator {
  return page.locator('div.group\\/item', { has: page.getByRole('button', { name: title, exact: true }) });
}

for (const viewport of VIEWPORTS) {
  test(`long project names truncate inside their rows at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('button', { name: ROWS[0], exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0);
    // The page's own scroller clips, so the document alone would hide a row that overflows inside it.
    const scroller = page.locator('.scroll-clean').first();
    const innerOverflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(innerOverflow, 'page scroller scrolls horizontally').toBeLessThanOrEqual(0);

    for (const title of ROWS) {
      const row = rowOf(title, page);
      await expect(row).toHaveCount(1);
      const project = row.getByRole('button', { name: /^(x{120}|A very long project)/ });
      const rowBox = (await row.boundingBox())!;
      const projectBox = (await project.boundingBox())!;
      expect(projectBox.x + projectBox.width, `${title}: project link past row end`)
        .toBeLessThanOrEqual(rowBox.x + rowBox.width);
      expect(await project.evaluate((el) => el.scrollWidth > el.clientWidth), `${title}: label not truncated`).toBe(true);
      // The title keeps room to be read beside the project.
      const titleBox = (await row.getByRole('button', { name: title, exact: true }).boundingBox())!;
      expect(titleBox.width, `${title}: title squeezed`).toBeGreaterThan(40);
    }
  });
}
