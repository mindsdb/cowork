import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/*
 * Check live CDN downloads without mocks: Chromium verifies saved filenames and bytes; raw HTTP
 * verifies resumption deterministically using ranges and validators.
 */

const CDN = (process.env.DOWNLOADS_BASE ?? 'https://downloads.mindshub.ai').replace(/\/+$/, '');
const SHA256 = /^[0-9a-f]{64}$/;

/*
 * Resume deep in the object to span multipart boundaries: clamp the 500 MB target to three quarters
 * of the file so a smaller installer still has a valid tail.
 */
const INTERRUPT_TARGET = 500 * 1024 * 1024;
const interruptAt = (sizeBytes: number) => Math.min(INTERRUPT_TARGET, Math.floor(sizeBytes * 0.75));

/*
 * Large concurrent downloads need a request timeout beyond Playwright's default 30 seconds, still
 * bounded inside the test's 15-minute limit.
 */
const BODY_TIMEOUT = 10 * 60_000;

/*
 * Compare with the pipeline's published version; manifest/object consistency alone also passes for
 * a stale previous release.
 */
const EXPECTED_VERSION = (process.env.RELEASE_SMOKE_VERSION ?? '').trim().replace(/^v/, '');

interface Platform {
  readonly name: 'mac' | 'windows' | 'linux-amd64' | 'linux-arm64';
  readonly ext: 'pkg' | 'exe' | 'deb';
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

// Linux is two entries, not one: the deb arches publish under separate
// prefixes, so each has its own manifest and its own alias to verify.
const PLATFORMS: Platform[] = [
  { name: 'mac', ext: 'pkg' },
  { name: 'windows', ext: 'exe' },
  { name: 'linux-amd64', ext: 'deb' },
  { name: 'linux-arm64', ext: 'deb' },
];

const ALL_CHANNELS: Channel[] = [
  { kind: 'prod', manifest: 'latest.json', alias: 'latest' },
  { kind: 'stable', manifest: 'staging.json', alias: 'staging' },
];

/*
 * Release runs check their published channel; nightly runs check both. Reject unknown channels so
 * selecting zero tests cannot pass silently.
 */
const REQUESTED = (process.env.RELEASE_SMOKE_CHANNELS ?? 'prod,stable')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const unknown = REQUESTED.filter((name) => !ALL_CHANNELS.some((c) => c.kind === name));
if (unknown.length > 0 || REQUESTED.length === 0) {
  throw new Error(
    `RELEASE_SMOKE_CHANNELS="${process.env.RELEASE_SMOKE_CHANNELS}" names no known channel` +
      ` (expected some of ${ALL_CHANNELS.map((c) => c.kind).join(', ')})`,
  );
}
const CHANNELS = ALL_CHANNELS.filter((c) => REQUESTED.includes(c.kind));
const PROD_CHANNEL = CHANNELS.find((c) => c.kind === 'prod');

const manifestUrl = (p: Platform, c: Channel) => `${CDN}/mindshub-cowork/${p.name}/${c.manifest}`;
const aliasUrl = (p: Platform, c: Channel) =>
  `${CDN}/mindshub-cowork/${p.name}/mindshub-cowork-${c.alias}.${p.ext}`;

/*
 * Check manifest contents: an HTTP status cannot distinguish a current manifest from stale data or
 * an HTML fallback.
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

        // The release pipeline says which version it just published. Without
        // this, a manifest left over from the previous release passes.
        if (EXPECTED_VERSION && channel.kind === 'prod') {
          expect(manifest.version, 'the manifest must name the version this release built').toBe(
            EXPECTED_VERSION,
          );
        }

        // The manifest itself must never be cached, or a release is invisible
        // for as long as an edge holds the previous one.
        const headers = (await request.get(manifestUrl(platform, channel))).headers();
        expect(headers['cache-control'] ?? '').toMatch(/no-store/);
      });

      test('the versioned installer carries its channel TTL, is attachment-named and resumable', async ({
        request,
      }) => {
        const manifest = await fetchManifest(request, platform, channel);
        const fileName = installerFileName(manifest);

        const head = await request.head(manifest.url);
        expect(head.status(), `${manifest.url} should resolve`).toBe(200);
        const headers = head.headers();
        /*
         * Require explicit Cache-Control at the edge: release keys are immutable, but rewritten
         * snapshot keys need the short alias TTL to avoid stale builds.
         */
        const cacheControl = headers['cache-control'] ?? '';
        const immutable = channel.kind === 'prod';
        expect(cacheControl).toMatch(immutable ? /max-age=31536000/ : /max-age=60\b/);
        expect(/immutable/.test(cacheControl), `unexpected Cache-Control: ${cacheControl}`).toBe(
          immutable,
        );
        expect(headers['content-disposition'] ?? '').toBe(`attachment; filename="${fileName}"`);
        expect(headers['accept-ranges'] ?? '').toBe('bytes');
        expect(Number(headers['content-length'])).toBe(manifest.size_bytes);

        const etag = headers['etag'];
        expect(etag, 'a resume needs a validator to replay').toBeTruthy();

        // A matching resume validator must return 206 with only the requested tail.
        const cut = interruptAt(manifest.size_bytes);
        const resumed = await request.get(manifest.url, {
          headers: { Range: `bytes=${cut}-${cut + 1023}`, 'If-Range': etag },
        });
        expect(resumed.status(), 'a matching validator must be honoured').toBe(206);
        expect(resumed.headers()['etag']).toBe(etag);
        expect(resumed.headers()['content-range']).toBe(
          `bytes ${cut}-${cut + 1023}/${manifest.size_bytes}`,
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
        const cut = interruptAt(manifest.size_bytes);

        const opening = await request.get(manifest.url, {
          headers: { Range: `bytes=0-${cut - 1}` },
          timeout: BODY_TIMEOUT,
        });
        expect(opening.status()).toBe(206);
        const first = await opening.body();
        expect(first.byteLength).toBe(cut);

        // Exactly what a browser replays when a transfer breaks partway.
        const rest = await request.get(manifest.url, {
          headers: { Range: `bytes=${cut}-`, 'If-Range': etag },
          timeout: BODY_TIMEOUT,
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

  // Download the full prod installer only; both channels share the path and the checks above cover
  // their metadata and ranges.
  test(`prod ${platform.name}: a real browser download saves the versioned file name and the published bytes`, async ({
    page,
  }, testInfo) => {
    test.skip(!PROD_CHANNEL, 'this run does not check the prod channel');
    const manifest = await fetchManifest(page.request, platform, PROD_CHANNEL as Channel);
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
