import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  installerStepPlan,
  meetsMinVersion,
  parseAntonPin,
  selectLatestPypiVersion,
  parseInstalledVersion,
  isFullCommitSha,
  parseLsRemote,
  parseVcsInfo,
  decideGitUpdate,
  decidePypiUpdate,
  parseUiManifest,
  looksLikeBrokenInstall,
  decideUpdateApply,
  otaUiEnabled,
  otaCacheIsFresh,
  uiUpdateIsNewer,
  uiServerCompatSkipReason,
  decideStartWait,
  startFailureMessage,
  shellUpdateIsNewer,
  shellDownloadUrl,
  summarizeUpdateCheck,
} from './update-logic';

describe('compareVersions', () => {
  it('orders plain X.Y.Z versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.10.0')).toBeLessThan(0); // numeric, not lexicographic
  });

  it('treats missing segments as zero (1.2 == 1.2.0, 1.2.1 > 1.2)', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0);
  });
});

describe('meetsMinVersion', () => {
  it('gates on the floor, inclusive', () => {
    expect(meetsMinVersion('0.1.10', '0.1.10')).toBe(true);
    expect(meetsMinVersion('0.2.0', '0.1.10')).toBe(true);
    expect(meetsMinVersion('0.1.9', '0.1.10')).toBe(false);
  });
});

describe('parseInstalledVersion', () => {
  it('parses plain `uv tool list` output', () => {
    const stdout = 'cowork-server v0.1.12\n- cowork-server\nother-tool v2.0.0\n';
    expect(parseInstalledVersion(stdout)).toBe('0.1.12');
  });

  it('strips ANSI escapes (FORCE_COLOR regression: version read as null in dev)', () => {
    const stdout = '\x1b[1mcowork-server v0.1.6\x1b[0m\n- cowork-server\n';
    expect(parseInstalledVersion(stdout)).toBe('0.1.6');
  });

  it('does not match the package as a dependency line or substring', () => {
    expect(parseInstalledVersion('- cowork-server\n')).toBeNull();
    expect(parseInstalledVersion('not-cowork-server v1.0.0\n')).toBeNull();
    expect(parseInstalledVersion('')).toBeNull();
  });

  it('accepts a version without the v prefix', () => {
    expect(parseInstalledVersion('cowork-server 0.1.12\n')).toBe('0.1.12');
  });

  it('keeps the rc suffix intact (staging pre-release stream)', () => {
    // Truncating to the phantom base release froze rc→rc updates and made
    // rollback pin a version that does not exist on PyPI.
    expect(parseInstalledVersion('cowork-server v0.26.7.23.2rc1\n')).toBe('0.26.7.23.2rc1');
  });

  it('drops dev/local tails but keeps the release (and any rc) prefix', () => {
    expect(parseInstalledVersion('cowork-server v0.26.7.6.4.dev40+g82a1da968\n')).toBe('0.26.7.6.4');
    expect(parseInstalledVersion('cowork-server v0.26.7.23.2rc2.dev3+gabc1234\n')).toBe('0.26.7.23.2rc2');
  });
});

describe('isFullCommitSha', () => {
  it('accepts exactly 40 hex chars, case-insensitive', () => {
    expect(isFullCommitSha('a'.repeat(40))).toBe(true);
    expect(isFullCommitSha('ABCDEF0123456789abcdef0123456789abcdef01')).toBe(true);
    expect(isFullCommitSha('a'.repeat(39))).toBe(false); // short sha ≠ commit
    expect(isFullCommitSha('main')).toBe(false);
    expect(isFullCommitSha('g'.repeat(40))).toBe(false); // non-hex
  });
});

describe('parseLsRemote', () => {
  const sha1 = '1111111111111111111111111111111111111111';
  const sha2 = '2222222222222222222222222222222222222222';

  it('prefers the heads/ match over a non-matching earlier line', () => {
    // Classic ls-remote shape: HEAD first, then the branch ref. The heads/
    // line must win over the positional first line. (Matching is substring —
    // fine in practice because `git ls-remote repo <ref>` already filters to
    // exact ref-component matches, so `main-archive` can't appear here.)
    const stdout = `${sha1}\tHEAD\n${sha2}\trefs/heads/main\n`;
    expect(parseLsRemote(stdout, 'main')).toBe(sha2);
  });

  it('matches tags/ for tag refs', () => {
    const stdout = `${sha1}\trefs/tags/v1.2.3\n`;
    expect(parseLsRemote(stdout, 'v1.2.3')).toBe(sha1);
  });

  it('falls back to the first line when no exact match', () => {
    const stdout = `${sha1.toUpperCase()}\tHEAD\n`;
    expect(parseLsRemote(stdout, 'main')).toBe(sha1); // also lowercased
  });

  it('returns null on empty output (unknown ref)', () => {
    expect(parseLsRemote('', 'nonexistent-branch')).toBeNull();
    expect(parseLsRemote('\n\n', 'x')).toBeNull();
  });
});

