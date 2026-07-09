// Pure decision logic shared by the installer (installer.ts) and the
// updaters (server-updater.ts, ui-updater.ts). No fs, no child_process, no
// electron, no network — every function here maps inputs to a decision, so
// it can be unit-tested directly (qa.md §5a). The orchestration modules own
// the I/O and delegate parsing/decisions here.
//
// compareVersions and the `uv tool list` parsing used to be duplicated
// verbatim in installer.ts and server-updater.ts with "keep in sync"
// comments; this module is now the single copy.

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
// UI OTA manifest
// ---------------------------------------------------------------------------

export interface UIManifest {
  version: string;
  url: string; // GitHub Release asset download URL
  sha256: string;
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
    return { version: data.version, url: data.url, sha256: data.sha256 };
  } catch {
    return null;
  }
}
