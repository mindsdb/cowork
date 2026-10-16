/* Which links in agent-written text may open, and how they open. An answer's
   own links (MarkdownContent) and a figure's web source (FigureMark) follow
   the same rules, so both read them from here. */

import { host } from '../../../platform/host';

// Allowlist of URL schemes our `MarkdownLink` will open. We deliberately
// do NOT include javascript:, file:, data:, or anything that could
// navigate the Electron renderer to a privileged location. mailto: is
// allowed because `host.openExternal` routes it through the OS handler.
const _SAFE_HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function isSafeExternalHref(href) {
  if (!href || typeof href !== 'string') return false;
  let url;
  try {
    url = new URL(href, 'http://_local');
  } catch {
    return false;
  }
  return _SAFE_HREF_SCHEMES.has(url.protocol);
}

// A finished artifact's local path or a fabricated sandbox: URL that anton emits
// as a "download" link — inert in chat, so remarkArtifactLocalLinks neutralizes
// it (ENG-1636).
//
// Asymmetric by design: ANY Windows drive path is caught, but a POSIX path only
// under `.anton/artifacts/`, `.cowork/`, or the pod's `/mnt/` root. Scoping
// POSIX to those shapes keeps a real web `/route` link from being swallowed;
// the trade is a POSIX-shaped hole — a file anton writes elsewhere on
// macOS/Linux still renders as a dead link. Artifacts live under
// `.anton/artifacts` and every scratchpad-pod path starts at `/mnt/`, so the
// canonical cases are covered; widening to bare-absolute-POSIX is where
// over-matching would start. (`/mnt/` can be a real mount point on the Linux
// desktop — but a bare-path chat link is dead on every desktop anyway:
// `shell.openExternal` cannot open a schemeless path — so neutralising it into
// panel-pointing text is an improvement there too, not a regression.)
//
// `web` gates the loopback test only: in a browser tab `127.0.0.1`/`localhost`
// is the USER'S machine, so a loopback URL anton emits from the scratchpad pod
// is dead by construction (ENG-2421) — but on desktop the same shape can be
// real (the sidecar serves on `127.0.0.1:26866`, and a fullstack app's dev
// server on `localhost:PORT` genuinely opens). The default is the desktop
// behaviour so a bare call can never widen the net; remarkArtifactLocalLinks
// in MarkdownContent passes the live surface.
export function isArtifactLocalPath(href, { web = false } = {}) {
  if (!href || typeof href !== 'string') return false;
  const h = href.trim();
  if (/^[a-zA-Z]:[\\/]/.test(h)) return true; // C:\… or C:/… (Windows drive)
  if (/^(?:file|sandbox):/i.test(h)) return true; // file:… / sandbox:/mnt/data/…
  // Loopback http(s) on web — MUST run before the https? bail below, which is
  // exactly the early-return that let `http://127.0.0.1:PORT` reach users as a
  // live link (ENG-2421).
  if (web && /^https?:/i.test(h)) {
    let hostname = '';
    try { hostname = new URL(h).hostname.toLowerCase(); } catch { return false; }
    // A single trailing root dot is the same name (RFC 1034) — `localhost.`
    // and `127.0.0.1.` must not slip past the exact-match tests below.
    hostname = hostname.replace(/\.$/, '');
    if (
      // RFC 6761 reserves `localhost` AND every name under `.localhost` as
      // loopback (`app.localhost` resolves to 127.0.0.1 in browsers), while
      // `localhost.example.com` is an ordinary name and stays live.
      hostname === 'localhost' || hostname.endsWith('.localhost')
      || hostname === '0.0.0.0'
      || hostname === '[::1]' || hostname === '::1'
      // Full dotted-quad only — `^127\.` alone would catch REGISTERED domains
      // like `127.net` (review finding on #956). Loses no loopback coverage:
      // new URL() normalises every shorthand (`127.1`, decimal `2130706433`,
      // hex `0x7f000001`) to the dotted quad before this test runs.
      || /^127(?:\.\d{1,3}){3}$/.test(hostname)
    ) return true;
  }
  // POSIX artifact path (bare path — absolute or relative). A REAL web link
  // (http/https/mailto) whose URL merely happens to contain the marker — e.g. a
  // published `https://…/.cowork/…` URL — must stay clickable, so bail before
  // the marker test. The `(?:^|/)` boundary matches both an absolute path
  // (`/Users/…/.anton/artifacts/…`) and a leading-relative one
  // (`.anton/artifacts/…`) while not matching a stray `foo.cowork/…`.
  // `/mnt/…` is anchored to the string start: it is the pod's filesystem root
  // on web (and at worst an already-dead bare-path link on a Linux desktop —
  // see the header note); the anchor keeps route shapes like `/mnt-docs/x`
  // or `docs/mnt/x` clickable.
  if (/^(?:https?|mailto):/i.test(h)) return false;
  return /(?:^|\/)\.anton\/artifacts\//.test(h) || /(?:^|\/)\.cowork\//.test(h) || /^\/mnt\//.test(h);
}

export function openMarkdownHref(href) {
  if (!isSafeExternalHref(href)) return;
  // Prefer the host bridge (Electron routes through shell.openExternal;
  // web falls back to window.open with noopener,noreferrer).
  if (host && typeof host.openExternal === 'function') {
    Promise.resolve(host.openExternal(href)).catch(() => {});
    return;
  }
  try { window.open(href, '_blank', 'noopener,noreferrer'); } catch {}
}
