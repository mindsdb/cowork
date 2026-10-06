// The four-component version readout, shared by the Updates settings panel and
// the diagnostics a user copies off a failed turn. One assembly on purpose:
// the two have to agree, and a second hand-rolled copy drifts the moment
// either side changes.

// Naming the ring makes an rc Server version self-explanatory in bug reports:
// staging-ring builds (preview/stable) follow the pre-release server stream.
export const BUILD_KIND_LABELS = {
  dev: 'dev (local source)',
  preview: 'preview (staging update ring)',
  stable: 'stable (staging update ring)',
  prod: 'prod',
};

const DASH = '—';

/**
 * Build the version table as ordered [label, value] pairs.
 *
 * @param {object} args
 * @param {{app?: string, ui?: string|null, source?: string, buildKind?: string|null}} args.versionInfo
 *   The main-process snapshot from getVersionInfo().
 * @param {string} args.bakedVersion  The renderer's own compiled-in version.
 * @param {string} args.serverVersion From /health.
 * @param {string} args.antonVersion  From /health.
 * @returns {[string, string][]} Rows in display order. `Build` appears only
 *   when the build kind is known; every other row falls back to an em dash so
 *   the shape stays fixed.
 */
export function versionRows({ versionInfo, bakedVersion, serverVersion, antonVersion }) {
  const info = versionInfo || {};
  const baked = bakedVersion || '';
  // App shell = installed Electron shell (changes only on reinstall).
  const shellVer = info.app || baked;
  // The running renderer's own baked version is authoritative for the UI
  // version — it's compiled into whichever bundle actually loaded (OTA or
  // bundled). Main-process cache metadata (`info.ui`) can lag the loaded
  // renderer (OTA off, missing cache, post-rollback), so it only informs the
  // source label, never the version.
  const uiVer = baked || info.ui || '';
  const uiSource = info.source === 'ota' ? 'OTA'
    : info.source === 'web' ? 'web' : 'bundled';
  const buildLabel = BUILD_KIND_LABELS[info.buildKind];

  return [
    ['App shell', shellVer || DASH],
    ...(buildLabel ? [['Build', buildLabel]] : []),
    ['UI', uiVer ? `${uiVer} (${uiSource})` : DASH],
    ['Server', serverVersion || DASH],
    ['Agent', antonVersion || DASH],
  ];
}
