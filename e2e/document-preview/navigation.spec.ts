import { expect, test } from '@playwright/test';

import { buildPreviewSrcdoc, previewFramePolicy } from '../../src/renderer/cowork/preview/frameDocument';
import { PREVIEW_FRAME_NAME } from '../../src/shared/document-preview';
import { loadFixtures, openPreview, previewFrame, strayRequests, type PreviewFixture, type PreviewRun } from './harness';

/*
 * The frame's own isolation, with the harness-only navigation renderer. Every
 * fixture renders, every click leaves the frame at about:srcdoc, and every
 * fixture, clean ones too, passes strayRequests' rules for a hostile fixture:
 * the harness fetches the fixture itself exactly once, and nothing else is
 * requested but the harness page's own modules.
 */
const SET = 'navigation';

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
    expect(strayRequests(SET, { ...fixture, kind: 'hostile' }, run.requests, harnessOrigin)).toEqual([]);
    const fixtureUrl = `${harnessOrigin}/fixtures/${SET}/${fixture.file}`;
    expect(run.requests.filter((url) => url === fixtureUrl)).toEqual([fixtureUrl]);
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

  const frame = await previewFrame(page);
  const head = await frame.evaluate(() => Array.from(document.head.children)
    .map((element) => element.getAttribute('http-equiv') ?? element.getAttribute('name') ?? element.tagName));
  expect(head).toEqual(['Content-Security-Policy', 'x-dns-prefetch-control', 'SCRIPT']);
  expect(await frame.evaluate(() => window.origin)).toBe('null');
});
