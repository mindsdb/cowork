/*
 * Builds the xlsx renderer into one IIFE with its build.config.mjs plugins, the
 * way the preview bundle generator builds each type, and checks the bundle
 * against the `bundle` list in code-checks.yaml. It builds twice, minified and
 * not, so neither a comment nor a minifier's rewrite hides a banned name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { load } from 'js-yaml';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

import type { RendererBuildConfig } from '../../hooks';

interface CodeCheck { name: string; pattern: string; flags?: string }

interface CodeChecks { bundle: CodeCheck[]; source: CodeCheck[] }

interface Bundle { chunks: string[]; assets: string[] }

interface TransformPlugin { transform(code: string, id: string): { code: string } | null }

const REPO_ROOT = join(__dirname, '../../../../../..');
const CHECKS = (load(readFileSync(join(__dirname, 'code-checks.yaml'), 'utf8')) as CodeChecks).bundle;

/* A computed specifier, because tsc never checks build.config.mjs. */
async function buildConfig(): Promise<RendererBuildConfig> {
  const module: { default: RendererBuildConfig } = await import(pathToFileURL(join(__dirname, 'build.config.mjs')).href);
  return module.default;
}

async function bundle(minify: boolean): Promise<Bundle> {
  const result = await build({
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    root: REPO_ROOT,
    plugins: (await buildConfig()).plugins,
    build: {
      write: false,
      minify,
      lib: { entry: join(__dirname, 'render.ts'), formats: ['iife'], name: 'xlsxPreview' },
    },
  });
  const files = (Array.isArray(result) ? result : [result]).flatMap((output) => ('output' in output ? output.output : []));
  return {
    chunks: files.flatMap((file) => (file.type === 'chunk' ? [file.code] : [])),
    assets: files.flatMap((file) => (file.type === 'asset' ? [file.fileName] : [])),
  };
}

describe.each([true, false])('the xlsx preview bundle (minify: %s)', (minify) => {
  let output: Bundle;

  beforeAll(async () => {
    output = await bundle(minify);
  });

  it('is one chunk with no other file', () => {
    expect(output.chunks).toHaveLength(1);
    expect(output.assets).toEqual([]);
  });

  it('carries the vendored SheetJS 0.20.3 inside it', () => {
    expect(output.chunks[0]).toMatch(/version\s*=\s*['"`]0\.20\.3['"`]/);
  });

  it.each(CHECKS)('holds no $name', ({ pattern, flags }) => {
    expect(output.chunks[0]).not.toMatch(new RegExp(pattern, flags));
  });
});

describe('build.config.mjs', () => {
  async function dropNodeCheck(): Promise<TransformPlugin> {
    const { plugins } = await buildConfig();
    expect(plugins).toHaveLength(1);
    return plugins[0] as unknown as TransformPlugin;
  }

  it('sets only the plugins the generator accepts', async () => {
    expect(Object.keys(await buildConfig())).toEqual(['plugins']);
  });

  it("replaces SheetJS's Node check with false", async () => {
    const plugin = await dropNodeCheck();
    const id = join(REPO_ROOT, 'node_modules/xlsx/xlsx.mjs');
    const out = plugin.transform(readFileSync(id, 'utf8'), id);
    expect(out?.code).not.toMatch(/\bprocess\./);
    expect(out?.code).toMatch(/var has_buf = \/\*#__PURE__\*\/\(function\(\) \{ return false; \}\)\(\);/);
  });

  it('fails the build when SheetJS no longer holds its Node check once', async () => {
    const plugin = await dropNodeCheck();
    expect(() => plugin.transform('var has_buf = false;', '/repo/node_modules/xlsx/xlsx.mjs')).toThrow(/found it 0 times/);
  });

  it('leaves every other module alone', async () => {
    const plugin = await dropNodeCheck();
    expect(plugin.transform('process.versions', '/repo/src/other.ts')).toBeNull();
  });
});