describe('parseVcsInfo (direct_url.json → git-vs-PyPI channel switch)', () => {
  it('parses a git install', () => {
    const json = JSON.stringify({
      url: 'https://github.com/mindsdb/cowork-server.git',
      vcs_info: { vcs: 'git', commit_id: 'abc123', requested_revision: 'main' },
    });
    expect(parseVcsInfo(json)).toEqual({ commit: 'abc123', requestedRevision: 'main' });
  });

  it('defaults requestedRevision to empty when absent', () => {
    const json = JSON.stringify({ vcs_info: { commit_id: 'abc123' } });
    expect(parseVcsInfo(json)).toEqual({ commit: 'abc123', requestedRevision: '' });
  });

  it('returns null for a PyPI install (no vcs_info) — this switches the updater to the PyPI path', () => {
    expect(parseVcsInfo(JSON.stringify({ url: 'https://files.pythonhosted.org/...' }))).toBeNull();
  });

  it('returns null for missing commit_id, malformed JSON, and non-object JSON', () => {
    expect(parseVcsInfo(JSON.stringify({ vcs_info: { vcs: 'git' } }))).toBeNull();
    expect(parseVcsInfo('{not json')).toBeNull();
    expect(parseVcsInfo('null')).toBeNull();
    expect(parseVcsInfo('"str"')).toBeNull();
  });
});

describe('decideGitUpdate', () => {
  const commit = (c: string) => ({ commit: c, requestedRevision: 'main' });
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  it('no update when both remotes match the installed commits', () => {
    const d = decideGitUpdate({
      coworkRemote: A,
      antonRemote: B,
      coworkVcs: commit(A),
      antonVcs: commit(B),
    });
    expect(d).toEqual({ coworkChanged: false, antonChanged: false, needsUpdate: false });
  });

  it('updates when cowork-server moved', () => {
    const d = decideGitUpdate({
      coworkRemote: B,
      antonRemote: B,
      coworkVcs: commit(A),
      antonVcs: commit(B),
    });
    expect(d.coworkChanged).toBe(true);
    expect(d.needsUpdate).toBe(true);
  });

  it('updates when only anton moved (dependency updates alone must trigger)', () => {
    const d = decideGitUpdate({
      coworkRemote: A,
      antonRemote: A,
      coworkVcs: commit(A),
      antonVcs: commit(B),
    });
    expect(d).toEqual({ coworkChanged: false, antonChanged: true, needsUpdate: true });
  });

  it('compares commits case-insensitively (installed commit may be uppercase)', () => {
    const d = decideGitUpdate({
      coworkRemote: A,
      antonRemote: null,
      coworkVcs: commit(A.toUpperCase()),
      antonVcs: null,
    });
    expect(d.needsUpdate).toBe(false);
  });

  it('fails safe to "no update" when offline (null remotes)', () => {
    const d = decideGitUpdate({
      coworkRemote: null,
      antonRemote: null,
      coworkVcs: commit(A),
      antonVcs: commit(B),
    });
    expect(d.needsUpdate).toBe(false);
  });

  it('ignores anton when it has no VCS record (never a surprise reinstall)', () => {
    const d = decideGitUpdate({
      coworkRemote: A,
      antonRemote: B,
      coworkVcs: commit(A),
      antonVcs: null,
    });
    expect(d.antonChanged).toBe(false);
    expect(d.needsUpdate).toBe(false);
  });
});

describe('decidePypiUpdate', () => {
  it('updates only on a strictly newer version', () => {
    expect(decidePypiUpdate('0.1.10', '0.1.11')).toEqual({
      action: 'update',
      from: '0.1.10',
      to: '0.1.11',
    });
    expect(decidePypiUpdate('0.1.10', '0.1.10')).toEqual({ action: 'up-to-date' });
    // A yanked/rolled-back PyPI latest must never "downgrade-update".
    expect(decidePypiUpdate('0.1.11', '0.1.10')).toEqual({ action: 'up-to-date' });
  });

  it('skips with a reported reason when the installed version is unknown', () => {
    expect(decidePypiUpdate(null, '0.1.11')).toEqual({
      action: 'skip',
      reason: 'unknown-installed-version',
    });
  });

  it('skips silently when PyPI is unreachable (offline is normal)', () => {
    expect(decidePypiUpdate('0.1.10', null)).toEqual({
      action: 'skip',
      reason: 'no-latest-version',
    });
  });
});

