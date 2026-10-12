import { describe, it, expect } from 'vitest';
import {
  assessShellSupport,
  deriveShellTooOldNotice,
  MIN_SUPPORTED_SHELL,
  SUPPORTED_SHELL_WINDOW_DAYS,
} from './shell-support';

// Prod shell versions are clean CalVer tags (MAJOR.YY.M.D.SEQ). The newest
// published shell on 4 October 2026 was 2.26.10.4.1; the proposed floor is
// 2.26.9.21.1 (ENG-1047).
const LATEST = '2.26.10.4.1';
const prod = (shellVersion: string, latestShellVersion: string = LATEST) =>
  assessShellSupport({ shellVersion, latestShellVersion, source: 'ota', buildKind: 'prod' });

describe('assessShellSupport — the window', () => {
  it('pins the proposal: floor 2.26.9.21.1 and a 14-day window', () => {
    expect(MIN_SUPPORTED_SHELL).toBe('2.26.9.21.1');
    expect(SUPPORTED_SHELL_WINDOW_DAYS).toBe(14);
  });

  it('supports the newest published shell however much newer the UI is', () => {
    // The UI version never enters the rule, so a UI dated weeks ahead cannot
    // make the newest shell too old.
    expect(prod(LATEST)).toMatchObject({ status: 'supported', daysBehind: 0 });
  });

  it('supports a shell newer than the manifest (a manifest that lags a release)', () => {
    expect(prod('2.26.10.6.1')).toMatchObject({ status: 'supported', daysBehind: 0 });
  });

  it('supports the floor shell when it is inside the window', () => {
    // 21 Sep → 4 Oct is 13 days.
    expect(prod(MIN_SUPPORTED_SHELL)).toMatchObject({
      status: 'supported', shellVersion: MIN_SUPPORTED_SHELL, latestShellVersion: LATEST, daysBehind: 13,
    });
  });

  it('refuses the newest shell below the floor even inside the window', () => {
    // 2.26.9.17.1 is 17 days behind 4 Oct, but the floor is the decider: a
    // shell this old still shows one account's data to anyone who signs in.
    expect(prod('2.26.9.17.1', '2.26.9.28.1')).toMatchObject({
      status: 'too-old', reason: 'below-floor', daysBehind: 11,
    });
  });

  it('refuses a shell above the floor that is 15 days behind, and keeps one 14 days behind', () => {
    expect(prod('2.26.9.21.1', '2.26.10.5.1')).toMatchObject({ status: 'supported', daysBehind: 14 });
    expect(prod('2.26.9.21.1', '2.26.10.6.1')).toMatchObject({
      status: 'too-old', reason: 'outside-window', daysBehind: 15,
    });
  });

  it("refuses the 6 October shell on both counts (Lucas's 2.26.9.1.3)", () => {
    expect(prod('2.26.9.1.3')).toMatchObject({ status: 'too-old', reason: 'below-floor', daysBehind: 33 });
  });

  it('refuses the oldest shell that loads OTA bundles', () => {
    expect(prod('2.26.7.20.1')).toMatchObject({ status: 'too-old', reason: 'below-floor' });
  });
});

