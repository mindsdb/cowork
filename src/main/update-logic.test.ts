import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  meetsMinVersion,
  parseInstalledVersion,
  isFullCommitSha,
  parseLsRemote,
  parseVcsInfo,
  decideGitUpdate,
  decidePypiUpdate,
  parseUiManifest,
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
});
