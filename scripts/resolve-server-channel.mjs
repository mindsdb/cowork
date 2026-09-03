// Install-channel resolution for the release workflows. The rule is
// getChannel() in src/main/server-source.ts; that is TypeScript under src/main,
// which a workflow step cannot import without a build, so this mirrors it and
// src/main/server-source.test.ts asserts the two agree on every input.
//
//   node scripts/resolve-server-channel.mjs   → prints git | pypi
//
// Reads COWORK_SERVER_CHANNEL, COWORK_SERVER_REF and COWORK_BUILD_KIND: an
// explicit channel wins, a server ref selects git, a packaged build kind
// selects pypi, and anything else is git.

const PYPI_BUILD_KINDS = new Set(['prod', 'preview', 'stable']);

export function resolveServerChannel({ channel = '', ref = '', buildKind = '' } = {}) {
  const raw = (
    channel
    || (ref.trim() ? 'git' : '')
    || (PYPI_BUILD_KINDS.has(buildKind.trim().toLowerCase()) ? 'pypi' : '')
    || 'git'
  ).toLowerCase();
  return raw === 'pypi' ? 'pypi' : 'git';
}

if (process.argv[1] && process.argv[1].endsWith('resolve-server-channel.mjs')) {
  process.stdout.write(resolveServerChannel({
    channel: process.env.COWORK_SERVER_CHANNEL,
    ref: process.env.COWORK_SERVER_REF,
    buildKind: process.env.COWORK_BUILD_KIND,
  }));
}