describe('assessShellSupport — when the rule does not apply', () => {
  it('never applies on web', () => {
    expect(assessShellSupport({ shellVersion: '', latestShellVersion: LATEST, source: 'web', buildKind: null }))
      .toEqual({ status: 'not-applicable', reason: 'web' });
  });

  it('never applies on stable or preview builds that report their kind', () => {
    for (const buildKind of ['stable', 'preview', 'dev'] as const) {
      expect(assessShellSupport({ shellVersion: '2.26.8.1.1', latestShellVersion: LATEST, source: 'bundled', buildKind }))
        .toEqual({ status: 'not-applicable', reason: 'non-prod' });
    }
  });

  it('treats an untagged (git-describe) shell as non-prod even without a build kind', () => {
    // Legacy shells omit buildKind; stable/preview builds carry a commit
    // distance in their version, which a shipped prod shell never does.
    expect(assessShellSupport({
      shellVersion: '2.26.8.1.1-597-g0f28d663', latestShellVersion: LATEST, source: 'bundled', buildKind: null,
    })).toEqual({ status: 'not-applicable', reason: 'untagged-shell' });
  });

  it('fails closed when the shell version does not parse', () => {
    for (const shellVersion of ['2.0.7', '', undefined, null]) {
      expect(assessShellSupport({ shellVersion, latestShellVersion: LATEST, source: 'bundled', buildKind: 'prod' }))
        .toEqual({ status: 'not-applicable', reason: 'unparseable-shell' });
    }
  });

  it('fails closed when the manifest has no usable shellVersion', () => {
    for (const latestShellVersion of ['', undefined, null, 'latest', '2.26.10.4.1-3-gabcdef0']) {
      expect(assessShellSupport({ shellVersion: '2.26.9.1.3', latestShellVersion, source: 'ota', buildKind: 'prod' }))
        .toEqual({ status: 'not-applicable', reason: 'unparseable-latest' });
    }
  });
});

describe('deriveShellTooOldNotice', () => {
  const tooOld = prod('2.26.9.1.3');

  it('returns nothing unless the shell is too old', () => {
    expect(deriveShellTooOldNotice(prod(LATEST), { phase: 'ready-to-install' })).toBeNull();
    expect(deriveShellTooOldNotice(null, null)).toBeNull();
    expect(deriveShellTooOldNotice({ status: 'not-applicable', reason: 'web' }, null)).toBeNull();
  });

  it('names the installed and current shell versions', () => {
    const notice = deriveShellTooOldNotice(tooOld, null)!;
    expect(notice.title).toMatch(/too old/);
    expect(notice.body).toContain('2.26.9.1.3');
    expect(notice.body).toContain(LATEST);
  });

  it('offers the installer page when the shell cannot update itself', () => {
    // No snapshot (a shell older than the auto-updater), disabled (Linux, kill
    // switch), idle, or complete.
    for (const shellAuto of [null, { phase: 'disabled' }, { phase: 'idle' }, { phase: 'complete' }]) {
      expect(deriveShellTooOldNotice(tooOld, shellAuto)).toMatchObject({
        action: 'open-download-page', actionLabel: 'Download the latest app',
      });
    }
  });

  it('routes through the auto-updater when it has an update', () => {
    expect(deriveShellTooOldNotice(tooOld, { phase: 'available' }))
      .toMatchObject({ action: 'download', actionLabel: 'Download update' });
    expect(deriveShellTooOldNotice(tooOld, { phase: 'ready-to-install' }))
      .toMatchObject({ action: 'install', actionLabel: 'Restart to update' });
  });

  it('is display-only while the updater is busy', () => {
    expect(deriveShellTooOldNotice(tooOld, { phase: 'checking' })).toMatchObject({ action: null });
    expect(deriveShellTooOldNotice(tooOld, { phase: 'downloading', progress: { percent: 41.6 } }))
      .toMatchObject({ action: null, actionLabel: 'Downloading (42%)' });
    expect(deriveShellTooOldNotice(tooOld, { phase: 'downloading' }))
      .toMatchObject({ action: null, actionLabel: 'Downloading…' });
    expect(deriveShellTooOldNotice(tooOld, { phase: 'installing' })).toMatchObject({ action: null });
  });

  it('retries a recoverable failure and falls back to the installer on a terminal one', () => {
    expect(deriveShellTooOldNotice(tooOld, { phase: 'failed', recoverable: true }))
      .toMatchObject({ action: 'retry' });
    expect(deriveShellTooOldNotice(tooOld, { phase: 'failed', recoverable: false }))
      .toMatchObject({ action: 'open-download-page' });
  });
});