describe('parseUiManifest', () => {
  const SHA = 'ab'.repeat(32); // 64 hex chars
  const valid = { version: '1.2.3', url: 'https://x/ui.tar.gz', sha256: SHA };

  it('accepts a complete manifest (sha case-insensitive) and strips extra fields', () => {
    expect(parseUiManifest(JSON.stringify(valid))).toEqual(valid);
    expect(parseUiManifest(JSON.stringify({ ...valid, sha256: SHA.toUpperCase() }))).toEqual({
      ...valid,
      sha256: SHA.toUpperCase(),
    });
    expect(parseUiManifest(JSON.stringify({ ...valid, extra: 'field' }))).toEqual(valid);
  });

  it('rejects manifests missing any required field, and malformed JSON', () => {
    expect(parseUiManifest(JSON.stringify({ version: '1', url: 'u' }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ version: '1', sha256: SHA }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ url: 'u', sha256: SHA }))).toBeNull();
    expect(parseUiManifest('{oops')).toBeNull();
    expect(parseUiManifest('null')).toBeNull();
  });

  it('rejects non-string field types (this output drives the OTA download)', () => {
    expect(parseUiManifest(JSON.stringify({ ...valid, version: 123 }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ ...valid, url: ['https://x'] }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ ...valid, sha256: { hex: SHA } }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ ...valid, version: '' }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ ...valid, url: '' }))).toBeNull();
  });

  it('rejects a sha256 that is not exactly 64 hex chars', () => {
    expect(parseUiManifest(JSON.stringify({ ...valid, sha256: 'abc' }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ ...valid, sha256: SHA + 'ab' }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ ...valid, sha256: 'zz'.repeat(32) }))).toBeNull();
  });

  it('picks up an optional min server version (snake_case or camelCase)', () => {
    expect(parseUiManifest(JSON.stringify({ ...valid, min_server_version: '2.26.7.6.1' }))).toEqual({
      ...valid,
      minServerVersion: '2.26.7.6.1',
    });
    expect(parseUiManifest(JSON.stringify({ ...valid, minServerVersion: '2.26.7.6.1' }))).toEqual({
      ...valid,
      minServerVersion: '2.26.7.6.1',
    });
    // Field absent entirely → unconstrained (the publisher's opt-out).
    expect(parseUiManifest(JSON.stringify(valid))).toEqual(valid);
  });

  it('rejects a manifest whose min server version is present but malformed', () => {
    // A declared-but-invalid floor is an error, not an opt-out — don't silently
    // ship it as unconstrained.
    expect(parseUiManifest(JSON.stringify({ ...valid, min_server_version: 123 }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ ...valid, min_server_version: '' }))).toBeNull();
    expect(parseUiManifest(JSON.stringify({ ...valid, minServerVersion: {} }))).toBeNull();
  });
});

describe('looksLikeBrokenInstall', () => {
  it('matches the import-failure markers a broken/partial venv produces', () => {
    // The two real incidents this gate is built around.
    expect(
      looksLikeBrokenInstall("ImportError: cannot import name 'Doc' from 'annotated_doc' (unknown location)"),
    ).toBe(true);
    expect(looksLikeBrokenInstall("ModuleNotFoundError: No module named 'sqlalchemy.util.typing'")).toBe(true);
    expect(looksLikeBrokenInstall('  File "x.py"\nImportError: bad thing')).toBe(true);
  });

  it('does NOT match a runtime/data failure that a reinstall cannot fix', () => {
    // An Alembic "database ahead" trace — note it contains benign frames like
    // `<frozen importlib._bootstrap>`, which must NOT be mistaken for an import
    // failure (that false positive is exactly what caused the bad reinstall).
    const migration = [
      '  File "<frozen importlib._bootstrap>", line 488, in _call_with_frames_removed',
      '  File ".../alembic/script/revision.py", line 637, in _revision_for_ident',
      "alembic.script.revision.ResolutionError: No such revision or branch 'e8b3c5d7a9f1'",
      "alembic.util.exc.CommandError: Can't locate revision identified by 'e8b3c5d7a9f1'",
    ].join('\n');
    expect(looksLikeBrokenInstall(migration)).toBe(false);
    expect(looksLikeBrokenInstall('[Errno 48] Address already in use')).toBe(false);
    expect(looksLikeBrokenInstall('Server did not respond on /health within 15000ms.')).toBe(false);
  });

  it('is false for empty / missing logs (fail safe: no reinstall)', () => {
    expect(looksLikeBrokenInstall('')).toBe(false);
    expect(looksLikeBrokenInstall(undefined)).toBe(false);
    expect(looksLikeBrokenInstall(null)).toBe(false);
  });
});

