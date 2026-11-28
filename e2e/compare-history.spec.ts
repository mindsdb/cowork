import { test, expect, type Page } from '@playwright/test';

// happy-dom has no layout, so whether the Compare Models history fits a phone,
// and what its first frame shows, needs a real browser.

const days = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const sides = [
  { label: 'a', model: 'claude-sonnet-5-5', turnCount: 3 },
  { label: 'b', model: 'gpt-5-2', turnCount: 2 },
];
const comparisons = [
  { id: 'c1', title: 'Summarize Q3 churn by plan and draft an email to the team about it', createdAt: days(3), verdict: 'b', verdicts: [], sides },
  { id: 'c2', title: 'Build a dashboard', createdAt: days(1), verdict: null, verdicts: [], sides },
];

async function openHistory(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.route('**/api/v1/**', (route) => (/\/comparisons\/?(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { comparisons, has_more: false } })
    : route.fulfill({ status: 404, json: {} })));
  await page.goto('/');
  return page.getByRole('button', { name: /^Open comparison: Summarize/ });
}

test('at 390px each comparison is a card with its prompt and both models readable', async ({ page }) => {
  const row = await openHistory(page, 390);
  await expect(row).toBeVisible();
  await expect(page.getByText('Prompt', { exact: true })).toHaveCount(0);
  const rowBox = (await row.boundingBox())!;
  for (const text of [/^Summarize Q3/, 'Claude Sonnet 5.5', /^GPT-5\.2 Thinking/]) {
    const box = (await row.getByText(text).first().boundingBox())!;
    // The reported failure: these columns collapsed to 0px wide.
    expect(box.width).toBeGreaterThan(60);
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('at 1000px the history is a table under its column headers', async ({ page }) => {
  const row = await openHistory(page, 1000);
  await expect(row).toBeVisible();
  for (const heading of ['Prompt', 'Models', 'Turns', 'Winner', 'Started']) {
    await expect(page.getByText(heading, { exact: true })).toBeVisible();
  }
});

test('coming back to the history at 390px, the first frame drawn already shows cards', async ({ page }) => {
  await expect(await openHistory(page, 390)).toBeVisible();
  await page.getByRole('button', { name: 'New comparison' }).click();
  const back = page.getByRole('button', { name: /Comparisons/ });
  await expect(back).toBeVisible();
  // Leaving the start screen remounts the history with its rows already loaded.
  // A requestAnimationFrame callback sees the DOM the browser is about to paint.
  const frames = await back.evaluate((button: HTMLElement) => new Promise<string[]>((resolve) => {
    const seen: string[] = [];
    const sample = (left: number) => requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>('[aria-label^="Open comparison:"]');
      seen.push(!row ? 'none' : row.style.gridTemplateColumns ? 'table' : 'cards');
      if (left > 0) sample(left - 1);
      else resolve(seen);
    });
    button.click();
    sample(3);
  }));
  expect(frames.filter((frame) => frame !== 'none')).toEqual(frames.filter((frame) => frame !== 'none').map(() => 'cards'));
  expect(frames).toContain('cards');
});
