// Shared pure parsing and update decisions; installer and updater modules own the I/O.

// Pure CalVer helpers from the shared version module (no I/O) — used by the
// OTA cache-freshness / update-newer decisions below.
import { parseCalVer, compareCalVer, newestCalVer } from '../shared/version';
import type { ServerStartErrorKind } from '../shared/server-status';
import type { UpdateCheckSummary } from '../shared/update-types';

// Version comparison

// Only NrcM segments get prerelease ordering; retain existing NaN semantics for other nonnumeric
// segments.
const RC_SEGMENT = /^(\d+)rc(\d+)$/;

/** Compare dotted versions numerically, with NrcM before its base release and ordered by rc number. */
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

// Admit dotted releases and trailing rc versions only; exclude dev/local versions and epochs.
const SANE_PYPI_VERSION = /^\d+(\.\d+)*(rc\d+)?$/;

/**
 * Use info.version for stable builds; scan nonempty, non-yanked parseable releases when rc versions
 * are allowed.
 */
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

/**
 * Extract an exact Anton pin for direct restatement; uv does not admit transitive rc pins alone.
 * Return null for loose constraints.
 */
export function parseAntonPin(requiresDist: unknown): string | null {
  if (!Array.isArray(requiresDist)) return null;
  for (const entry of requiresDist) {
    if (typeof entry !== 'string') continue;
    const match = entry.match(/^anton-agent\s*==\s*([A-Za-z0-9.!+]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Return the conjunction of all unmarked Anton bounds, empty string for an unbounded requirement,
 * or null if unreadable.
 * Any environment marker makes the whole read fail closed: stripping it could offer a version
 * forbidden on this interpreter.
 * Unlike parseAntonPin, this returns the full permitted range.
 */
export function parseAntonConstraint(requiresDist: unknown): string | null {
  if (!Array.isArray(requiresDist)) return null;
  const specs: string[] = [];
  for (const entry of requiresDist) {
    if (typeof entry !== 'string') continue;
    // Match the exact package name with optional extras, then capture its specifier and environment
    // marker.
    const m = entry.match(/^\s*anton-agent(?![A-Za-z0-9_-])\s*(?:\[[^\]]*\])?\s*(.*)$/i);
    if (!m) continue;
    const rest = m[1];
    const semi = rest.indexOf(';');
    // Fail closed on real environment markers; an empty trailing semicolon is not a marker.
    if (semi !== -1 && rest.slice(semi + 1).trim() !== '') return null;
    let spec = (semi === -1 ? rest : rest.slice(0, semi)).trim();
    // PEP 508 allows the specifier wrapped in parentheses: `anton-agent (>=2)`.
    if (spec.startsWith('(') && spec.endsWith(')')) spec = spec.slice(1, -1).trim();
    specs.push(spec);
  }
  if (specs.length === 0) return null;
  return specs.filter((s) => s !== '').join(',');
}

// Exclude wildcards so unsupported clauses fail closed rather than offering an unproven version.
const SPEC_CLAUSE = /^(<=|>=|==|!=|<|>)\s*([0-9A-Za-z.!+]+)$/;

/**
 * Require every clause to match. Null or unsupported operators/wildcards fail closed; empty string
 * allows any version.
 */
export function satisfiesAntonConstraint(version: string, constraint: string | null): boolean {
  if (constraint === null) return false;
  const spec = constraint.trim();
  if (spec === '') return true;
  for (const raw of spec.split(',')) {
    const clause = raw.trim();
    if (clause === '') continue;
    const m = SPEC_CLAUSE.exec(clause);
    if (!m) return false;
    const op = m[1];
    const cmp = compareVersions(version, m[2]);
    switch (op) {
      case '<': {
        if (!(cmp < 0)) return false;
        // PEP 440 <V excludes V’s own prereleases unless V is itself a prerelease; numeric ordering
        // alone would admit them.
        const vIsPre = /rc\d+$/.test(m[2]);
        const candBase = version.replace(/rc\d+$/, '');
        const candIsPre = candBase !== version;
        if (candIsPre && !vIsPre && compareVersions(candBase, m[2]) === 0) return false;
        break;
      }
      case '<=': if (!(cmp <= 0)) return false; break;
      case '>': if (!(cmp > 0)) return false; break;
      case '>=': if (!(cmp >= 0)) return false; break;
      case '==': if (cmp !== 0) return false; break;
      default: if (cmp === 0) return false; break;
    }
  }
  return true;
}

/**
 * Scan releases within the server’s Anton constraint and channel stream; info.version may be
 * outside the permitted major.
 * Return null when no version qualifies.
 */
export function selectLatestConstrainedPypiVersion(input: {
  releases: Record<string, Array<{ yanked?: boolean }>> | null | undefined;
  includePrereleases: boolean;
  satisfies: (version: string) => boolean;
}): string | null {
  const candidates = Object.entries(input.releases ?? {})
    .filter(([version, files]) =>
      SANE_PYPI_VERSION.test(version) &&
      (input.includePrereleases || !/rc\d+$/.test(version)) &&
      Array.isArray(files) && files.length > 0 &&
      files.some((f) => !f?.yanked) &&
      input.satisfies(version))
    .map(([version]) => version);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

// Installed version parsing

/** Strip ANSI escapes before parsing uv output, even when the caller also requests NO_COLOR. */
export function parseInstalledVersion(stdout: string): string | null {
  // eslint-disable-next-line no-control-regex
  const clean = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of clean.split('\n')) {
    // Preserve rc suffixes so X.2rc1 is not mistaken for the nonexistent/higher release X.2. Drop
    // dev/local tails.
    const match = line.match(/^cowork-server\s+v?(\d+(?:\.\d+)*(?:rc\d+)?)/);
    if (match) return match[1];
  }
  return null;
}

// Git reference parsing

/** A 40-hex ref IS a commit — no remote lookup needed. */
export function isFullCommitSha(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref);
}

/** Prefer an exact head/tag ref; fall back to the first usable SHA, or null. */
export function parseLsRemote(stdout: string, ref: string): string | null {
  const lines = stdout.split('\n').filter(Boolean);
  const pick =
    lines.find((l) => l.includes(`refs/heads/${ref}`) || l.includes(`refs/tags/${ref}`)) ||
    lines[0];
  const sha = pick ? pick.split('\t')[0].trim().toLowerCase() : '';
  return sha || null;
}

// Installed source detection

export interface VcsInfo {
  commit: string;
  requestedRevision: string;
}

/**
 * Return VCS metadata or null for registry/malformed input; this controls git-versus-PyPI update
 * routing.
 */
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

// Update decisions

export interface GitUpdateDecision {
  coworkChanged: boolean;
  antonChanged: boolean;
  needsUpdate: boolean;
}

/**
 * Update only changed resolved git commits. Offline remotes and absent Anton VCS metadata do not
 * trigger reinstall.
 */
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

/**
 * Update only to newer PyPI versions; report unknown installed versions, silently skip unreachable
 * PyPI.
 */
export function decidePypiUpdate(
  currentVersion: string | null,
  latestVersion: string | null,
): PypiUpdateDecision {
  if (!currentVersion) return { action: 'skip', reason: 'unknown-installed-version' };
  if (!latestVersion) return { action: 'skip', reason: 'no-latest-version' };
  if (compareVersions(latestVersion, currentVersion) <= 0) return { action: 'up-to-date' };
  return { action: 'update', from: currentVersion, to: latestVersion };
}

/** Is this an rc-stream pre-release? Only the rc grammar this project
 *  publishes counts; dev/local tails are not the rc stream. */
export function isPrereleaseVersion(version: string): boolean {
  return version.split('.').some((segment) => RC_SEGMENT.test(segment));
}

export type StreamRepairDecision =
  | { action: 'repair'; from: string; to: string }
  | {
      action: 'skip';
      reason: 'not-prod' | 'unknown-installed-version' | 'on-stream' | 'no-latest-version' | 'latest-not-stable';
    };

/** The deliberate-downgrade decision that puts a prod install holding a
 *  pre-release back on the stable stream, which the forward-only update path never does. */
export function decideStreamRepair(input: {
  buildKind: string | null | undefined;
  currentVersion: string | null;
  latestVersion: string | null;
}): StreamRepairDecision {
  if (input.buildKind !== 'prod') return { action: 'skip', reason: 'not-prod' };
  if (!input.currentVersion) return { action: 'skip', reason: 'unknown-installed-version' };
  if (!isPrereleaseVersion(input.currentVersion)) return { action: 'skip', reason: 'on-stream' };
  if (!input.latestVersion) return { action: 'skip', reason: 'no-latest-version' };
  if (isPrereleaseVersion(input.latestVersion)) return { action: 'skip', reason: 'latest-not-stable' };
  return { action: 'repair', from: input.currentVersion, to: input.latestVersion };
}

// Boot recovery

/**
 * Recognize explicit Python import failures that reinstall can repair; ignore migration/port/config
 * failures.
 * Do not match the bare word import, which also appears in unrelated tracebacks.
 */
export function looksLikeBrokenInstall(log: string | null | undefined): boolean {
  if (!log) return false;
  return /\bModuleNotFoundError\b|\bImportError\b|No module named|cannot import name|\(unknown location\)/.test(
    log,
  );
}

// Update application

export interface UpdateApplyDecision {
  applyServer: boolean;
  applyUi: boolean;
}

/**
 * Recover a down server regardless of mode or poll timing. Otherwise auto-apply only during
 * auto-mode boot checks.
 * Do not force UI reload for server-down recovery; manual/periodic checks only advertise it.
 */
export function decideUpdateApply(input: {
  serverUpdateAvailable: boolean;
  uiUpdateAvailable: boolean;
  serverDown: boolean;
  isBootCheck: boolean;
  mode: 'auto' | 'manual';
  repairOnly?: boolean;
}): UpdateApplyDecision {
  const { serverUpdateAvailable, uiUpdateAvailable, serverDown, isBootCheck, mode, repairOnly } = input;
  const autoOk = isBootCheck && mode === 'auto';
  // A stream repair is boot-only: it gets no mid-session banner, so boot must
  // apply it even in manual mode, and the serverDown override never fires it.
  return {
    applyServer: serverUpdateAvailable && (repairOnly ? isBootCheck : (serverDown || autoOk)),
    applyUi: uiUpdateAvailable && autoOk,
  };
}

// On-demand update summary

/** A confirmed update wins over an error from another channel. With no update,
 * any channel error makes the result inconclusive; both errors imply offline. */
export function summarizeUpdateCheck(input: {
  ui: { updateAvailable: boolean; newVersion?: string; error?: boolean };
  server: {
    updateAvailable: boolean;
    latestVersion?: string;
    error?: boolean;
    component?: 'cowork-server' | 'anton-agent';
  };
  shell?: { updateAvailable: boolean; version?: string; downloadUrl?: string };
}): UpdateCheckSummary {
  const uiUpdateAvailable = !!input.ui.updateAvailable;
  const serverUpdateAvailable = !!input.server.updateAvailable;
  const shellUpdateAvailable = !!input.shell?.updateAvailable;
  const updateAvailable = uiUpdateAvailable || serverUpdateAvailable || shellUpdateAvailable;

  if (!updateAvailable && (input.ui.error || input.server.error)) {
    return {
      ok: false,
      offline: !!input.ui.error && !!input.server.error,
      updateAvailable: false,
      uiUpdateAvailable: false,
      serverUpdateAvailable: false,
      shellUpdateAvailable: false,
    };
  }

  const summary: UpdateCheckSummary = {
    ok: true,
    offline: false,
    updateAvailable,
    uiUpdateAvailable,
    serverUpdateAvailable,
    shellUpdateAvailable,
  };
  if (uiUpdateAvailable && input.ui.newVersion) summary.uiVersion = input.ui.newVersion;
  if (serverUpdateAvailable && input.server.latestVersion) summary.serverVersion = input.server.latestVersion;
  if (serverUpdateAvailable && input.server.component) summary.serverComponent = input.server.component;
  if (shellUpdateAvailable && input.shell?.version) summary.shellVersion = input.shell.version;
  if (shellUpdateAvailable && input.shell?.downloadUrl) summary.shellDownloadUrl = input.shell.downloadUrl;
  return summary;
}

// UI OTA enablement

/** Serve only valid caches newer than bundled UI; stale or unparseable caches fall back to bundled. */
export function otaCacheIsFresh(cachedVersion: string | null, bundledVersion: string): boolean {
  const c = parseCalVer(cachedVersion);
  const b = parseCalVer(bundledVersion);
  if (!c || !b) return false;
  return compareCalVer(c, b) > 0;
}

/**
 * Require a parseable manifest newer than both bundled and cached UI.
 * If neither installed version parses, allow the first valid cache.
 */
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

/**
 * Explicit OTA_UI overrides win; otherwise enable only prod, preserving other channels’ bundled UI.
 * Unknown build kinds disable OTA.
 */
export function otaUiEnabled(input: {
  buildKind: string | null | undefined;
  envOverride?: string | null;
}): boolean {
  const env = (input.envOverride ?? '').trim().toLowerCase();
  if (env === 'on' || env === 'enable' || env === '1' || env === 'true') return true;
  if (env === 'off' || env === 'disable' || env === '0' || env === 'false') return false;
  return input.buildKind === 'prod';
}

// UI OTA manifest

export interface UIManifest {
  version: string;
  url: string; // GitHub Release asset download URL
  sha256: string;
  minServerVersion?: string; // Optional server floor and shell release version. Shell version is emitted only when an installer
// ships;
// absence means no shell-update notice.
  shellVersion?: string;
}

/**
 * No floor allows the UI. A declared floor fails closed if invalid, unverifiable or newer than the
 * running server.
 * Compare CalVer date/sequence, ignoring major; return a skip reason or null.
 */
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

/** Validate manifest field types before they drive download/extraction. */
export function parseUiManifest(jsonText: string): UIManifest | null {
  try {
    const data = JSON.parse(jsonText);
    const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
    if (!isNonEmptyString(data?.version) || !isNonEmptyString(data?.url)) return null;
    if (typeof data.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(data.sha256)) return null;
    const manifest: UIManifest = { version: data.version, url: data.url, sha256: data.sha256 };
    // Reject a present but invalid server floor; silently dropping it would make a constrained
    // bundle unrestricted.
    const msv = data.minServerVersion ?? data.min_server_version;
    if (msv !== undefined && msv !== null) {
      if (!isNonEmptyString(msv)) return null;
      manifest.minServerVersion = msv;
    }
    // Shell version is advisory: accept supported aliases and ignore malformed values without
    // rejecting UI updates.
    const sv = data.shellVersion ?? data.shell_version ?? (data.shell && typeof data.shell === 'object' ? data.shell.version : undefined);
    if (isNonEmptyString(sv)) manifest.shellVersion = sv;
    return manifest;
  } catch {
    return null;
  }
}

export interface InstallerStepPlan {
  /** Git-channel macOS installs require CLT; wheel installs do not. */
  needsXcodeStep: boolean;
  /** Show the git prerequisite step only for git-channel installs. */
  showGitStep: boolean;
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

// Sidecar startup decisions

export type StartWaitStep =
  | { action: 'ready' }
  | { action: 'poll' }
  | { action: 'fail'; kind: Exclude<ServerStartErrorKind, 'not-installed'> };

/**
 * Check health before launcher liveness: the server may answer after its launcher hands off/exits.
 * Otherwise fail immediately on child death and bound a live startup by its cap.
 */
export function decideStartWait(input: {
  healthy: boolean;
  incompatible?: boolean;
  spawnError: string | null;
  exited: boolean;
  elapsedMs: number;
  capMs: number;
}): StartWaitStep {
  if (input.healthy) return { action: 'ready' };
  if (input.incompatible) return { action: 'fail', kind: 'incompatible' };
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

/**
 * Report the backend’s actual failure kind rather than the same health-timeout message for every
 * failure.
 */
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
    case 'incompatible':
      return 'The backend is running, but it is too old for this version of MindsHub Cowork.';
  }
}

// Shell update notice

const SHELL_DOWNLOADS_BASE = 'https://downloads.mindshub.ai/mindshub-cowork';

/** Compare shell CalVers, failing closed for dev or malformed versions. */
export function shellUpdateIsNewer(
  latestShellVersion: string | null | undefined,
  installedShellVersion: string | null | undefined,
): boolean {
  const latest = parseCalVer(latestShellVersion);
  const installed = parseCalVer(installedShellVersion);
  if (!latest || !installed) return false;
  return compareCalVer(latest, installed) > 0;
}

/** Treat active shell-update phases as pending so a manual check cannot report up to date. */
export function shellAutoUpdateIsActive(phase: string): boolean {
  return phase === 'available' || phase === 'downloading' || phase === 'ready-to-install';
}

/**
 * Use the manual notice only when auto-update is disabled or terminally failed; recoverable errors
 * still retry automatically.
 */
export function shellManualNoticeIsFallback(
  phase: string,
  recoverable: boolean | undefined,
): boolean {
  return phase === 'disabled' || (phase === 'failed' && recoverable === false);
}

/** Return the installer URL for a supported platform and release channel. */
export function shellDownloadUrl(
  platform: string,
  buildKind: string | null | undefined,
): string | null {
  const slot = buildKind === 'prod' ? 'latest' : buildKind === 'stable' ? 'staging' : null;
  if (!slot) return null;
  if (platform === 'darwin') return `${SHELL_DOWNLOADS_BASE}/mac/mindshub-cowork-${slot}.pkg`;
  if (platform === 'win32') return `${SHELL_DOWNLOADS_BASE}/windows/mindshub-cowork-${slot}.exe`;
  return null;
}