describe('decideUpdateApply', () => {
  const base = {
    serverUpdateAvailable: true,
    uiUpdateAvailable: true,
    serverDown: false,
    isBootCheck: true,
    mode: 'auto' as const,
  };

  it('auto mode boot check applies both server and UI', () => {
    expect(decideUpdateApply(base)).toEqual({ applyServer: true, applyUi: true });
  });

  it('manual mode with a healthy server applies nothing (banner only)', () => {
    expect(decideUpdateApply({ ...base, mode: 'manual' })).toEqual({ applyServer: false, applyUi: false });
  });

  it('periodic re-check (not boot) applies nothing even in auto mode', () => {
    expect(decideUpdateApply({ ...base, isBootCheck: false })).toEqual({ applyServer: false, applyUi: false });
  });

  it('a DOWN server applies an available server update regardless of mode', () => {
    // The recovery case: manual mode, and even a periodic (non-boot) check.
    expect(decideUpdateApply({ ...base, serverDown: true, mode: 'manual' }).applyServer).toBe(true);
    expect(decideUpdateApply({ ...base, serverDown: true, mode: 'manual', isBootCheck: false }).applyServer).toBe(true);
  });

  it('never force-applies UI just because the server is down', () => {
    // A dead backend is a server problem; forcing a UI swap adds churn.
    expect(decideUpdateApply({ ...base, serverDown: true, mode: 'manual' }).applyUi).toBe(false);
  });

  it('applies nothing when there is nothing to apply, even for a down server', () => {
    expect(
      decideUpdateApply({ ...base, serverUpdateAvailable: false, uiUpdateAvailable: false, serverDown: true }),
    ).toEqual({ applyServer: false, applyUi: false });
  });
});

describe('otaUiEnabled', () => {
  it('is ON only for prod builds by default', () => {
    expect(otaUiEnabled({ buildKind: 'prod' })).toBe(true);
    expect(otaUiEnabled({ buildKind: 'stable' })).toBe(false);
    expect(otaUiEnabled({ buildKind: 'preview' })).toBe(false);
    expect(otaUiEnabled({ buildKind: 'dev' })).toBe(false);
  });

  it('fails safe to OFF for an unknown/missing build kind', () => {
    expect(otaUiEnabled({ buildKind: null })).toBe(false);
    expect(otaUiEnabled({ buildKind: undefined })).toBe(false);
    expect(otaUiEnabled({ buildKind: 'something-else' })).toBe(false);
  });

  it('lets an explicit env override win over the build kind (both directions)', () => {
    // Force ON even on a non-prod build...
    for (const v of ['on', 'enable', '1', 'true', 'TRUE', ' On ']) {
      expect(otaUiEnabled({ buildKind: 'stable', envOverride: v })).toBe(true);
    }
    // ...and force OFF even on prod.
    for (const v of ['off', 'disable', '0', 'false', 'FALSE', ' Off ']) {
      expect(otaUiEnabled({ buildKind: 'prod', envOverride: v })).toBe(false);
    }
  });

  it('ignores a blank/unrecognized override and falls back to build kind', () => {
    expect(otaUiEnabled({ buildKind: 'prod', envOverride: '' })).toBe(true);
    expect(otaUiEnabled({ buildKind: 'prod', envOverride: 'maybe' })).toBe(true);
    expect(otaUiEnabled({ buildKind: 'stable', envOverride: 'maybe' })).toBe(false);
  });
});

describe('otaCacheIsFresh', () => {
  it('serves the cache only when it is strictly newer than the bundled renderer', () => {
    expect(otaCacheIsFresh('2.26.7.13.1', '2.26.7.6.1')).toBe(true);
    expect(otaCacheIsFresh('2.26.7.6.1', '2.26.7.13.1')).toBe(false); // older cache → bundled wins
    expect(otaCacheIsFresh('2.26.7.6.1', '2.26.7.6.1')).toBe(false); // equal → bundled wins
  });

  it('compares on the CalVer date, not the raw string (git-describe suffix ok)', () => {
    // A newer cache carrying a git-describe suffix still reads as fresh.
    expect(otaCacheIsFresh('2.26.7.13.1-4-gabc1234', '2.26.7.6.1')).toBe(true);
  });

  it('fails safe to bundled when either version is missing or non-CalVer', () => {
    expect(otaCacheIsFresh(null, '2.26.7.6.1')).toBe(false);
    expect(otaCacheIsFresh('bundled', '2.26.7.6.1')).toBe(false);
    expect(otaCacheIsFresh('2.26.7.13.1', '2.0.7')).toBe(false); // legacy pkg.json fallback
  });
});

describe('uiUpdateIsNewer', () => {
  it('only when strictly newer than the newest of bundled + current cache', () => {
    // Newer than both → yes.
    expect(uiUpdateIsNewer('2.26.7.20.1', '2.26.7.6.1', '2.26.7.13.1')).toBe(true);
    // Equal to the effective installed → no (the fresh-install re-download loop).
    expect(uiUpdateIsNewer('2.26.7.6.1', '2.26.7.6.1', null)).toBe(false);
    // Older than the current cache → no (blocks a regressed-manifest downgrade).
    expect(uiUpdateIsNewer('2.26.7.6.1', '2.26.7.6.1', '2.26.7.13.1')).toBe(false);
    // Newer than bundled but there's no cache yet → yes.
    expect(uiUpdateIsNewer('2.26.7.13.1', '2.26.7.6.1', null)).toBe(true);
  });

  it('unparseable manifest never announces; nothing-parseable-installed treats it as newer', () => {
    expect(uiUpdateIsNewer('bundled', '2.26.7.6.1', null)).toBe(false);
    expect(uiUpdateIsNewer('2.26.7.6.1', '2.0.7', null)).toBe(true); // legacy bundled fallback
  });
});

