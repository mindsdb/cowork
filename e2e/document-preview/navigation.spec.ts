import { expect, test } from '@playwright/test';

import { buildPreviewSrcdoc, previewFramePolicy } from '../../src/renderer/cowork/preview/frameDocument';
import { PREVIEW_FRAME_NAME } from '../../src/shared/document-preview';
import { loadFixtures, openPreview, type PreviewFixture, type PreviewRun } from './harness';

/*
 * The frame's own isolation, with the harness-only navigation renderer. Every
 * fixture renders, every click leaves the frame at about:srcdoc, and the only
 * network request is the harness's fetch of the fixture itself, apart from the
 * harness page's own modules. Requests are compared by origin, never by host
 * name, because 127.0.0.1 on another port is a target too.
 */
const SET = 'navigation';

/* The Vite dev server's own module paths on the harness origin. */
const isHarnessModule = (url: URL) => url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules/');

function expectOutcome(run: PreviewRun, fixture: PreviewFixture) {
  const { expect: expected } = fixture;
  expect(run.outcome).toBe(expected.outcome);
  if (expected.errorCode) expect(run.errorCode).toBe(expected.errorCode);
  if (expected.units !== undefined) expect(run.summary?.units).toBe(expected.units);
  if (expected.minUnits !== undefined) expect(run.summary?.units).toBeGreaterThanOrEqual(expected.minUnits);
  if (expected.truncated !== undefined) expect(run.summary?.truncated).toBe(expected.truncated);
  for (const text of expected.textIncludes ?? []) expect(run.text).toContain(text);
  for (const text of expected.textExcludes ?? []) expect(run.text).not.toContain(text);
}

for (const fixture of loadFixtures(SET)) {
  test(`${fixture.kind} ${fixture.name}: stays at about:srcdoc and reaches only the fixture`, async ({ page, baseURL }) => {
    const run = await openPreview(page, SET, fixture);
    expectOutcome(run, fixture);

    const harnessOrigin = new URL(baseURL!).origin;
    const network = run.requests.filter((url) => /^https?:/.test(url)).map((url) => new URL(url));
    expect(network.filter((url) => url.origin !== harnessOrigin).map(String)).toEqual([]);
    expect(network.filter((url) => url.origin === harnessOrigin && !isHarnessModule(url)).map(String))
      .toEqual([`${harnessOrigin}/fixtures/${SET}/${fixture.file}`]);
    expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
  });
}

test('the frame is sandboxed, named, built from srcdoc, and holds no token meta once it runs', async ({ page }) => {
  const [fixture] = loadFixtures(SET);
  await openPreview(page, SET, fixture);

  const iframe = page.locator(`iframe[name="${PREVIEW_FRAME_NAME}"]`);
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  expect(await iframe.getAttribute('src')).toBeNull();
  const srcdoc = (await iframe.getAttribute('srcdoc')) ?? '';
  const policy = srcdoc.match(/^<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] ?? '';
  const scriptSha256 = policy.match(/'sha256-([^']+)'/)?.[1] ?? '';
  expect(policy).toBe(previewFramePolicy(scriptSha256));
  const token = srcdoc.match(/<meta name="cowork-preview-token" content="([0-9a-f]{32})">/)?.[1] ?? '';
  const scriptText = srcdoc.match(/<script>([\s\S]*)<\/script>$/)?.[1] ?? '';
  expect(srcdoc).toBe(buildPreviewSrcdoc({ policy, token, scriptText, scriptSha256 }));

  const frame = page.frame({ name: PREVIEW_FRAME_NAME })!;
  const head = await frame.evaluate(() => Array.from(document.head.children)
    .map((element) => element.getAttribute('http-equiv') ?? element.getAttribute('name') ?? element.tagName));
  expect(head).toEqual(['Content-Security-Policy', 'x-dns-prefetch-control', 'SCRIPT']);
  expect(await frame.evaluate(() => window.origin)).toBe('null');
});
