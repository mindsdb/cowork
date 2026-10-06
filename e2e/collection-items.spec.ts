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

test('a long description truncates inside the page width', async ({ page }) => {
  await page.goto('/');
  const group = await page.getByRole('region', { name: 'Long' }).boundingBox();
  expect(group!.x + group!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const description = page.getByText(/^Run an extremely strict review/);
  expect(await description.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

// Phone width (<640px): meta takes its own line under the title.
test.describe('phone width, hover-capable pointer', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  // The cluster that fades in and out is the HoverActions wrapper around the button.
  const clusterOpacity = (page: Page, name: string) =>
    page.getByRole('button', { name, exact: true }).evaluate((el) => getComputedStyle(el.parentElement!).opacity);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true);
  });

  test('a meta control shown at rest does not push hover-only actions onto an extra line', async ({ page }) => {
    const plain = await page.getByTestId('plain-row').boundingBox();
    const linked = await page.getByTestId('revealed-meta-row').boundingBox();
    expect(Math.abs(linked!.height - plain!.height)).toBeLessThanOrEqual(1);

    await page.mouse.move(0, 0);
    await expect.poll(() => clusterOpacity(page, 'Linked menu')).toBe('0');
    await page.getByRole('button', { name: 'Linked task', exact: true }).hover();
    await expect.poll(() => clusterOpacity(page, 'Linked menu')).toBe('1');
    await clickAndExpect(page, 'Linked menu', 'Linked menu');
  });

  test('actions shown at rest stay visible', async ({ page }) => {
    await page.mouse.move(0, 0);
    await expect.poll(() => clusterOpacity(page, 'Pinned menu')).toBe('1');
    const menu = page.getByRole('button', { name: 'Pinned menu', exact: true });
    expect(await menu.evaluate((el) => getComputedStyle(el.parentElement!).position)).not.toBe('absolute');
    await clickAndExpect(page, 'Pinned menu', 'Pinned menu');
  });

  test('an unbreakable meta word stays inside the row and the page', async ({ page }) => {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    // The fixture's html/body clip overflow (globals.css), so also check the group itself.
    const group = page.getByRole('region', { name: 'Phone' });
    expect(await group.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const row = await page.getByTestId('long-meta-row').boundingBox();
    const meta = await page.getByTestId('long-meta').evaluate((el) => {
      const r = el.parentElement!.getBoundingClientRect();
      return { right: r.right, textRight: el.getBoundingClientRect().right };
    });
    expect(meta.right).toBeLessThanOrEqual(row!.x + row!.width);
    expect(meta.textRight).toBeLessThanOrEqual(row!.x + row!.width);
  });
});

test.describe('desktop width', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('hover-only actions flow beside a meta control shown at rest', async ({ page }) => {
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Linked menu', exact: true });
    expect(await menu.evaluate((el) => getComputedStyle(el.parentElement!).position)).not.toBe('absolute');
    await page.getByRole('button', { name: 'Linked task', exact: true }).hover();
    const project = await page.getByRole('button', { name: 'Linked project', exact: true }).boundingBox();
    const menuBox = await menu.boundingBox();
    expect(project!.x + project!.width).toBeLessThanOrEqual(menuBox!.x);
    await clickAndExpect(page, 'Linked project', 'Linked project');
  });
});
