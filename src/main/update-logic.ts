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
import type { ServerStartErrorKind } from '../shared/server-status';

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

// A CalVer segment carrying a PEP 440 rc suffix, e.g. the "1rc2" in
// 0.26.7.23.1rc2 (the staging pre-release track). Only this exact shape is
// ordered specially; every other non-numeric segment keeps the historical
// NaN comparison semantics (load-bearing for '.devN' git-install versions —
// see parseInstalledVersion).
const RC_SEGMENT = /^(\d+)rc(\d+)$/;

/** Compare dotted versions. <0 if a<b, 0 if equal, >0 if a>b.
 *  Plain numeric segments compare numerically; an `NrcM` segment sorts
 *  before its own base release (X.1rc2 < X.1) and rc numbers order among
 *  themselves, mirroring PEP 440 for the staging rc stream. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ra = pa[i] ?? '0';
    const rb = pb[i] ?? '0';
    const ma = RC_SEGMENT.exec(ra);
    const mb = RC_SEGMENT.exec(rb);
    if (ma || mb) {
      const baseDiff = Number(ma ? ma[1] : ra) - Number(mb ? mb[1] : rb);
      if (baseDiff !== 0) return baseDiff;
      if (ma && mb) {
        const rcDiff = Number(ma[2]) - Number(mb[2]);
        if (rcDiff !== 0) return rcDiff;
        continue;
      }
      // Equal base, one side is the release: the rc precedes it.
      return ma ? -1 : 1;
    }
    const diff = Number(ra) - Number(rb);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Versions eligible for "latest on PyPI" selection: plain dotted CalVer with
// an optional trailing rc suffix. Anything else (dev builds, local versions,
// epochs) is not something the desktop should auto-update onto.
const SANE_PYPI_VERSION = /^\d+(\.\d+)*(rc\d+)?$/;

/** Pick the newest installable version from a PyPI project JSON.
 *  Stable path (prod builds): trust `info.version`, which PyPI computes
 *  excluding pre-releases. Pre-release path (staging/preview builds): scan
 *  the `releases` map for the PEP 440 maximum across stable AND rc versions,
 *  skipping fully-yanked or empty releases and unparseable version strings. */
