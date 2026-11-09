import { installerVersionFromFileName } from './write-download-manifest.mjs';

export const STEP_NAMES = Object.freeze({
  uv: 'Install uv',
  'cowork-server': 'Install cowork-server',
  verify: 'Verify installation',
  server: 'Start server',
});

/** @typedef {{id: string, label?: string, status: string}} SetupStep */
/** @typedef {{steps: SetupStep[], done: boolean, error: string, cancelled: boolean, returned: boolean|null, log: string}} SetupResult */

export function channels(value) {
  const selected = value.split(',').map((part) => part.trim());
  if (!selected.length || new Set(selected).size !== selected.length || selected.some((part) => !['prod', 'stable'].includes(part))) {
    throw new Error('Channels must be prod, stable, or prod,stable.');
  }
  return selected;
}

// The Windows setup smoke reads the same manifests and verdict, so the published
// installer's folder and extension are the only per-platform facts here.
const PACKAGES = Object.freeze({
  mac: { label: 'macOS package', extension: 'pkg' },
  windows: { label: 'Windows installer', extension: 'exe' },
});

/** Validate public download provenance before executing a package. */
export function packageIdentity(url, channel, platform = 'mac') {
  const { label, extension } = PACKAGES[platform];
  const parsed = new URL(url);
  const prefix = channel === 'stable' ? `/mindshub-cowork/${platform}/snapshots/` : `/mindshub-cowork/${platform}/`;
  if (!['prod', 'stable'].includes(channel) || parsed.origin !== 'https://downloads.mindshub.ai' || parsed.search || parsed.hash || parsed.username || parsed.password || !parsed.pathname.startsWith(prefix)) {
    throw new Error(`Expected this channel's public ${label} URL.`);
  }
  const file = parsed.pathname.slice(prefix.length);
  if (!new RegExp(`^mindshub-cowork-[a-zA-Z0-9.-]+\\.${extension}$`).test(file)) throw new Error(`Invalid ${label} filename.`);
  return installerVersionFromFileName(file, channel);
}

export function validateManifest(value, channel, expectedUrl = '', expectedVersion = '', platform = 'mac') {
  if (!value || typeof value !== 'object') throw new Error('Download manifest is not an object.');
  const version = packageIdentity(value.url, channel, platform);
  if (value.version !== version || value.key !== new URL(value.url).pathname.slice(1)
      || !Number.isSafeInteger(value.size_bytes) || value.size_bytes <= 0
      || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '')) {
    throw new Error('Download manifest has inconsistent identity, size, or checksum.');
  }
  if (expectedUrl && value.url !== expectedUrl) throw new Error('Manifest does not name the package this pipeline published.');
  if (expectedVersion && version !== expectedVersion.replace(/^v/, '')) throw new Error('Manifest does not name the tagged release.');
  return value;
}

/** Stable filenames strip git-describe's distance and append their channel/SHA. */
export function assertAppIdentity(info, manifestVersion, channel) {
  if (info.buildKind !== channel || info.source !== 'bundled' || info.ui !== null) {
    throw new Error('Expected the installed channel and its bundled renderer.');
  }
  if (channel === 'prod') {
    if (info.app !== manifestVersion) throw new Error('Installed app version differs from the published release.');
    return;
  }
  const identity = /^(.*)-stable-([a-f0-9]+)$/.exec(manifestVersion);
  if (identity && info.app === identity[1]) return; // A build exactly on a release tag has no git-describe suffix.
  const display = /^(.*)-[0-9]+-g([a-f0-9]+)$/.exec(info.app ?? '');
  if (!identity || !display || identity[1] !== display[1] || !display[2].startsWith(identity[2])) {
    throw new Error('Installed Stable app release/commit differs from the manifest.');
  }
}

/** @param {SetupResult} result */
export function failureStep(result) {
  const failed = result.steps.find((step) => ['error', 'warning', 'running'].includes(step.status));
  return failed ? STEP_NAMES[failed.id] ?? 'Setup' : 'Setup';
}

/** A completion event is insufficient: the installer also emits it after a startup warning. */
export function assertSetupPassed(result) {
  if (result.error || result.cancelled || !result.done || result.returned !== true) {
    throw new Error(`${failureStep(result)}: ${result.error || 'setup did not finish successfully'}`);
  }
  const expected = Object.keys(STEP_NAMES);
  if (result.steps.length !== expected.length || new Set(result.steps.map((step) => step.id)).size !== expected.length) {
    throw new Error('Setup: missing, duplicate, or unexpected steps.');
  }
  for (const id of expected) {
    const step = result.steps.find((entry) => entry.id === id);
    if (step?.status !== 'done') throw new Error(`${STEP_NAMES[id]}: ${step?.status ?? 'missing'}`);
  }
  if (!result.log.includes('uv not found. Installing...') || !result.log.includes('uv installed at ')) {
    throw new Error('Install uv: setup reused an existing uv instead of installing it.');
  }
}