describe('uiServerCompatSkipReason', () => {
  it('allows only when no floor is declared (absence is the explicit opt-out)', () => {
    expect(uiServerCompatSkipReason({ serverVersion: '0.26.7.6.4.dev40+g82a1da968' })).toBeNull();
    expect(uiServerCompatSkipReason({ minServerVersion: '', serverVersion: '0.26.7.6.4' })).toBeNull();
    expect(uiServerCompatSkipReason({ minServerVersion: null, serverVersion: '0.26.7.6.4' })).toBeNull();
  });

  it('fails closed on a declared-but-uninterpretable floor', () => {
    // A non-CalVer floor we can't compare is not a licence to ship.
    expect(uiServerCompatSkipReason({ minServerVersion: '0.1.6', serverVersion: '0.26.7.6.4' }))
      .toBe('invalid min_server_version "0.1.6"');
  });

  it('fails closed when a floor is declared but the server version is unknown', () => {
    expect(uiServerCompatSkipReason({ minServerVersion: '2.26.7.6.1', serverVersion: null }))
      .toBe('server version unknown (need >= 2.26.7.6.1)');
    expect(uiServerCompatSkipReason({ minServerVersion: '2.26.7.6.1', serverVersion: 'bundled' }))
      .toBe('server version unknown (need >= 2.26.7.6.1)');
  });

  it('withholds when the running server is older than the floor (by CalVer)', () => {
    expect(uiServerCompatSkipReason({ minServerVersion: '0.26.7.6.4', serverVersion: '0.26.7.6.1' }))
      .toBe('server 0.26.7.6.1 < required 0.26.7.6.4');
    // Earlier date is older regardless of a higher seq.
    expect(uiServerCompatSkipReason({ minServerVersion: '0.26.7.6.1', serverVersion: '0.26.7.5.9' }))
      .toBe('server 0.26.7.5.9 < required 0.26.7.6.1');
  });

  it('allows when the server meets or exceeds the floor, tolerating a PEP 440 dev suffix', () => {
    expect(uiServerCompatSkipReason({ minServerVersion: '0.26.7.6.1', serverVersion: '0.26.7.6.1' })).toBeNull();
    expect(uiServerCompatSkipReason({ minServerVersion: '0.26.7.6.1', serverVersion: '0.26.7.13.1' })).toBeNull();
    expect(uiServerCompatSkipReason({ minServerVersion: '0.26.7.6.1', serverVersion: '0.26.7.6.4.dev40+g82a1da968' })).toBeNull();
  });
});

describe('compareVersions rc ordering (staging pre-release stream)', () => {
  it('an rc precedes its own base release', () => {
    expect(compareVersions('0.26.7.23.1rc2', '0.26.7.23.1')).toBeLessThan(0);
    expect(compareVersions('0.26.7.23.1', '0.26.7.23.1rc2')).toBeGreaterThan(0);
  });

  it('rc numbers order among themselves', () => {
    expect(compareVersions('0.26.7.23.1rc2', '0.26.7.23.1rc1')).toBeGreaterThan(0);
    expect(compareVersions('0.26.7.23.1rc2', '0.26.7.23.1rc2')).toBe(0);
  });

  it('an rc of a higher base beats a lower stable', () => {
    expect(compareVersions('0.26.7.23.2rc1', '0.26.7.23.1')).toBeGreaterThan(0);
  });

  it('plain versions keep their historical numeric ordering', () => {
    expect(compareVersions('0.26.7.23.2', '0.26.7.23.10')).toBeLessThan(0);
    expect(compareVersions('0.26.7.23', '0.26.7.23.0')).toBe(0);
  });

  it('rc segments deeper comparisons continue past an equal rc pair', () => {
    expect(compareVersions('0.1rc1.5', '0.1rc1.4')).toBeGreaterThan(0);
  });
});

