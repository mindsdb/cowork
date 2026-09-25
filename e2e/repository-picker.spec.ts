import { test, expect, type Page } from '@playwright/test';

const repos = [
  { full_name: 'mindsdb/cowork', clone_url: 'https://github.com/mindsdb/cowork.git', private: true, default_branch: 'staging', archived: false, connection_name: 'work' },
  { full_name: 'ianu82/code-mode-demo', clone_url: 'https://github.com/ianu82/code-mode-demo.git', private: false, default_branch: 'main', archived: false, connection_name: 'work' },
  { full_name: 'mindsdb/a-long-repository-name-that-still-needs-to-fit-on-a-narrow-window', clone_url: 'https://github.com/mindsdb/long.git', private: true, default_branch: 'main', archived: true, connection_name: 'work' },
];

async function fixture(page: Page, repositoryStatus = 200) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/github/repositories')) {
      await route.fulfill({ status: repositoryStatus, json: repositoryStatus === 200 ? { items: repos, next_page: null } : { detail: 'This connection has expired or lacks permission for that resource' } });
    } else if (route.request().method() === 'POST') {
      await route.fulfill({ json: { ...route.request().postDataJSON(), id: 'saved-project' } });
    } else {
      await route.fulfill({ json: url.pathname.endsWith('/engines') ? [] : { items: [], sources: [] } });
    }
  });
}

for (const variant of [
  { name: 'dark', query: 'theme=dark', width: 1280, height: 900 },
  { name: 'light', query: 'theme=light', width: 1280, height: 900 },
  { name: '8bit', query: 'theme=light&skin=8bit', width: 1280, height: 900 },
  { name: 'compact', query: 'theme=dark', width: 1024, height: 640 },
  { name: 'narrow', query: 'theme=light', width: 390, height: 844 },
]) {
  test(`repository selection and project save — ${variant.name}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await fixture(page);
    await page.goto(`/?${variant.query}`);
    await page.getByRole('button', { name: 'Git repository', exact: true }).click();
    await expect(page.getByRole('button', { name: 'mindsdb/cowork Private Add', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${variant.name}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const search = page.getByRole('textbox', { name: 'Search repositories' });
    await search.fill('cowork');
    await expect(page.getByText('ianu82/code-mode-demo')).toHaveCount(0);
    await search.press('Tab');
    await expect(page.getByRole('button', { name: 'mindsdb/cowork Private Add', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('cowork');
    await expect(page.getByRole('checkbox', { name: /MindsDB/ })).toBeChecked();
    await page.getByRole('button', { name: 'Save project' }).click();
    await expect(page.getByLabel('Saved project')).toContainText('"connector_name": "work"');
    await expect(page.getByLabel('Saved project')).toContainText('"default_branch": "staging"');
    expect(errors).toEqual([]);
  });
}

test('connecting an account preserves an unsaved project draft', async ({ page }) => {
  await fixture(page);
  await page.goto('/?disconnected');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Keep this draft');
  await page.getByRole('button', { name: 'Git repository', exact: true }).click();
  await page.getByRole('button', { name: 'Connect GitHub' }).click();
  await page.getByRole('button', { name: 'Finish connection (test fixture)' }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Keep this draft');
  await page.getByRole('button', { name: 'Git repository', exact: true }).click();
  await page.getByRole('button', { name: 'mindsdb/cowork Private Add', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Keep this draft');
});

test('permission errors leave manual URL entry usable', async ({ page }, testInfo) => {
  await fixture(page, 409);
  await page.goto('/?theme=dark');
  await page.getByRole('button', { name: 'Git repository', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('lacks permission');
  await page.screenshot({ path: testInfo.outputPath('permission-error.png') });
  await page.getByRole('button', { name: 'Paste repository URL' }).click();
  await page.getByRole('textbox', { name: 'Git repository URL' }).fill('https://gitlab.com/acme/api.git');
  await page.getByRole('textbox', { name: 'Git repository URL' }).press('Enter');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByLabel('Saved project')).toContainText('https://gitlab.com/acme/api.git');
});
