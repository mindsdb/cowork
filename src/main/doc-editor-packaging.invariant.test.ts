// The shared-doc editor ships unpacked beside the asar (the sidecar reads it from
// resources/doc-editor). A second top-level `extraResources:` once broke every
// pack with "duplicated mapping key", so pin both facts here.
// Hand-parsed like the other electron-builder invariants: js-yaml is only a
// transitive dependency.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const yml = readFileSync(fileURLToPath(new URL('../../electron-builder.yml', import.meta.url)), 'utf8');

function topLevelBlock(key: string): string {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\S/.test(l));
  return rest.slice(0, end < 0 ? undefined : end).join('\n');
}

describe('doc editor packaging', () => {
  it('declares top-level extraResources once', () => {
    expect(yml.split('\n').filter((l) => l === 'extraResources:')).toHaveLength(1);
  });

  it('ships dist/doc-editor unpacked as resources/doc-editor', () => {
    expect(topLevelBlock('extraResources')).toMatch(/- from: dist\/doc-editor\n\s+to: doc-editor/);
  });

  it('builds the editor as part of the normal build', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
    expect(pkg.scripts.build).toContain('build:doc-editor');
  });
});