describe('selectLatestPypiVersion', () => {
  const releases = {
    '0.26.7.20.1': [{ yanked: false }],
    '0.26.7.23.1rc1': [{ yanked: false }],
    '0.26.7.23.1rc2': [{ yanked: false }],
  };

  it('prod path trusts info.version and never scans pre-releases', () => {
    expect(selectLatestPypiVersion({ infoVersion: '0.26.7.20.1', releases, includePrereleases: false }))
      .toBe('0.26.7.20.1');
  });

  it('pre-release path picks the PEP 440 maximum across stable and rc', () => {
    expect(selectLatestPypiVersion({ infoVersion: '0.26.7.20.1', releases, includePrereleases: true }))
      .toBe('0.26.7.23.1rc2');
  });

  it('a newer stable beats older rcs on the pre-release path too', () => {
    const withNewStable = { ...releases, '0.26.7.24.1': [{ yanked: false }] };
    expect(selectLatestPypiVersion({ infoVersion: '0.26.7.24.1', releases: withNewStable, includePrereleases: true }))
      .toBe('0.26.7.24.1');
  });

  it('is order-independent (max survives older candidates listed after it)', () => {
    const descending = { '0.26.7.24.1': [{ yanked: false }], '0.26.7.23.1rc1': [{ yanked: false }] };
    expect(selectLatestPypiVersion({ infoVersion: null, releases: descending, includePrereleases: true }))
      .toBe('0.26.7.24.1');
  });

  it('skips fully-yanked, empty, and unparseable releases', () => {
    const messy = {
      '0.26.7.23.1rc1': [{ yanked: false }],
      '0.26.7.25.1': [{ yanked: true }],
      '0.26.7.26.1': [],
      '0.26.7.23.1rc3+local': [{ yanked: false }],
      '0.26.7.23.1.dev4': [{ yanked: false }],
    };
    expect(selectLatestPypiVersion({ infoVersion: null, releases: messy, includePrereleases: true }))
      .toBe('0.26.7.23.1rc1');
  });

  it('a partially-yanked release (one live file) still counts', () => {
    const partial = { '0.26.7.27.1': [{ yanked: true }, { yanked: false }] };
    expect(selectLatestPypiVersion({ infoVersion: null, releases: partial, includePrereleases: true }))
      .toBe('0.26.7.27.1');
  });

  it('tolerates malformed release entries (non-array files, null file objects)', () => {
    const malformed = {
      '0.26.7.28.1': null,
      '0.26.7.23.1rc1': [null, { yanked: false }],
    } as unknown as Record<string, Array<{ yanked?: boolean }>>;
    expect(selectLatestPypiVersion({ infoVersion: null, releases: malformed, includePrereleases: true }))
      .toBe('0.26.7.23.1rc1');
  });

  it('falls back to info.version when nothing scannable remains', () => {
    expect(selectLatestPypiVersion({ infoVersion: '0.26.7.20.1', releases: {}, includePrereleases: true }))
      .toBe('0.26.7.20.1');
    expect(selectLatestPypiVersion({ infoVersion: null, releases: null, includePrereleases: true }))
      .toBeNull();
    expect(selectLatestPypiVersion({ infoVersion: '', releases: undefined, includePrereleases: false }))
      .toBeNull();
  });
});

describe('parseAntonPin', () => {
  it('extracts an exact rc pin from Requires-Dist', () => {
    expect(parseAntonPin(['httpx>=0.27', 'anton-agent==2.26.7.23.1rc1', 'uvicorn>=0.47.0']))
      .toBe('2.26.7.23.1rc1');
  });

  it('tolerates spaces and environment markers', () => {
    expect(parseAntonPin(['anton-agent == 2.26.7.20.1 ; python_version >= "3.12"']))
      .toBe('2.26.7.20.1');
  });

  it('returns null for loose constraints (stable wheels need no restatement)', () => {
    expect(parseAntonPin(['anton-agent<3,>=2.26.6.30.1'])).toBeNull();
    expect(parseAntonPin(['anton-agent>=2.26.6.30.1,<3'])).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseAntonPin(null)).toBeNull();
    expect(parseAntonPin('anton-agent==1.0')).toBeNull();
    expect(parseAntonPin([42, null])).toBeNull();
    expect(parseAntonPin(['not-anton-agent==1.0'])).toBeNull();
  });
});

describe('installerStepPlan', () => {
  it('git channel on macOS needs the Xcode CLT step, shows git, and hard-requires it', () => {
    expect(installerStepPlan('darwin', 'git')).toEqual({ needsXcodeStep: true, showGitStep: true, gitRequired: true });
  });

  it('pypi channel on macOS skips Xcode AND omits the git step entirely (uv only)', () => {
    expect(installerStepPlan('darwin', 'pypi')).toEqual({ needsXcodeStep: false, showGitStep: false, gitRequired: false });
  });

  it('never plans an Xcode step off macOS, but git is shown + required on the git channel', () => {
    expect(installerStepPlan('win32', 'git')).toEqual({ needsXcodeStep: false, showGitStep: true, gitRequired: true });
    expect(installerStepPlan('linux', 'git')).toEqual({ needsXcodeStep: false, showGitStep: true, gitRequired: true });
  });

  it('pypi channel omits the git step on every platform (git is never shown or required)', () => {
    expect(installerStepPlan('win32', 'pypi')).toEqual({ needsXcodeStep: false, showGitStep: false, gitRequired: false });
    expect(installerStepPlan('linux', 'pypi')).toEqual({ needsXcodeStep: false, showGitStep: false, gitRequired: false });
  });
});

