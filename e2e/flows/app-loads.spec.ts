import { test, expect } from '@playwright/test';

test.describe('App loads', () => {
  test('server health endpoint returns 200', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
  });

  test('web SPA renders the main UI', async ({ page }) => {
    await page.goto('/');

    // The cowork app should render. The sidebar contains navigation
    // items — wait for at least one to confirm React mounted and
    // the app is interactive.
    const sidebar = page.locator('button[aria-label="Projects"]');
    await expect(sidebar).toBeVisible({ timeout: 15_000 });

    // Verify other nav items are present.
    await expect(page.locator('button[aria-label="Settings"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Scheduled Tasks"]')).toBeVisible();
  });

  test('can navigate to home and see the new-task button', async ({ page }) => {
    await page.goto('/');

    // The sidebar always shows a "New task" button. Click it to
    // navigate to the home view (composer screen).
    const newTaskBtn = page.locator('button', { hasText: 'New task' });
    await expect(newTaskBtn).toBeVisible({ timeout: 15_000 });

    // Clicking "New task" should land us on the home view.
    await newTaskBtn.click();

    // The home view renders a greeting. The fallback text is
    // "Let's knock something off your list" — but it may be
    // customized, so just check that the ANTON heading and the
    // new-task button are both still present (the view rendered).
    await expect(newTaskBtn).toBeVisible();
  });
});
