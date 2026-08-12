import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/*
 * What a user gets when they click Download, checked against the live CDN.
 *
 * Two kinds of assertion, deliberately:
 *
 *   - A real Chromium download, for the things only a browser can prove. That
 *     the saved file is named after the version, and that the bytes Chromium
 *     wrote match the checksum the release published, are properties of the
 *     browser's own download path, not of an HTTP client's.
 *
 *   - Raw HTTP, for resumption. Interrupting a real download at a byte offset
 *     is not something a browser exposes, and simulating it with timing is the
 *     kind of test that fails on a slow runner rather than on a real defect.
 *     Requesting the tail with the validator a resume would replay asks the
 *     same question deterministically.
 *
 * Nothing here is mocked. Every byte comes from downloads.mindshub.ai.
 */

const CDN = (process.env.DOWNLOADS_BASE ?? 'https://downloads.mindshub.ai').replace(/\/+$/, '');
const SHA256 = /^[0-9a-f]{64}$/;
/* Where a transfer is cut before resuming. Far enough in to span many parts of
 * a multipart object, which is where a validator mismatch shows up. */
const INTERRUPT_AT = 30 * 1024 * 1024;

interface Platform {
  readonly name: 'mac' | 'windows';
  readonly ext: 'pkg' | 'exe';
}

interface Channel {
  readonly kind: 'prod' | 'stable';
  /** The manifest file name, which matches the alias it supersedes. */
  readonly manifest: 'latest.json' | 'staging.json';
  readonly alias: 'latest' | 'staging';
}

interface Manifest {
  version: string;
  key: string;
  url: string;
  size_bytes: number;
  sha256: string;
  published_at: string;
}

const PLATFORMS: Platform[] = [
  { name: 'mac', ext: 'pkg' },
  { name: 'windows', ext: 'exe' },
];

const CHANNELS: Channel[] = [
  { kind: 'prod', manifest: 'latest.json', alias: 'latest' },
  { kind: 'stable', manifest: 'staging.json', alias: 'staging' },
];

const manifestUrl = (p: Platform, c: Channel) => `${CDN}/mindshub-cowork/${p.name}/${c.manifest}`;
const aliasUrl = (p: Platform, c: Channel) =>
  `${CDN}/mindshub-cowork/${p.name}/mindshub-cowork-${c.alias}.${p.ext}`;

/*
 * The body is what gets checked, not the status. A missing key answers 404 now,
 * but it answers with the same 665-byte HTML redirect page it always did, and a
 * correct status still cannot tell a current manifest from a stale one.
 */
async function fetchManifest(
  request: APIRequestContext,
  p: Platform,
  c: Channel,
): Promise<Manifest> {
  const url = manifestUrl(p, c);
  const response = await request.get(url);
  expect(response.status(), `${url} should be served`).toBe(200);
  expect(
    response.headers()['content-type'] ?? '',
    `${url} served HTML, which is the redirect page a missing key falls back to`,
  ).toContain('application/json');
  return JSON.parse(await response.text()) as Manifest;
}

