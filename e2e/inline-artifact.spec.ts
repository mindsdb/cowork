import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type FrameLocator, type Page, type Route } from '@playwright/test';

// ENG-4684: a live inline artifact in real frames with the real preview shim.
// The user ticks boxes in the chat card, opens Preview, ticks in the viewer,
// closes it, ticks in the card again and opens Preview again. Both frames and
// state.json must end on the user's picks, and the state must settle: Preview
// once flickered without end, the two frames bouncing a state between them.
//
// The spec plays cowork-server: the draft route serves the page with the shim
// injected first in <head>, the workspace route keeps state.json. The shim is
// cowork-server's (PREVIEW_SHIM, else the sibling worktree); without it the
// spec is skipped. Set TIMELINE_OUT to keep each run's message timeline.
//
// Pages (e2e/inline-artifact/):
//   index  the build-html-dashboard SKILL's checklist, as written
//   count  the same with an "N selected" line, so ticks change the DOM and
//          the shim's view reporter sees them
//   echo   the same, saving from its render (setState in render(), which
//          also runs at start and for every state it is handed)

const SHIM = process.env.PREVIEW_SHIM
  || path.resolve(__dirname, '../../../cowork-server-worktrees/eng-4684-inline-artifacts/cowork/services/preview_shim.js');
const ID = '0123456789abcdef0123456789abcdef';
const pageFile = (name: string) => fs.readFileSync(
  path.join(__dirname, `inline-artifact/${name === 'index' ? 'checklist' : `checklist-${name}`}.html`), 'utf8');
const withShim = (html: string) => html.replace(
  '<head>', `<head><script>${fs.readFileSync(SHIM, 'utf8').replace('__LINE_OFFSET__', '0')}</script>`);

type Server = { saves: string[], state: string | null, rev: number };

async function fakeServer(page: Page): Promise<Server> {
  const server: Server = { saves: [], state: null, rev: 1 };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p.startsWith(`/api/v1/artifacts/drafts/p1/${ID}/`)) {
      const name = p.split('/').pop()!.replace(/\.html$/, '');
      return route.fulfill({ status: 200, contentType: 'text/html', body: withShim(pageFile(name)) });
    }
    if (p === `/api/v1/artifacts/workspace/p1/${ID}`) {
      if (req.method() === 'PUT') {
        const body = JSON.parse(req.postData() || '{}');
        if (body.path === 'state.json') { server.state = body.content; server.saves.push(body.content); }
        server.rev += 1;
        return json(route, 200, { revision: { id: `r${server.rev}` } });
      }
      if (url.searchParams.get('path') === 'state.json') {
        if (server.state == null) return json(route, 404, { detail: 'no state' });
        return json(route, 200, { path: 'state.json', content: server.state, revision: { id: `r${server.rev}` } });
      }
      return json(route, 200, { path: 'index.html', content: pageFile('index'), revision: { id: `r${server.rev}` } });
    }
    if (p === `/api/v1/artifacts/workspace/p1/${ID}/revisions`) {
      return json(route, 200, { revisions: [{ id: `r${server.rev}` }] });
    }
    return json(route, 404, { detail: 'not here' });
  });
  return server;
}

const inline = (page: Page) => page.getByTestId('artifact-inline-preview').frameLocator('iframe');
const viewer = (page: Page) => page.frameLocator('iframe >> nth=1');
const picked = (frame: FrameLocator) => frame.locator('input[type=checkbox]')
  .evaluateAll((els: HTMLInputElement[]) => els.filter((e) => e.checked).map((e) => e.dataset.id).join(','));
const mark = (page: Page, what: string) => page.evaluate((type) => (window as any).__inlineLog.push({ t: -1, type }), what);
const stateReports = (page: Page) => page.evaluate(() => (window as any).__inlineLog.filter((e: any) => e.type === 'state').length);

for (const variant of ['index', 'count', 'echo']) {
  test(`picks made in the card and the viewer hold, and the state settles (${variant})`, async ({ page }) => {
    test.skip(!fs.existsSync(SHIM), `no preview shim at ${SHIM}`);
    const server = await fakeServer(page);
    try {
      await page.goto(`/?page=${variant}`);
      await expect(inline(page).getByText('Ana Ruiz, Acme')).toBeVisible();
      await page.waitForTimeout(500);
      await inline(page).getByText('Ana Ruiz, Acme').click();
      await page.waitForTimeout(300);
      await inline(page).getByText('Bo Chen, Initech').click();
      await expect.poll(() => server.state).toBe('{"picked":["li","zo"]}');

      await mark(page, '---- Preview ----');
      await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
      await expect(viewer(page).getByText('Ana Ruiz, Acme')).toBeVisible();
      await expect.poll(() => picked(viewer(page))).toBe('li,zo');
      // Long enough for a restore to replay and the state to bounce.
      await page.waitForTimeout(2500);
      expect(await picked(viewer(page))).toBe('li,zo');
      expect(await picked(inline(page))).toBe('li,zo');

      await mark(page, '---- tick in the viewer ----');
      await viewer(page).getByText('Zoe Park, Umbrella').click({ timeout: 5000 });
      await expect.poll(() => server.state).toBe('{"picked":["li"]}');
      expect(await picked(inline(page))).toBe('li');

      await mark(page, '---- close, tick in the card, Preview again ----');
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await inline(page).getByText('Li Wei, Globex').click({ timeout: 5000 });
      await expect.poll(() => server.state).toBe('{"picked":[]}');
      await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
      await expect(viewer(page).getByText('Ana Ruiz, Acme')).toBeVisible();
      await page.waitForTimeout(2500);
      expect(await picked(viewer(page))).toBe('');
      expect(await picked(inline(page))).toBe('');
      expect(server.state).toBe('{"picked":[]}');

      // Five user changes; a page saving from its render adds a few defaults
      // (two at each start) that the app sets aside. Never a stream.
      expect(await stateReports(page)).toBeLessThan(15);
      expect(server.saves.length).toBeLessThanOrEqual(5);
    } finally {
      if (process.env.TIMELINE_OUT) {
        const log = await page.evaluate(() => (window as any).__inlineLog).catch(() => []);
        fs.writeFileSync(`${process.env.TIMELINE_OUT}-${variant}.txt`,
          `${log.slice(0, 2000).map((e: any) => JSON.stringify(e)).join('\n')}\nentries ${log.length}\nSAVES ${JSON.stringify(server.saves)}\n`);
      }
    }
  });
}