describe('decideStartWait', () => {
  const base = { healthy: false, spawnError: null, exited: false, elapsedMs: 0, capMs: 90_000 };

  it('keeps polling while the child is alive, silent, and inside the cap', () => {
    expect(decideStartWait({ ...base, elapsedMs: 40_000 })).toEqual({ action: 'poll' });
  });

  it('is ready as soon as /health answers, however long it took', () => {
    expect(decideStartWait({ ...base, healthy: true, elapsedMs: 89_000 })).toEqual({ action: 'ready' });
  });

  it('is ready when /health answers even though the process we spawned has exited', () => {
    // The Windows launcher hands off to a python child and can exit itself;
    // the server it started is up, so this is a success, not a death.
    expect(decideStartWait({ ...base, healthy: true, exited: true })).toEqual({ action: 'ready' });
  });

  it('fails immediately on a spawn error, without waiting out the cap', () => {
    expect(decideStartWait({ ...base, spawnError: 'spawn EPERM', elapsedMs: 10 }))
      .toEqual({ action: 'fail', kind: 'spawn-error' });
  });

  it('reports a spawn error ahead of the exit it also produced', () => {
    expect(decideStartWait({ ...base, spawnError: 'spawn ENOENT', exited: true }))
      .toEqual({ action: 'fail', kind: 'spawn-error' });
  });

  it('fails the moment an unhealthy child exits, long before the cap', () => {
    expect(decideStartWait({ ...base, exited: true, elapsedMs: 900 }))
      .toEqual({ action: 'fail', kind: 'exited' });
  });

  it('fails on the cap only while the child is still alive', () => {
    expect(decideStartWait({ ...base, elapsedMs: 90_000 })).toEqual({ action: 'fail', kind: 'timeout' });
    expect(decideStartWait({ ...base, elapsedMs: 90_001 })).toEqual({ action: 'fail', kind: 'timeout' });
  });
});

describe('startFailureMessage', () => {
  it('names the spawn error rather than blaming the health check', () => {
    expect(startFailureMessage({ kind: 'spawn-error', exitCode: null, spawnError: 'spawn EPERM', elapsedMs: 12 }))
      .toBe('The backend could not be launched: spawn EPERM.');
  });

  it('falls back to a generic reason when the spawn error is missing', () => {
    expect(startFailureMessage({ kind: 'spawn-error', exitCode: null, spawnError: null, elapsedMs: 12 }))
      .toBe('The backend could not be launched: unknown spawn error.');
  });

  it('reports the exit code and keeps a decimal on a fast death', () => {
    expect(startFailureMessage({ kind: 'exited', exitCode: 1, spawnError: null, elapsedMs: 3400 }))
      .toBe('The backend exited while starting up (code 1) after 3.4s.');
  });

  it('says so when the process died without an exit code', () => {
    expect(startFailureMessage({ kind: 'exited', exitCode: null, spawnError: null, elapsedMs: 15_000 }))
      .toBe('The backend exited while starting up (no exit code) after 15s.');
  });

  it('distinguishes "still starting" from "never started"', () => {
    expect(startFailureMessage({ kind: 'timeout', exitCode: null, spawnError: null, elapsedMs: 90_000 }))
      .toBe('The backend was still starting after 90s and never answered /health.');
  });
});

describe('parseUiManifest — shellVersion (ENG-849)', () => {
  const base = { version: '2.26.7.20.1', url: 'https://x/y.tar.gz', sha256: 'a'.repeat(64) };

  it('captures a valid shellVersion (camelCase)', () => {
    const m = parseUiManifest(JSON.stringify({ ...base, shellVersion: '2.26.7.20.1' }));
    expect(m?.shellVersion).toBe('2.26.7.20.1');
  });

  it('accepts snake_case and nested shell.version forms', () => {
    expect(parseUiManifest(JSON.stringify({ ...base, shell_version: '2.26.7.20.2' }))?.shellVersion).toBe('2.26.7.20.2');
    expect(parseUiManifest(JSON.stringify({ ...base, shell: { version: '2.26.7.20.3' } }))?.shellVersion).toBe('2.26.7.20.3');
  });

  it('leaves shellVersion absent when not published (no false reinstall notice)', () => {
    const m = parseUiManifest(JSON.stringify(base));
    expect(m).not.toBeNull();
    expect(m?.shellVersion).toBeUndefined();
  });

  it('ignores a malformed shellVersion rather than rejecting the manifest (OTA must survive)', () => {
    const m = parseUiManifest(JSON.stringify({ ...base, shellVersion: 123 }));
    expect(m).not.toBeNull();
    expect(m?.version).toBe('2.26.7.20.1');
    expect(m?.shellVersion).toBeUndefined();
  });
});

describe('shellUpdateIsNewer (ENG-849)', () => {
  it.each([
    ['newer', '2.26.7.20.1', '2.26.7.13.1', true],
    ['equal', '2.26.7.20.1', '2.26.7.20.1', false],
    ['older', '2.26.7.13.1', '2.26.7.20.1', false],
    ['newer date with a lower major', '0.26.7.21.1', '2.26.7.20.1', true],
    ['non-CalVer latest', '2.0.7', '2.26.7.20.1', false],
    ['non-CalVer installed', '2.26.7.20.1', '2.0.7', false],
    ['missing latest', null, '2.26.7.20.1', false],
    ['missing installed', '2.26.7.20.1', undefined, false],
  ])('%s', (_name, latest, installed, expected) => {
    expect(shellUpdateIsNewer(latest, installed)).toBe(expected);
  });
});

