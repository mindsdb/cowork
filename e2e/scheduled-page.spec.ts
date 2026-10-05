import { test, expect, type Page } from '@playwright/test';

// A long project name must truncate inside its row or card, not widen the page.
// happy-dom has no layout, so this needs a real browser.

async function checkProjectLinks(page: Page) {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll, 'page does not scroll sideways').toBeLessThanOrEqual(widths.inner);
  // One name with no spaces, one with spaces; both 120 characters.
  const buttons = page.locator('button', { hasText: /^(Q{120}|Quarterly revenue.*)$/ });
  await expect(buttons).toHaveCount(2);
  for (const button of await buttons.all()) {
    const result = await button.evaluate((el) => {
      // The item is the nearest ancestor that holds the title activator.
      let item: HTMLElement | null = el.parentElement;
      while (item && !item.querySelector('[data-item-activator]')) item = item.parentElement;
      return {
        right: el.getBoundingClientRect().right,
        itemRight: item!.getBoundingClientRect().right,
        truncated: el.scrollWidth > el.clientWidth,
      };
    });
    expect(result.right, 'project link stays inside its item').toBeLessThanOrEqual(result.itemRight);
    expect(result.truncated, 'project label is truncated').toBe(true);
  }
}

// Phones always get rows, so a grid preference at 390px still renders rows;
// 640px is the narrowest width that shows cards.
const CASES = [
  { view: 'list', width: 320, rendered: 'list' },
  { view: 'list', width: 390, rendered: 'list' },
  { view: 'list', width: 1280, rendered: 'list' },
  { view: 'grid', width: 390, rendered: 'list' },
  { view: 'grid', width: 640, rendered: 'grid' },
  { view: 'grid', width: 1280, rendered: 'grid' },
];

for (const { view, width, rendered } of CASES) {
  test(`${view} preference at ${width}px: a long project name truncates inside its ${rendered === 'grid' ? 'card' : 'row'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 640 ? 800 : 900 });
    await page.goto(`/?view=${view}`);
    await expect(page.getByText('Weekly metrics')).toBeVisible();
    // Cards say "Run now"; rows say "Run". Proves which layout rendered.
    await expect(page.getByRole('button', { name: rendered === 'grid' ? 'Run now' : 'Run', exact: true })).toHaveCount(2);
    await checkProjectLinks(page);
  });

  test(`${view} preference at ${width}px: Run and the menu are visible without hovering`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 640 ? 800 : 900 });
    await page.goto(`/?view=${view}`);
    await expect(page.getByText('Weekly metrics')).toBeVisible();
    await page.mouse.move(0, 0);
    const controls = [
      ...(await page.getByRole('button', { name: rendered === 'grid' ? 'Run now' : 'Run', exact: true }).all()),
      ...(await page.getByRole('button', { name: 'More actions' }).all()),
    ];
    expect(controls).toHaveLength(4);
    for (const control of controls) {
      // Walk up to the root: any ancestor at opacity 0 or visibility hidden hides it.
      const shown = await control.evaluate((el) => {
        for (let n: Element | null = el; n; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        }
        return true;
      });
      expect(shown).toBe(true);
    }
    // Actions shown at rest must take their own space, not overlay the title
    // (an absolutely positioned cluster covers long titles on cards).
    for (const control of controls) {
      const overlaid = await control.evaluate((el) => {
        for (let n: Element | null = el.parentElement; n && !n.className.toString().includes('group/item'); n = n.parentElement) {
          if (getComputedStyle(n).position === 'absolute') return true;
        }
        return false;
      });
      expect(overlaid).toBe(false);
    }
  });
}
