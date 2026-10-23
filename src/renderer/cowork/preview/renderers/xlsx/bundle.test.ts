/*
 * Builds the xlsx renderer into one IIFE with Vite's library build and its
 * build.config.mjs plugins, and checks the bundle against the `bundle` list in
 * code-checks.yaml. It builds twice, minified and not, so neither a comment nor
 * a minifier's rewrite hides a banned name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { load } from 'js-yaml';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

import type { RendererBuildConfig } from '../../hooks';

interface CodeCheck { name: string; pattern: string; flags?: string; matches?: string[]; skips?: string[] }

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

describe('the bundle checks in code-checks.yaml', () => {
  it.each(CHECKS.filter(({ matches, skips }) => matches || skips))('$name matches its examples and skips its non-examples', ({ pattern, flags, matches, skips }) => {
    const check = new RegExp(pattern, flags);
    expect((matches ?? []).filter((text) => !check.test(text))).toEqual([]);
    expect((skips ?? []).filter((text) => check.test(text))).toEqual([]);
  });
});

describe('build.config.mjs', () => {
  const SHEETJS = join(REPO_ROOT, 'node_modules/xlsx/xlsx.mjs');
  /* The two lines the format and error-text edits change, as SheetJS 0.20.3
     writes them. */
  const CELL_FORMAT = 'if(opts.cellNF) p.z = table_fmt[fmtid];';
  const ERROR_TEXT = 'if(!opts || opts.cellText !== false) p.w = p.v;';

  async function editSheetjs(): Promise<TransformPlugin> {
    const { plugins } = await buildConfig();
    expect(plugins).toHaveLength(1);
    return plugins[0] as unknown as TransformPlugin;
  }

  it('sets only the plugins the generator accepts', async () => {
    expect(Object.keys(await buildConfig())).toEqual(['plugins']);
  });

  it("replaces SheetJS's Node check with false", async () => {
    const plugin = await editSheetjs();
    const out = plugin.transform(readFileSync(SHEETJS, 'utf8'), SHEETJS);
    expect(out?.code).not.toMatch(/\bprocess\./);
    expect(out?.code).toMatch(/var has_buf = \/\*#__PURE__\*\/\(function\(\) \{ return false; \}\)\(\);/);
  });

  /* render.test.ts checks what the two edits make SheetJS do. */
  it('loads a built-in format before SheetJS keeps a cell\'s format, and keeps an error cell\'s text, with cell text off', async () => {
    const plugin = await editSheetjs();
    const out = plugin.transform(readFileSync(SHEETJS, 'utf8'), SHEETJS)?.code ?? '';
    expect(out.split(`if(table_fmt[fmtid] == null) SSF__load(SSFImplicit[fmtid] || "General", fmtid); ${CELL_FORMAT}`)).toHaveLength(2);
    expect(out).not.toContain(ERROR_TEXT);
    expect(out).toMatch(/case 'e':\s+p\.w = p\.v;\s+p\.v = RBErr\[p\.v\]; break;/);
  });

  it.each([
    { label: 'its Node check', remove: "!!process.versions.node", message: /Node check .* found it 0 times/ },
    { label: 'the line that keeps a cell\'s format', remove: CELL_FORMAT, message: /number format for a cell .* found it 0 times/ },
    { label: 'the line that keeps an error cell\'s text', remove: ERROR_TEXT, message: /text for an error cell .* found it 0 times/ },
  ])('fails the build when SheetJS no longer holds $label once', async ({ remove, message }) => {
    const plugin = await editSheetjs();
    const code = readFileSync(SHEETJS, 'utf8').replace(remove, '');
    expect(() => plugin.transform(code, SHEETJS)).toThrow(message);
  });

  it('leaves every other module alone', async () => {
    const plugin = await editSheetjs();
    expect(plugin.transform('process.versions', '/repo/src/other.ts')).toBeNull();
  });
});
