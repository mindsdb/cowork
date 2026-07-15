// Pure decision logic shared by the installer (installer.ts) and the
// updaters (server-updater.ts, ui-updater.ts). No fs, no child_process, no
// electron, no network — every function here maps inputs to a decision, so
// it can be unit-tested directly (qa.md §5a). The orchestration modules own
// the I/O and delegate parsing/decisions here.
//
// compareVersions and the `uv tool list` parsing used to be duplicated
// verbatim in installer.ts and server-updater.ts with "keep in sync"
// comments; this module is now the single copy.

// Pure CalVer helpers from the shared version module (no I/O) — used by the
// OTA cache-freshness / update-newer decisions below.
import { parseCalVer, compareCalVer, newestCalVer } from '../shared/version';

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/** Compare simple X.Y.Z versions. <0 if a<b, 0 if equal, >0 if a>b.
 *  (No pre-release handling — server releases are plain semver triples.) */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Installer gate: does the installed version satisfy the minimum floor? */
export function meetsMinVersion(installed: string, min: string): boolean {
  return compareVersions(installed, min) >= 0;
}

// ---------------------------------------------------------------------------
// `uv tool list` output → installed cowork-server version
// ---------------------------------------------------------------------------

/** Parse the cowork-server version out of `uv tool list` stdout.
 *  Strips ANSI escapes first: a forced-color environment (FORCE_COLOR set by
 *  `concurrently` in dev) makes uv emit `\x1b[1mcowork-server v0.1.6\x1b[0m`,
 *  which breaks a start-anchored regex and made verification fail with a
 *  misleading "binary not found". Callers also set NO_COLOR=1; this strip is
 *  the defensive second layer. */
