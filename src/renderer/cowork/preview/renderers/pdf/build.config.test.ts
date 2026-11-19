/*
 * The PDF build settings. The transform rewrites pdfjs-dist's own files so no
 * module loader syntax is left and the JPEG and JPEG 2000 decoders check the
 * image cap, and fails when a target matches no time or twice. A Vite
 * library build of render.ts with these plugins gives one IIFE chunk that
 * holds nothing build.config.test.yaml lists. The notices name the license
 * files that ship with the no-wasm decoders, the CMaps and the standard
 * fonts, and the license of the core-js release pdfjs-dist inlines.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { load } from 'js-yaml';
import type { Plugin } from 'vite';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

import type { RendererBuildConfig } from '../../hooks';
import { IMAGE_CAP_GLOBAL } from './render';

interface BundleCheck { name: string; pattern: string; flags?: string }

/* build.config.mjs's exports. tsc never checks the .mjs file itself. */
interface PdfBuildConfigModule {
  default: RendererBuildConfig;
  rewritePdfjsSource(code: string, file: string): string;
  pdfjsNoWasmPlugin(): Plugin;
}

const REPO_ROOT = join(__dirname, '../../../../../..');
/* The core-js release whose license LICENSE_CORE_JS holds. */
const CORE_JS_LICENSE_URL = 'https://github.com/zloirock/core-js/blob/v3.50.0/LICENSE';
const CORE_JS_NOTICE = './src/renderer/cowork/preview/renderers/pdf/LICENSE_CORE_JS';
const PDFJS = join(REPO_ROOT, 'node_modules/pdfjs-dist');
const WORKER_FILE = 'legacy/build/pdf.worker.mjs';
const MAIN_FILE = 'legacy/build/pdf.mjs';
const BUNDLE_CHECKS = (load(readFileSync(join(__dirname, 'build.config.test.yaml'), 'utf8')) as { bundle: BundleCheck[] }).bundle;
const LOADER_CHECKS = BUNDLE_CHECKS.filter(({ name }) => name.startsWith('import'));

/* A computed specifier, so the import reaches the .mjs file as it is. */
async function buildConfig(): Promise<PdfBuildConfigModule> {
  return import(pathToFileURL(join(__dirname, 'build.config.mjs')).href);
}

function pdfjsSource(file: string): string {
  return readFileSync(join(PDFJS, file), 'utf8');
}

function matches(text: string, checks: BundleCheck[]): string[] {
  return checks.filter(({ pattern, flags }) => new RegExp(pattern, flags).test(text)).map(({ name }) => name);
}

