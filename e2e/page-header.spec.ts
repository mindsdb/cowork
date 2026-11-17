import { test, expect, type Page } from '@playwright/test';

// ENG-3998: a page description wraps at its column edge, not at a fixed
// width. happy-dom has no layout, so this needs a real browser. Set
// PAGE_HEADER_SHOTS=<dir> to also save a screenshot of each page and width.
//
// "More than 64 characters on the first line" isn't a usable check on its
// own: `64ch` is 64 widths of "0", and most letters are narrower, so the old
// cap already fit more than 64 characters. The check that tells the cap apart
// is where the first line ends: at the column's right edge, within one word.

const PAGES = [
  { view: 'scheduled', title: 'Scheduled Tasks', action: 'Schedule task' },
  { view: 'artifacts', title: 'Live Artifacts', action: null },
] as const;

// Room for the next word that didn't fit, at 13.5px.
const ONE_WORD = 120;

// The description's first rendered line: its character count and right edge.
async function firstLine(page: Page) {
  return page.locator('h1 + p').evaluate((p) => {
    const text = p.firstChild as Text;
    const range = document.createRange();
    let top: number | null = null;
    let right = 0;
    for (let i = 0; i < text.length; i++) {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (top === null) top = rect.top;
      else if (rect.top > top + 2) return { chars: i, right, wraps: true };
      right = rect.right;
    }
    return { chars: text.length, right, wraps: false };
  });
}

for (const { view, title, action } of PAGES) {
  for (const width of [1440, 800, 390]) {
    test(`${title} at ${width}px: the description wraps at its column edge`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?view=${view}`);
      const desc = page.locator('h1 + p');
      await expect(desc).toBeVisible();

      const dir = process.env.PAGE_HEADER_SHOTS;
      if (dir) await page.screenshot({ path: `${dir}/${view}-${width}.png`, clip: { x: 0, y: 0, width, height: 220 } });

      const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(scroll.doc, 'page does not scroll sideways').toBeLessThanOrEqual(scroll.inner);

      // The text column is the description's parent, left of any actions.
      const column = (await desc.locator('xpath=..').boundingBox())!;
      const columnRight = column.x + column.width;
      const line = await firstLine(page);
      expect(line.right, 'first line stays inside its column').toBeLessThanOrEqual(columnRight + 0.5);
      // A description that fits on one line ends where its text does.
      if (line.wraps) {
        expect(line.right, 'a wrapped first line reaches the column edge').toBeGreaterThan(columnRight - ONE_WORD);
      }
      if (width === 1440) expect(line.chars, 'first line runs past 64 characters').toBeGreaterThan(64);

      if (action) {
        const p = (await desc.boundingBox())!;
        const button = (await page.getByRole('button', { name: action }).boundingBox())!;
        const besideText = button.y < p.y + p.height && button.y + button.height > p.y;
        if (besideText) {
          expect(line.right, `description stays left of ${action}`).toBeLessThanOrEqual(button.x);
        }
      }
    });
  }
}
