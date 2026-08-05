// Local OTA fixture server for the live-lifecycle e2e (ota-lifecycle.spec.ts).
//
// Stands up a loopback HTTP server that speaks the same two endpoints the real
// OTA client reads — `latest.json` (the manifest) and the bundle tarball — so
// the whole check → download → activate → health-check → rollback lifecycle can
// run against a controllable host instead of the production GitHub Pages
// manifest. The app is pointed here via COWORK_OTA_MANIFEST_URL; the seam in
// ui-updater.ts honours a plaintext http:// override only for loopback.
//
// Nothing is ever published to a real release channel — the tarball is built
// on the fly from an in-memory index.html, and the manifest's `url` points back
// at this same server.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';

export interface OtaFixture {
  /** UI CalVer this "release" advertises, e.g. "2.27.7.13.1". */
  version: string;
  /** Optional server-compat floor written as manifest `min_server_version`. */
  minServerVersion?: string;
  /** Raw HTML for the bundle's index.html. Defaults to a marked, healthy page.
   *  Pass `HANGING_HTML` to simulate a bundle that never finishes loading. */
  html?: string;
}

/** A healthy page carrying a marker the spec can assert loaded in the window. */
export function healthyHtml(version: string): string {
  return `<!doctype html><html><head><title>OTA_FIXTURE ${version}</title></head>` +
    `<body><div id="ota-fixture" data-version="${version}">ota fixture ${version}</div></body></html>`;
}

/** Path the fixture server never responds on — used to stall a bundle's load. */
export const HANG_PATH = '/hang';

/** A page whose main frame never finishes loading: a blocking <head> script
 *  pointed at the server's never-responding /hang endpoint stalls parsing, so no
 *  did-finish-load fires and the 15s health-check timeout is the only way out.
 *  Unlike a `while(true)` loop this leaves the renderer's JS thread idle, so the
 *  post-rollback reload can navigate away cleanly — faithful to a real corrupt
 *  bundle stuck on a resource, not a pathological CPU peg. */
export function stallingHtml(hangUrl: string): string {
  return `<!doctype html><html><head><title>OTA_FIXTURE stalling</title>` +
    `<script src="${hangUrl}"></script></head><body><div id="ota-fixture">stalling</div></body></html>`;
}

/** Build a real gzipped tar containing index.html — faithful to the code's
 *  actual `tar xzf` extraction path — and return it with its sha256. */
export function buildBundle(fixture: OtaFixture): { tarball: Buffer; sha256: string } {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-fix-src-'));
  try {
    fs.writeFileSync(path.join(src, 'index.html'), fixture.html ?? healthyHtml(fixture.version));
    const tgz = path.join(src, 'bundle.tar.gz');
    execFileSync('tar', ['czf', tgz, '-C', src, 'index.html']);
    const tarball = fs.readFileSync(tgz);
    return { tarball, sha256: crypto.createHash('sha256').update(tarball).digest('hex') };
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
}

export interface FixtureServer {
  /** Full manifest URL to hand the app via COWORK_OTA_MANIFEST_URL. */
  manifestUrl: string;
  origin: string;
  /** Swap what the server advertises (rebuilds the tarball). null → 404 (no
   *  manifest available, i.e. an unreachable/empty channel). */
  setFixture(fixture: OtaFixture | null): void;
  close(): Promise<void>;
}

export async function startFixtureServer(initial: OtaFixture | null = null): Promise<FixtureServer> {
  let state: { version: string; sha256: string; minServerVersion?: string; tarball: Buffer } | null = null;

  const setFixture = (fixture: OtaFixture | null) => {
    if (!fixture) { state = null; return; }
    const { tarball, sha256 } = buildBundle(fixture);
    state = { version: fixture.version, sha256, minServerVersion: fixture.minServerVersion, tarball };
  };
  setFixture(initial);

  let origin = '';
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    // Never respond — holds the request open so a bundle's <head> script stalls
    // and the load never completes (see stallingHtml). Left dangling on purpose;
    // closeAllConnections() reaps it on teardown.
    if (url.startsWith(HANG_PATH)) return;
    if (!state) { res.writeHead(404); res.end(); return; }
    if (url.startsWith('/latest.json')) {
      const manifest: Record<string, unknown> = {
        version: state.version,
        url: `${origin}/ui-bundle.tar.gz`,
        sha256: state.sha256,
      };
      if (state.minServerVersion) manifest.min_server_version = state.minServerVersion;
      const body = JSON.stringify(manifest);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (url.startsWith('/ui-bundle.tar.gz')) {
      res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': state.tarball.length });
      res.end(state.tarball);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;

  return {
    manifestUrl: `${origin}/latest.json`,
    origin,
    setFixture,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections?.(); // reap any dangling /hang sockets (Node 18.2+)
      server.close(() => resolve());
    }),
  };
}

/** Bump a CalVer string by whole years, keeping it a valid 5-part CalVer.
 *  A +1 year is unambiguously newer by date (compareCalVer ignores MAJOR and
 *  orders on the YY.M.D date first); -1 year is unambiguously older. Avoids the
 *  month/day-underflow that would produce a non-CalVer string. */
export function bumpYears(raw: string, delta: number): string {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(raw.trim().replace(/^v/, ''));
  if (!m) throw new Error(`not a CalVer: ${raw}`);
  const [, major, yy, mo, d] = m;
  return `${major}.${Number(yy) + delta}.${mo}.${d}.1`;
}