describe('shellDownloadUrl (ENG-849)', () => {
  const base = 'https://downloads.mindshub.ai/mindshub-cowork';
  it.each([
    ['darwin', 'prod', `${base}/mac/mindshub-cowork-latest.pkg`],
    ['win32', 'prod', `${base}/windows/mindshub-cowork-latest.exe`],
    ['darwin', 'stable', `${base}/mac/mindshub-cowork-staging.pkg`],
    ['win32', 'stable', `${base}/windows/mindshub-cowork-staging.exe`],
    ['darwin', 'preview', null],
    ['darwin', 'dev', null],
    ['darwin', null, null],
    ['linux', 'prod', null],
    ['', 'prod', null],
  ])('%s / %s', (platform, kind, expected) => {
    expect(shellDownloadUrl(platform, kind)).toBe(expected);
  });
});

describe('summarizeUpdateCheck (ENG-671 "Check for updates")', () => {
  const clean = { updateAvailable: false };
  const empty = {
    updateAvailable: false,
    uiUpdateAvailable: false,
    serverUpdateAvailable: false,
    shellUpdateAvailable: false,
  };

  it.each([
    ['all current', { ui: clean, server: clean }, { ok: true, offline: false, ...empty }],
    ['UI failure', { ui: { ...clean, error: true }, server: clean }, { ok: false, offline: false, ...empty }],
    ['server failure', { ui: clean, server: { ...clean, error: true } }, { ok: false, offline: false, ...empty }],
    ['both failures', { ui: { ...clean, error: true }, server: { ...clean, error: true } }, { ok: false, offline: true, ...empty }],
    [
      'UI update',
      { ui: { updateAvailable: true, newVersion: '1.26.7.20.3' }, server: clean },
      { ok: true, offline: false, updateAvailable: true, uiUpdateAvailable: true, serverUpdateAvailable: false, shellUpdateAvailable: false, uiVersion: '1.26.7.20.3' },
    ],
    [
      'server update',
      { ui: clean, server: { updateAvailable: true, latestVersion: '0.26.8.1.2' } },
      { ok: true, offline: false, updateAvailable: true, uiUpdateAvailable: false, serverUpdateAvailable: true, shellUpdateAvailable: false, serverVersion: '0.26.8.1.2' },
    ],
    [
      'both updates',
      { ui: { updateAvailable: true, newVersion: '1.26.7.20.3' }, server: { updateAvailable: true, latestVersion: '0.26.8.1.2' } },
      { ok: true, offline: false, updateAvailable: true, uiUpdateAvailable: true, serverUpdateAvailable: true, shellUpdateAvailable: false, uiVersion: '1.26.7.20.3', serverVersion: '0.26.8.1.2' },
    ],
    [
      'shell update',
      { ui: clean, server: clean, shell: { updateAvailable: true, version: '2.26.7.20.1', downloadUrl: 'https://x/y.pkg' } },
      { ok: true, offline: false, updateAvailable: true, uiUpdateAvailable: false, serverUpdateAvailable: false, shellUpdateAvailable: true, shellVersion: '2.26.7.20.1', shellDownloadUrl: 'https://x/y.pkg' },
    ],
    [
      'confirmed server update despite UI failure',
      { ui: { ...clean, error: true }, server: { updateAvailable: true, latestVersion: '0.26.8.1.2' } },
      { ok: true, offline: false, updateAvailable: true, uiUpdateAvailable: false, serverUpdateAvailable: true, shellUpdateAvailable: false, serverVersion: '0.26.8.1.2' },
    ],
    [
      'confirmed UI update despite server failure',
      { ui: { updateAvailable: true, newVersion: '1.26.7.20.3' }, server: { ...clean, error: true } },
      { ok: true, offline: false, updateAvailable: true, uiUpdateAvailable: true, serverUpdateAvailable: false, shellUpdateAvailable: false, uiVersion: '1.26.7.20.3' },
    ],
    [
      'confirmed aggregate update despite a partial error',
      { ui: clean, server: { updateAvailable: true, latestVersion: '0.26.8.1.2', error: true } },
      { ok: true, offline: false, updateAvailable: true, uiUpdateAvailable: false, serverUpdateAvailable: true, shellUpdateAvailable: false, serverVersion: '0.26.8.1.2' },
    ],
  ])('%s', (_name, input, expected) => {
    expect(summarizeUpdateCheck(input)).toEqual(expected);
  });

  it('omits absent versions and download URLs', () => {
    expect(summarizeUpdateCheck({
      ui: { updateAvailable: true },
      server: clean,
      shell: { updateAvailable: true, version: '2.26.7.20.1' },
    })).toEqual({
      ok: true,
      offline: false,
      updateAvailable: true,
      uiUpdateAvailable: true,
      serverUpdateAvailable: false,
      shellUpdateAvailable: true,
      shellVersion: '2.26.7.20.1',
    });
  });
});