const sha256 = (bytes: Buffer | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The file name a saved download should carry, per the manifest's own key. */
function installerFileName(manifest: Manifest): string {
  const name = manifest.key.split('/').pop();
  expect(name, `manifest key has no file name: ${manifest.key}`).toBeTruthy();
  return name as string;
}

for (const platform of PLATFORMS) {
  for (const channel of CHANNELS) {
    test.describe(`${channel.kind} ${platform.name}`, () => {
      test('the manifest publishes every field a client needs', async ({ request }) => {
        const manifest = await fetchManifest(request, platform, channel);

        expect(manifest.version, 'version must not be an alias name').not.toMatch(
          /^(latest|staging)$/,
        );
        expect(manifest.key).toMatch(
          new RegExp(
            `^mindshub-cowork/${platform.name}/(snapshots/)?mindshub-cowork-.+\\.${platform.ext}$`,
          ),
        );
        // A prod manifest naming a snapshot build would put every new user on
        // an unreleased one, so the two channels must not cross over.
        expect(manifest.key.includes('/snapshots/')).toBe(channel.kind === 'stable');
        expect(manifest.url).toBe(`${CDN}/${manifest.key}`);
        expect(manifest.sha256).toMatch(SHA256);
        expect(Number.isInteger(manifest.size_bytes) && manifest.size_bytes > 0).toBe(true);
        expect(Number.isNaN(Date.parse(manifest.published_at))).toBe(false);

        // The manifest itself must never be cached, or a release is invisible
        // for as long as an edge holds the previous one.
        const headers = (await request.get(manifestUrl(platform, channel))).headers();
        expect(headers['cache-control'] ?? '').toMatch(/no-store/);
      });

      test('the versioned installer is immutable, attachment-named and resumable', async ({
        request,
      }) => {
        const manifest = await fetchManifest(request, platform, channel);
        const fileName = installerFileName(manifest);

        const head = await request.head(manifest.url);
        expect(head.status(), `${manifest.url} should resolve`).toBe(200);
        const headers = head.headers();
        expect(headers['cache-control'] ?? '').toMatch(/max-age=31536000/);
        expect(headers['cache-control'] ?? '').toMatch(/immutable/);
        expect(headers['content-disposition'] ?? '').toBe(`attachment; filename="${fileName}"`);
        expect(headers['accept-ranges'] ?? '').toBe('bytes');
        expect(Number(headers['content-length'])).toBe(manifest.size_bytes);

        const etag = headers['etag'];
        expect(etag, 'a resume needs a validator to replay').toBeTruthy();

        // The bug this release fixes: a resume whose validator still matches
        // must come back as a 206 carrying only the tail, not a 200 with the
        // whole 220 MB.
        const resumed = await request.get(manifest.url, {
          headers: { Range: `bytes=${INTERRUPT_AT}-${INTERRUPT_AT + 1023}`, 'If-Range': etag },
        });
        expect(resumed.status(), 'a matching validator must be honoured').toBe(206);
        expect(resumed.headers()['etag']).toBe(etag);
        expect(resumed.headers()['content-range']).toBe(
          `bytes ${INTERRUPT_AT}-${INTERRUPT_AT + 1023}/${manifest.size_bytes}`,
        );

        // And the other half of the contract: a validator that no longer
        // matches degrades to a full 200 rather than serving mismatched bytes.
        const stale = await request.get(manifest.url, {
          headers: { Range: 'bytes=0-1023', 'If-Range': '"0000000000000000000000000000000000-1"' },
        });
        expect(stale.status()).toBe(200);
      });

      test('an interrupted transfer resumes into a file matching the published checksum', async ({
        request,
      }) => {
        const manifest = await fetchManifest(request, platform, channel);
        const head = await request.head(manifest.url);
        const etag = head.headers()['etag'];

        const opening = await request.get(manifest.url, {
          headers: { Range: `bytes=0-${INTERRUPT_AT - 1}` },
        });
        expect(opening.status()).toBe(206);
        const first = await opening.body();
        expect(first.byteLength).toBe(INTERRUPT_AT);

        // Exactly what a browser replays when a transfer breaks partway.
        const rest = await request.get(manifest.url, {
          headers: { Range: `bytes=${INTERRUPT_AT}-`, 'If-Range': etag },
        });
        expect(rest.status(), 'the tail must come back as a partial response').toBe(206);
        const second = await rest.body();

        const whole = Buffer.concat([first, second]);
        expect(whole.byteLength).toBe(manifest.size_bytes);
        expect(sha256(whole)).toBe(manifest.sha256);
      });

      test('the alias serves the same version the manifest names', async ({ request }) => {
        const manifest = await fetchManifest(request, platform, channel);
        const fileName = installerFileName(manifest);
        const alias = aliasUrl(platform, channel);

        const head = await request.head(alias);
        expect(head.status()).toBe(200);
        const headers = head.headers();
        // A minute, not CloudFront's default hour: the alias is rewritten every
        // release, so this is how long a stale edge copy can outlive one.
        expect(headers['cache-control'] ?? '').toMatch(/max-age=60\b/);
        // Saving from the alias still gets a file named after its real version.
        expect(headers['content-disposition'] ?? '').toBe(`attachment; filename="${fileName}"`);
        expect(Number(headers['content-length'])).toBe(manifest.size_bytes);

        // Same leading bytes as the versioned key, so the alias cannot be
        // serving a different build that merely matches on size.
        const [fromAlias, fromVersioned] = await Promise.all([
          request.get(alias, { headers: { Range: 'bytes=0-65535' } }),
          request.get(manifest.url, { headers: { Range: 'bytes=0-65535' } }),
        ]);
        expect(sha256(await fromAlias.body())).toBe(sha256(await fromVersioned.body()));
      });
    });
  }

  // The full download runs on the prod channel only. It is the same code path
  // on both, and pulling a second ~220 MB build per platform to prove it twice
  // buys nothing the checks above have not already covered.
  test(`prod ${platform.name}: a real browser download saves the versioned file name and the published bytes`, async ({
    page,
  }, testInfo) => {
    const manifest = await fetchManifest(page.request, platform, CHANNELS[0]);
    const fileName = installerFileName(manifest);

    await page.setContent(`<a id="dl" href="${manifest.url}">download</a>`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);

    // Chromium's own parse of Content-Disposition, which is the thing that
    // decides what lands in the user's Downloads folder.
    expect(download.suggestedFilename()).toBe(fileName);

    const saved = testInfo.outputPath(fileName);
    await download.saveAs(saved);
    expect(sha256(await readFile(saved))).toBe(manifest.sha256);
  });
}
