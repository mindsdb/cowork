// Darwin kernel version of the oldest macOS the shell runs on (macOS 13).
// electron-updater compares `minimumSystemVersion` with os.release(), which on
// macOS is the Darwin version, and allows the update if the value is not semver.
export const MAC_MINIMUM_DARWIN_VERSION = '22.0.0';

// JSON-quoted strings are valid YAML scalars and prevent filenames from
// changing the metadata structure.
export function updateMetadataYaml({ platform, name, sha512, size, version, releaseDate }) {
  const lines = [
    `version: ${JSON.stringify(version)}`,
    'files:',
    `  - url: ${JSON.stringify(name)}`,
    `    sha512: ${JSON.stringify(sha512)}`,
    `    size: ${size}`,
    `path: ${JSON.stringify(name)}`,
    `sha512: ${JSON.stringify(sha512)}`,
    `releaseDate: ${JSON.stringify(releaseDate)}`,
  ];
  if (platform === 'mac') {
    lines.push(`minimumSystemVersion: ${JSON.stringify(MAC_MINIMUM_DARWIN_VERSION)}`);
  }
  return [...lines, ''].join('\n');
}
