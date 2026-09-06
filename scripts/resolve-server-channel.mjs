// Mirror getChannel() from src/main/server-source.ts for workflows that run before compilation.
// server-source.test.ts checks parity. CLI prints git or pypi.

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