export function selectLatestPypiVersion(input: {
  infoVersion: string | null;
  releases: Record<string, Array<{ yanked?: boolean }>> | null | undefined;
  includePrereleases: boolean;
}): string | null {
  if (!input.includePrereleases) return input.infoVersion || null;
  const candidates = Object.entries(input.releases ?? {})
    .filter(([version, files]) =>
      SANE_PYPI_VERSION.test(version) &&
      Array.isArray(files) && files.length > 0 &&
      files.some((f) => !f?.yanked))
    .map(([version]) => version);
  if (candidates.length === 0) return input.infoVersion || null;
  return candidates.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

/** Installer gate: does the installed version satisfy the minimum floor? */
export function meetsMinVersion(installed: string, min: string): boolean {
  return compareVersions(installed, min) >= 0;
}

/** Extract the exact anton-agent pin from a wheel's Requires-Dist list.
 *  Staging rc wheels pin `anton-agent==<rc>`; the desktop must re-state that
 *  pin as a DIRECT requirement (`uv tool install ... --with anton-agent==X`)
 *  because uv honors pre-release markers only in direct requirements — left
 *  transitive, an rc pin makes the whole resolution fail. Returns null for
 *  loose constraints (stable wheels), where no direct restatement is needed. */
export function parseAntonPin(requiresDist: unknown): string | null {
  if (!Array.isArray(requiresDist)) return null;
  for (const entry of requiresDist) {
    if (typeof entry !== 'string') continue;
    const match = entry.match(/^anton-agent\s*==\s*([A-Za-z0-9.!+]+)/);
    if (match) return match[1];
  }
  return null;
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
    // Dotted release with an optional rc suffix (the staging pre-release
    // stream). A bare [\d.]+ here once truncated 'X.2rc1' to the phantom
    // release 'X.2', which both froze rc→rc updates (the phantom compares
    // above every same-base rc) and made rollback pin a version that does
    // not exist on PyPI. Local/dev tails ('.dev40+g…') are dropped.
    const match = line.match(/^cowork-server\s+v?(\d+(?:\.\d+)*(?:rc\d+)?)/);
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
 *  fixing anything.
 *
 *  ENG-858: `mode` is no longer a user-facing setting — everyone gets `auto`
 *  unless `UI_UPDATE_MODE=manual` is hand-set in `~/.anton/.env` (support /
 *  QA escape hatch). The parameter and this decision logic are unchanged;
 *  only the Settings UI control that used to feed it was removed. */
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

export interface InstallerStepPlan {
  /** macOS needs the Xcode CLT step only for git-channel installs: uv shells
   *  out to real git there, and Apple's /usr/bin/git shim demands the CLT.
   *  Wheel installs never touch git, so a stock Mac installs clean. */
  needsXcodeStep: boolean;
  /** Whether the installer includes a git step at all. Only the git channel
   *  needs git (uv shells out to fetch a git+https source); a pypi install is
   *  wheels-only, so the git check is omitted entirely rather than shown as a
   *  passing/warning row a user reads as a scary near-miss. */
  showGitStep: boolean;
  /** Whether a missing git aborts the install. Consulted only when the git
   *  step is shown (git channel); uv cannot fetch git sources without it. */
  gitRequired: boolean;
}

export function installerStepPlan(platform: string, channel: 'git' | 'pypi'): InstallerStepPlan {
  const fromGit = channel === 'git';
  return {
    needsXcodeStep: platform === 'darwin' && fromGit,
    showGitStep: fromGit,
    gitRequired: fromGit,
  };
}

// ---------------------------------------------------------------------------
// Sidecar start: how long to keep waiting, and what to say when we stop
// ---------------------------------------------------------------------------

export type StartWaitStep =
  | { action: 'ready' }
  | { action: 'poll' }
  | { action: 'fail'; kind: Exclude<ServerStartErrorKind, 'not-installed'> };

/** One iteration of the start wait: is the sidecar up, should we keep waiting,
 *  or is it over?
 *
 *  This replaces a flat "give up after N ms" timer, which was wrong in both
 *  directions: a slow-but-healthy machine got killed mid-import, and a sidecar
 *  that died in the first second still made the user wait out the whole timer
 *  to be told nothing useful. Waiting on liveness instead means a slow start
 *  succeeds and a dead one is reported the moment it dies.
 *
 *  Health is evaluated BEFORE liveness on purpose. Both spawn targets normally
 *  wait on python and forward its exit code, so an exit really is the end — but
 *  the two are reported through different channels and can land out of order,
 *  and a launcher that hands off without waiting would look identical to a
 *  crash. Asking "did it answer /health" first means a server that is provably
 *  up is never called dead over a technicality about who its parent was. */
export function decideStartWait(input: {
  healthy: boolean;
  spawnError: string | null;
  exited: boolean;
  elapsedMs: number;
  capMs: number;
}): StartWaitStep {
  if (input.healthy) return { action: 'ready' };
  if (input.spawnError) return { action: 'fail', kind: 'spawn-error' };
  if (input.exited) return { action: 'fail', kind: 'exited' };
  if (input.elapsedMs >= input.capMs) return { action: 'fail', kind: 'timeout' };
  return { action: 'poll' };
}

/** Sub-10s durations keep a decimal — the whole point of the early-exit path is
 *  that it reports in a couple of seconds, and "0s" would hide that. */
function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

/** The one-line failure the diagnostics panel shows.
 *
 *  Each kind gets its own sentence. They all used to collapse into "Server did
 *  not respond on /health within 15000ms", which described the app's timer
 *  rather than anything that happened to the backend, and read identically
 *  whether the process had crashed instantly or was importing normally. */
export function startFailureMessage(input: {
  kind: Exclude<ServerStartErrorKind, 'not-installed'>;
  exitCode: number | null;
  spawnError: string | null;
  elapsedMs: number;
}): string {
  switch (input.kind) {
    case 'spawn-error':
      return `The backend could not be launched: ${input.spawnError || 'unknown spawn error'}.`;
    case 'exited': {
      const code = typeof input.exitCode === 'number' ? `code ${input.exitCode}` : 'no exit code';
      return `The backend exited while starting up (${code}) after ${formatElapsed(input.elapsedMs)}.`;
    }
    case 'timeout':
      return `The backend was still starting after ${formatElapsed(input.elapsedMs)} and never answered /health.`;
  }
}
