import { test, expect } from '@playwright/test';

// Computed timings need a real stylesheet cascade, which jsdom lacks. The
// repository-picker fixture already loads globals.css, so this borrows its page.
const probe = () => {
  const root = document.createElement('div');
  root.innerHTML = '<nav class="app-sidebar"><button class="nav-item">Projects</button><div class="recent-item">Task</div></nav><a href="#">Link</a>';
  document.body.append(root);
  const read = (selector: string) => getComputedStyle(root.querySelector(selector)!).transitionDuration;
  const durations = { nav: read('.nav-item'), recent: read('.recent-item'), link: read('a') };
  root.remove();
  return durations;
};

test('Code Mode sidebar and base interactive hovers are instant', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(probe)).toEqual({ nav: '0.1s, 0.1s', recent: '0.1s, 0.1s', link: '0.15s, 0.15s, 0.15s, 0.15s, 0.15s' });
  await page.evaluate(() => document.documentElement.setAttribute('data-workspace', 'code'));
  expect(await page.evaluate(probe)).toEqual({ nav: '0s, 0s', recent: '0s, 0s', link: '0s, 0s, 0s, 0s, 0s' });
});
