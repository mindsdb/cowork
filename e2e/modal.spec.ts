import { test, expect } from '@playwright/test';

// happy-dom stubs the animation wait that strands the dialog, so only a real
// browser proves the backdrop goes and the page takes clicks again.
test('a dialog closed by an effect of its opening commit stops blocking the page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('[role=dialog]')).toHaveCount(0, { timeout: 2_000 });
  await page.getByRole('button', { name: 'Clicked 0' }).click({ timeout: 2_000 });
  await expect(page.getByRole('button', { name: 'Clicked 1' })).toBeVisible();
});
