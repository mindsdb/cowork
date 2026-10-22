/*
 * The Word build settings: no plugin, and one notice that carries the Zlib
 * license of the pako code docx-preview's jszip bundles.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { RendererBuildConfig } from '../../hooks';

const REPO_ROOT = join(__dirname, '../../../../../..');

/* A computed specifier, so the import reaches the .mjs file as it is. */
async function buildConfig(): Promise<RendererBuildConfig> {
  const module: { default: RendererBuildConfig } = await import(pathToFileURL(join(__dirname, 'build.config.mjs')).href);
  return module.default;
}

describe('the docx build config', () => {
  it('adds no plugin', async () => {
    const config = await buildConfig();
    expect(Object.keys(config).sort()).toEqual(['notices', 'plugins']);
    expect(config.plugins).toEqual([]);
  });

  it('names a notice that resolves from the repository root and carries the Zlib license text and no code', async () => {
    const config = await buildConfig();
    const require = createRequire(join(REPO_ROOT, 'package.json'));
    expect(config.notices).toHaveLength(1);
    const text = readFileSync(require.resolve(config.notices![0]), 'utf8');
    expect(text).toContain("This software is provided 'as-is', without any express or implied");
    expect(text).toContain('3. This notice may not be removed or altered from any source distribution.');
    expect(text).not.toContain('module.exports');
  });
});