export function parseInstalledVersion(stdout: string): string | null {
  // eslint-disable-next-line no-control-regex
  const clean = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of clean.split('\n')) {
    const match = line.match(/^cowork-server\s+v?([\d.]+)/);
    if (match) return match[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// git ref / ls-remote parsing
// ---------------------------------------------------------------------------

/** A 40-hex ref IS a commit — no remote lookup needed. */
export function isFullCommitSha(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref);
}

/** Pick the HEAD commit for `ref` out of `git ls-remote` stdout.
 *  Prefers an exact heads/ or tags/ match; falls back to the first line.
 *  Null when the output has no usable SHA. */
export function parseLsRemote(stdout: string, ref: string): string | null {
  const lines = stdout.split('\n').filter(Boolean);
  const pick =
    lines.find((l) => l.includes(`refs/heads/${ref}`) || l.includes(`refs/tags/${ref}`)) ||
    lines[0];
  const sha = pick ? pick.split('\t')[0].trim().toLowerCase() : '';
  return sha || null;
}

// ---------------------------------------------------------------------------
// direct_url.json → install-source detection
// ---------------------------------------------------------------------------

export interface VcsInfo {
  commit: string;
  requestedRevision: string;
}

/** Parse a dist-info direct_url.json into VCS info. Null for a registry
 *  (PyPI) install — no vcs_info — or for malformed/unexpected content.
 *  This null is the git-vs-PyPI channel switch in the updater. */
export function parseVcsInfo(jsonText: string): VcsInfo | null {
  try {
    const data = JSON.parse(jsonText);
    const vcs = data?.vcs_info;
    if (!vcs?.commit_id) return null;
    return { commit: vcs.commit_id, requestedRevision: vcs.requested_revision || '' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Update decisions
// ---------------------------------------------------------------------------

export interface GitUpdateDecision {
  coworkChanged: boolean;
  antonChanged: boolean;
  needsUpdate: boolean;
}

/** Git channel: update iff a remote HEAD differs from the installed commit.
 *  A null remote (ls-remote failed / offline) never triggers an update, and
 *  a missing anton VCS record (not a git install) is ignored rather than
 *  treated as changed — offline or partial state must fail safe to
 *  "no update", never to a surprise reinstall. */
export function decideGitUpdate(input: {
  coworkRemote: string | null;
  antonRemote: string | null;
  coworkVcs: VcsInfo;
  antonVcs: VcsInfo | null;
}): GitUpdateDecision {
  const { coworkRemote, antonRemote, coworkVcs, antonVcs } = input;
  const coworkChanged = !!coworkRemote && coworkRemote !== coworkVcs.commit.toLowerCase();
  const antonChanged = !!antonRemote && !!antonVcs && antonRemote !== antonVcs.commit.toLowerCase();
  return { coworkChanged, antonChanged, needsUpdate: coworkChanged || antonChanged };
}

export type PypiUpdateDecision =
  | { action: 'update'; from: string; to: string }
  | { action: 'up-to-date' }
  | { action: 'skip'; reason: 'unknown-installed-version' | 'no-latest-version' };

/** PyPI channel: update iff PyPI has a strictly newer version. Unknown
 *  installed version is an error-ish skip (reported); an unreachable PyPI
 *  is a silent skip (offline is normal). */
export function decidePypiUpdate(
  currentVersion: string | null,
  latestVersion: string | null,
): PypiUpdateDecision {
  if (!currentVersion) return { action: 'skip', reason: 'unknown-installed-version' };
  if (!latestVersion) return { action: 'skip', reason: 'no-latest-version' };
  if (compareVersions(latestVersion, currentVersion) <= 0) return { action: 'up-to-date' };
  return { action: 'update', from: currentVersion, to: latestVersion };
}

// ---------------------------------------------------------------------------
// Boot-recovery: is a start failure a broken install?
// ---------------------------------------------------------------------------

/** Does a failed-start crash log look like a broken/partial Python install —
 *  a missing module or an unimportable name — rather than a runtime or data
 *  failure (a bad Alembic migration, a port clash, missing config)?
 *
 *  Only a broken install is fixable by a clean `uv tool install --reinstall`.
 *  Reinstalling for anything else wastes minutes AND can corrupt an otherwise
 *  healthy venv when the reinstall races a concurrent start (observed: a repair
 *  reinstall fired on an Alembic "database ahead" error, then a post-onboarding
 *  restart spawned python mid-reinstall → spurious ModuleNotFoundError). So the
 *  boot-recovery path gates the reinstall on this returning true.
 *
 *  Matches only the specific import-failure markers CPython emits — not the
 *  bare word "import", which appears in benign frames like
 *  `<frozen importlib._bootstrap>` inside an unrelated (e.g. migration) trace. */
export function looksLikeBrokenInstall(log: string | null | undefined): boolean {
  if (!log) return false;
  return /\bModuleNotFoundError\b|\bImportError\b|No module named|cannot import name|\(unknown location\)/.test(
    log,
  );
}

// ---------------------------------------------------------------------------
// Update-poll apply decision
// ---------------------------------------------------------------------------

export interface UpdateApplyDecision {
  applyServer: boolean;
  applyUi: boolean;
}

/** Decide what a boot/periodic update poll should actually apply.
 *
 *  - A **down server** is a recovery case: apply an available server update
 *    regardless of update mode or whether this is the boot check — a newer
 *    build may be what fixes the crash. This is why the boot update check must
 *    not be gated behind a successful server start.
 *  - Otherwise updates auto-apply only on the boot check in `auto` mode; a
 *    `manual` mode or a periodic re-check just surfaces a banner (caller).
 *
 *  UI never force-applies on a down server — a dead backend is a server
 *  problem, and forcing a UI swap + reload mid-recovery adds churn without
 *  fixing anything. */
export function decideUpdateApply(input: {
  serverUpdateAvailable: boolean;
  uiUpdateAvailable: boolean;
  serverDown: boolean;
  isBootCheck: boolean;
  mode: 'auto' | 'manual';
}): UpdateApplyDecision {
  const { serverUpdateAvailable, uiUpdateAvailable, serverDown, isBootCheck, mode } = input;
  const autoOk = isBootCheck && mode === 'auto';
  return {
    applyServer: serverUpdateAvailable && (serverDown || autoOk),
    applyUi: uiUpdateAvailable && autoOk,
  };
}

// ---------------------------------------------------------------------------
// UI OTA enablement (build-channel / env gate)
// ---------------------------------------------------------------------------

/** Should we serve an activated OTA cache over the app-bundled renderer?
 *  Only when the cache is genuinely NEWER than the bundled renderer: a fresh
 *  install or a shell upgrade ships a newer bundled UI that must win over a
 *  stale cache, and a legacy pre-gate cache (or any unparseable version) is
 *  never considered fresh — so it fails safe to the bundled renderer. */
export function otaCacheIsFresh(cachedVersion: string | null, bundledVersion: string): boolean {
  const c = parseCalVer(cachedVersion);
  const b = parseCalVer(bundledVersion);
  if (!c || !b) return false;
  return compareCalVer(c, b) > 0;
}

/** Is a manifest bundle worth announcing/applying? Only when it is strictly
 *  newer than the *effective installed UI* — the newest of the app-bundled
 *  renderer and the raw current-slot cache. This prevents (a) a fresh install
 *  re-downloading the same version it already ships (bundled == manifest), and
 *  (b) a regressed manifest downgrading a newer current cache. Unparseable
 *  manifest → never (can't validate); nothing parseable installed → treat as
 *  newer (first real cache). */
export function uiUpdateIsNewer(
  manifestVersion: string,
  bundledVersion: string,
  cachedRawVersion: string | null,
): boolean {
  const m = parseCalVer(manifestVersion);
  if (!m) return false;
  const installed = newestCalVer([bundledVersion, cachedRawVersion]);
  if (!installed) return true;
  return compareCalVer(m, installed) > 0;
}

/** Should UI OTA hot-updates run in this build?
 *
 *  Replaces the old hardcoded `OTA_UI_DISABLED = true` constant (ENG-670) with
 *  a channel/env gate so enabling OTA is never a hand-edited source flip:
 *   - an explicit env override wins, for QA/testing: `OTA_UI=on|off`
 *     (also accepts 1/true/enable and 0/false/disable);
 *   - otherwise OTA is ON only for `prod` (release) builds. `preview`/`stable`
 *     (staging) and `dev` keep their bundled branch-under-test UI, so testers
 *     always run the renderer built from the branch;
 *   - an unknown build kind fails safe to OFF — never hot-update blind. */
export function otaUiEnabled(input: {
  buildKind: string | null | undefined;
  envOverride?: string | null;
}): boolean {
  const env = (input.envOverride ?? '').trim().toLowerCase();
  if (env === 'on' || env === 'enable' || env === '1' || env === 'true') return true;
  if (env === 'off' || env === 'disable' || env === '0' || env === 'false') return false;
  return input.buildKind === 'prod';
}

// ---------------------------------------------------------------------------
// UI OTA manifest
// ---------------------------------------------------------------------------

export interface UIManifest {
  version: string;
  url: string; // GitHub Release asset download URL
  sha256: string;
  minServerVersion?: string; // optional CalVer floor: minimum cowork-server this UI needs
}

/** Should a UI bundle be withheld because the running server can't be shown to
 *  satisfy its declared floor? A safety net ON TOP OF the server-first update
 *  coupling — it covers what coupling can't: UI-only passes, pinned/PyPI server
 *  refs that can't roll forward, and publish-order races. Returns a
 *  human-readable reason to skip, or null to allow.
 *
 *  A *declared* floor fails CLOSED — the whole point of a declared constraint is
 *  to protect the user exactly when compatibility is unknown:
 *   - no/absent floor → allow (absence is the explicit opt-out);
 *   - floor present but not CalVer → skip (a floor we can't interpret is not a
 *     licence to ship);
 *   - floor present but the running server version is unknown/unparseable
 *     (server down, /health timeout, older server omits server_version) → skip;
 *   - server older than the floor (by CalVer date/seq, MAJOR ignored) → skip. */
export function uiServerCompatSkipReason(input: {
  minServerVersion?: string | null;
  serverVersion: string | null;
}): string | null {
  const minRaw = (input.minServerVersion ?? '').trim();
  if (!minRaw) return null; // no constraint declared
  const min = parseCalVer(minRaw);
  if (!min) return `invalid min_server_version "${minRaw}"`;
  const server = parseCalVer(input.serverVersion);
  if (!server) return `server version unknown (need >= ${minRaw})`;
  if (compareCalVer(server, min) < 0) {
    return `server ${input.serverVersion} < required ${minRaw}`;
  }
  return null;
}

/** Validate a fetched latest.json body into a UIManifest, or null.
 *  Field types are checked (not just presence) — this output drives the OTA
 *  download + extract, so nothing non-string may pass as validated. */
export function parseUiManifest(jsonText: string): UIManifest | null {
  try {
    const data = JSON.parse(jsonText);
    const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
    if (!isNonEmptyString(data?.version) || !isNonEmptyString(data?.url)) return null;
    if (typeof data.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(data.sha256)) return null;
    const manifest: UIManifest = { version: data.version, url: data.url, sha256: data.sha256 };
    // Optional server-compat floor (camelCase or the snake_case the publish
    // workflow writes). The publisher omits the field entirely when no floor is
    // intended, so a field that is *present but not a valid non-empty string*
    // is a malformed constraint — reject the whole manifest rather than silently
    // treat it as unconstrained (that would be a fail-open hole).
    const msv = data.minServerVersion ?? data.min_server_version;
    if (msv !== undefined && msv !== null) {
      if (!isNonEmptyString(msv)) return null;
      manifest.minServerVersion = msv;
    }
    return manifest;
  } catch {
    return null;
  }
}
