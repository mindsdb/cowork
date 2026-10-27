import { test, expect, type Page } from '@playwright/test';

// happy-dom has no layout, so whether a grid track starves the title needs a
// real browser. The card's head is `auto minmax(0, 1fr) auto`: anything that
// widens the actions track comes straight out of the title's.

const title = 'Fastest Animals Dashboard';
const card = (page: Page, id: string) => page.getByTestId(id).locator('.chat-artifact-card');
const width = async (page: Page, id: string, name: string) =>
  (await card(page, id).getByRole('button', { name, exact: true }).boundingBox())!.width;

test('a disabled action and its reason leave the title readable', async ({ page }) => {
  await page.goto('/');
  for (const w of [440, 380]) {
    const id = `disabled-${w}`;
    expect(await width(page, id, title)).toBeGreaterThan(120);
    await expect(card(page, id).getByText(/no project folder/)).toBeVisible();
    await expect(card(page, id).getByRole('button', { name: 'Preview' })).toBeDisabled();
  }
});

test('the primary action stays beside the title at 440px and drops under it at 380px', async ({ page }) => {
  await page.goto('/');
  const row = async (id: string) => {
    const t = (await card(page, id).getByRole('button', { name: title, exact: true }).boundingBox())!;
    const b = (await card(page, id).getByRole('button', { name: 'Preview' }).boundingBox())!;
    return { beside: Math.abs(t.y - b.y) < t.height, titleWidth: t.width };
  };
  expect(await row('ready-440')).toMatchObject({ beside: true });
  expect((await row('ready-440')).titleWidth).toBeGreaterThan(120);
  expect(await row('ready-380')).toMatchObject({ beside: false });
});

test('keyboard focus keeps its ring while the pointer hovers a railed card', async ({ page }) => {
  await page.goto('/');
  const target = card(page, 'ready-440');
  const shadow = () => target.evaluate((el) => getComputedStyle(el).boxShadow);
  const ring = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--ring').trim());
  const ringColor = ring.match(/rgba?\([^)]*\)/)![0].replace(/\s+/g, '');
  const hasRing = async () => (await shadow()).replace(/\s+/g, '').includes(ringColor);

  // Shadows transition on the glow curve, so each read polls until settled.
  await page.mouse.move(0, 0);
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
  await expect.poll(hasRing).toBe(true);

  await target.hover({ position: { x: 200, y: 20 } });
  await expect.poll(hasRing).toBe(true);
  // The hover's deeper shadow is still there under the ring.
  await expect.poll(async () => (await shadow()).split('px,').length).toBeGreaterThan(2);
});