describe('the pdf build config', () => {
  it('default-exports only plugins and notices', async () => {
    const { default: config } = await buildConfig();
    expect(Object.keys(config).sort()).toEqual(['notices', 'plugins']);
  });

  it('names every wasm license, both standard-font licenses, the CMap license and core-js\'s, each resolvable from the repository root', async () => {
    const { default: config } = await buildConfig();
    const require = createRequire(join(REPO_ROOT, 'package.json'));
    const wasmLicenses = readdirSync(join(PDFJS, 'wasm')).filter((name) => name.startsWith('LICENSE_')).map((name) => `pdfjs-dist/wasm/${name}`);
    expect([...(config.notices ?? [])].sort()).toEqual([
      ...wasmLicenses,
      'pdfjs-dist/cmaps/LICENSE',
      'pdfjs-dist/standard_fonts/LICENSE_FOXIT',
      'pdfjs-dist/standard_fonts/LICENSE_LIBERATION',
      CORE_JS_NOTICE,
    ].sort());
    for (const notice of config.notices ?? []) expect(() => require.resolve(notice)).not.toThrow();
  });

  it('carries the MIT license of the core-js release that pdf.mjs and pdf.worker.mjs inline', () => {
    for (const file of [MAIN_FILE, WORKER_FILE]) {
      expect(pdfjsSource(file).match(/https:\/\/github\.com\/zloirock\/core-js\/blob\/v[\d.]+\/LICENSE/g)).toEqual([CORE_JS_LICENSE_URL]);
    }
    const license = readFileSync(createRequire(join(REPO_ROOT, 'package.json')).resolve(CORE_JS_NOTICE), 'utf8');
    expect(license).toContain('Denis Pushkarev (zloirock.ru)');
    expect(license).toContain('CoreJS Company (core-js.io)');
    expect(license).toContain('The above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.');
  });

  it.each([WORKER_FILE, MAIN_FILE])('rewrites %s with no module loader syntax left', async (file) => {
    const { rewritePdfjsSource } = await buildConfig();
    expect(matches(pdfjsSource(file), LOADER_CHECKS)).not.toEqual([]);
    expect(matches(rewritePdfjsSource(pdfjsSource(file), file), LOADER_CHECKS)).toEqual([]);
  });

  it('bundles the no-wasm decoders into the worker statically', async () => {
    const { rewritePdfjsSource } = await buildConfig();
    const worker = rewritePdfjsSource(pdfjsSource(WORKER_FILE), WORKER_FILE);
    expect(worker).toContain('from "../../wasm/jbig2_nowasm_fallback.js"');
    expect(worker).toContain('from "../../wasm/openjpeg_nowasm_fallback.js"');
  });

  it('guards the JPEG and JPEG 2000 decoders with the cap render.ts sets, before each allocates', async () => {
    const { rewritePdfjsSource } = await buildConfig();
    const source = pdfjsSource(WORKER_FILE);
    const worker = rewritePdfjsSource(source, WORKER_FILE);
    expect(source).not.toContain(IMAGE_CAP_GLOBAL);
    expect(worker).toContain([
      `if (frame.components.length > 4 || frame.samplesPerLine * frame.scanLines > (globalThis.${IMAGE_CAP_GLOBAL} ?? Infinity)) {`,
      '  throw new JpegError("The JPEG frame is past the preview\'s image cap or has more than 4 components.");',
      '}',
      'prepareComponents(frame);',
    ].join('\n'));
    expect(worker).toContain([
      '} = JpxImage.parseImageProperties(image.stream));',
      `if (image.width * image.height > (globalThis.${IMAGE_CAP_GLOBAL} ?? Infinity)) {`,
      '  throw new JpxError("The JPEG 2000 image is larger than the preview\'s image cap.");',
      '}',
    ].join('\n'));
  });

  it('fails when the JPEG or JPEG 2000 decoder\'s allocation point moved', async () => {
    const { rewritePdfjsSource } = await buildConfig();
    const source = pdfjsSource(WORKER_FILE);
    const jpegMoved = source.replace('prepareComponents(frame);', 'prepareComponents(frame)\n;');
    const jpxMoved = source.replace('} = JpxImage.parseImageProperties(image.stream));', '} = JpxImage.parseImageProperties(image.stream))\n;');
    expect(() => rewritePdfjsSource(jpegMoved, WORKER_FILE)).toThrow(/prepareComponents\(frame\);, found 0/);
    expect(() => rewritePdfjsSource(jpxMoved, WORKER_FILE)).toThrow(/parseImageProperties\(image\.stream\)\);, found 0/);
  });

  it('fails when a target matches no time', async () => {
    const { rewritePdfjsSource } = await buildConfig();
    expect(() => rewritePdfjsSource(pdfjsSource(MAIN_FILE), WORKER_FILE)).toThrow(/found 0/);
  });

  it('fails when a target matches twice', async () => {
    const { rewritePdfjsSource } = await buildConfig();
    const twice = pdfjsSource(WORKER_FILE).repeat(2);
    expect(() => rewritePdfjsSource(twice, WORKER_FILE)).toThrow(/found 2/);
  });

  it('fails the build when pdf.worker.mjs or pdf.mjs never reaches the transform', async () => {
    const { pdfjsNoWasmPlugin } = await buildConfig();
    const plugin = pdfjsNoWasmPlugin() as Plugin & { buildStart(): void; buildEnd(error?: Error): void };
    const errors: string[] = [];
    plugin.buildStart();
    plugin.buildEnd.call({ error: (message: string) => errors.push(message) } as never);
    expect(errors).toEqual([
      `pdfjs-dist ${WORKER_FILE} never reached the no-wasm transform.`,
      `pdfjs-dist ${MAIN_FILE} never reached the no-wasm transform.`,
    ]);
  });

  it('builds render.ts into one IIFE chunk that holds nothing the frame refuses', async () => {
    const { default: config } = await buildConfig();
    const result = await build({
      configFile: false,
      envDir: false,
      logLevel: 'silent',
      root: REPO_ROOT,
      publicDir: false,
      plugins: config.plugins,
      build: {
        write: false,
        minify: true,
        lib: { entry: join(__dirname, 'render.ts'), formats: ['iife'], name: 'pdfPreview' },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) => ('output' in output ? output.output : []));
    expect(outputs.map((output) => output.type)).toEqual(['chunk']);
    const [chunk] = outputs;
    const code = chunk.type === 'chunk' ? chunk.code : '';
    expect(matches(code, BUNDLE_CHECKS)).toEqual([]);
    expect(code).toContain('jbig2_nowasm_fallback.js');
  }, 60_000);
});
