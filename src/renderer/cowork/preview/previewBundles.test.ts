import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPreviewBundle,
  checkHashes,
  checkScriptText,
  generatePreviewBundles,
  normalizeScriptText,
  scriptSha256,
  singleChunk,
  verifyGeneratedBundles,
} from '../../../../scripts/preview-bundles.mjs';
import { documentPreviewData } from '../../../../tests/helpers/documentPreviewData';

const data = documentPreviewData();
const GENERATED_DIR = path.join(__dirname, 'generated');

/* A renderer whose text holds `marker`, so a test can find it in its bundle. */
function rendererSource(type: string, line = "ctx.root.title = 'MARKER';"): string {
  return `export default { type: '${type}', async render(bytes, ctx) { ${line} return { type: '${type}', units: 1, truncated: false }; } };\n`;
}

let tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'preview-bundles-'));
  tempDirs.push(dir);
  return dir;
}

function writeRenderer(renderersDir: string, type: string, files: Record<string, string>): void {
  mkdirSync(path.join(renderersDir, type), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(renderersDir, type, name), text);
}

function readGenerated(outDir: string, name: string): string {
  return readFileSync(path.join(outDir, name), 'utf8');
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
  vi.unstubAllEnvs();
});

describe('script text checks', () => {
  it.each(data.forbiddenScriptText)('refuses $label', ({ label, text }) => {
    expect(() => checkScriptText('pdf', text)).toThrow(`the script holds ${label}`);
  });

  it.each(data.allowedScriptText)('keeps %s', (text) => {
    expect(() => checkScriptText('pdf', text)).not.toThrow();
  });

  it('normalizes \\r\\n and a lone \\r to \\n, the way the HTML parser does before hashing', () => {
    expect(normalizeScriptText('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });
});

describe('one chunk per type', () => {
  it('refuses two chunks', () => {
    const output = [{ type: 'chunk' as const, fileName: 'pdf.iife.js' }, { type: 'chunk' as const, fileName: 'pdf-2.js' }];
    expect(() => singleChunk('pdf', output)).toThrow('exactly one chunk');
  });

  it('refuses a chunk with an emitted asset beside it', () => {
    const output = [{ type: 'chunk' as const, fileName: 'pdf.iife.js' }, { type: 'asset' as const, fileName: 'x.wasm' }];
    expect(() => singleChunk('pdf', output)).toThrow('exactly one chunk');
  });

  it('returns the one chunk', () => {
    const chunk = { type: 'chunk' as const, fileName: 'pdf.iife.js' };
    expect(singleChunk('pdf', [chunk])).toBe(chunk);
  });
});

describe('hash checks', () => {
  it('fails on a missing hash', () => {
    expect(() => checkHashes([{ type: 'pdf', text: 'void 0;' }], {})).toThrow('missing or wrong hash');
  });

  it('fails on a hash of other text', () => {
    expect(() => checkHashes([{ type: 'pdf', text: 'void 0;' }], { pdf: scriptSha256('void 1;') })).toThrow('missing or wrong hash');
  });

  it('accepts the hash of the normalized text', () => {
    expect(() => checkHashes([{ type: 'pdf', text: 'a\r\nb' }], { pdf: scriptSha256('a\nb') })).not.toThrow();
  });
});

describe('frame bundle builds', () => {
  it('fails a renderer that leaves a process. reference in its bundle', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'render.ts'), rendererSource('pdf', 'ctx.root.title = String(process.versions);'));
    await expect(buildPreviewBundle({ type: 'pdf', renderPath: path.join(dir, 'render.ts') }))
      .rejects.toThrow('the script holds a leftover process.');
  });

  it('fails a renderer that leaves <script in its bundle', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'render.ts'), rendererSource('pdf', "ctx.root.title = '<script>';"));
    await expect(buildPreviewBundle({ type: 'pdf', renderPath: path.join(dir, 'render.ts') }))
      .rejects.toThrow('the script holds <script');
  });

  it('fails a build that emits a file beside its chunk', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'render.ts'), rendererSource('pdf'));
    const emitsAsset = {
      name: 'emits-asset',
      generateBundle(this: { emitFile(file: { type: 'asset'; fileName: string; source: string }): string }) {
        this.emitFile({ type: 'asset', fileName: 'extra.txt', source: 'x' });
      },
    };
    await expect(buildPreviewBundle({ type: 'pdf', renderPath: path.join(dir, 'render.ts'), plugins: [emitsAsset] }))
      .rejects.toThrow('exactly one chunk');
  });

  /* The harness's dev server and Vitest build the bundles they load in their
     own process, so a bundle that changed with NODE_ENV would ship bytes they
     never tested. JSZip in the runtime pulls in Node's stream module, whose
     Vite stand-in changes with it unless the generator resolves it. */
  it('builds the same script text under every NODE_ENV that runs the generator', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'render.ts'), rendererSource('pdf'));
    const texts = new Set<string>();
    for (const nodeEnv of data.bundleNodeEnvs) {
      vi.stubEnv('NODE_ENV', nodeEnv);
      texts.add((await buildPreviewBundle({ type: 'pdf', renderPath: path.join(dir, 'render.ts') })).text);
    }
    expect(texts.size).toBe(1);
  });
});

describe('generatePreviewBundles', () => {
  it('builds each renderer with only its own build config, wires assets.ts, and writes hashes and notices', async () => {
    const root = tempDir();
    const renderersDir = path.join(root, 'renderers');
    const outDir = path.join(root, 'generated');
    writeRenderer(renderersDir, 'pdf', {
      'render.ts': rendererSource('pdf'),
      /* Rewrites the marker and appends CR line endings after minification. */
      'build.config.mjs': `export default {
  plugins: [{
    name: 'rewrite-marker',
    transform: (code) => code.replace('MARKER', 'REWRITTEN'),
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) if (item.type === 'chunk') item.code += '\\r\\n/* end */\\r';
    },
  }],
  notices: ['pdfjs-dist/standard_fonts/LICENSE_FOXIT'],
};
`,
      'assets.ts': "export default async () => ({ names: [], load: async () => null });\n",
    });
    writeRenderer(renderersDir, 'docx', { 'render.ts': rendererSource('docx') });

    const { types } = await generatePreviewBundles({ renderersDir, outDir });

    expect(types).toEqual(['docx', 'pdf']);
    const pdf = readGenerated(outDir, 'pdf.iife.txt');
    const docx = readGenerated(outDir, 'docx.iife.txt');
    expect(pdf).toContain('REWRITTEN');
    expect(docx).toContain('MARKER');
    expect(docx).not.toContain('REWRITTEN');
    expect(pdf).not.toContain('\r');
    expect(pdf.endsWith('/* end */\n')).toBe(true);

    const hashes = JSON.parse(readGenerated(outDir, 'preview-hashes.gen.json'));
    expect(hashes).toEqual({ docx: scriptSha256(normalizeScriptText(docx)), pdf: scriptSha256(normalizeScriptText(pdf)) });

    const registry = readGenerated(outDir, 'registry.ts');
    expect(registry).toContain("loadAssets: () => import('../renderers/pdf/assets').then((module) => module.default()),");
    expect(registry.match(/loadAssets: null,/g)).toHaveLength(1);
    expect(registry).toContain("loadScript: () => import('./docx.iife.txt?raw')");

    const notices = readGenerated(outDir, 'third-party-notices.txt');
    for (const license of ['jszip/LICENSE.markdown', 'pako/LICENSE']) {
      const text = readFileSync(path.join(__dirname, '../../../../node_modules', license), 'utf8').trim();
      expect(notices).toContain(text);
    }
    expect(notices).toContain('node_modules/pdfjs-dist/standard_fonts/LICENSE_FOXIT');
  });

  it('removes the bundle of a renderer that is gone', async () => {
    const root = tempDir();
    const renderersDir = path.join(root, 'renderers');
    const outDir = path.join(root, 'generated');
    writeRenderer(renderersDir, 'pdf', { 'render.ts': rendererSource('pdf') });
    writeRenderer(renderersDir, 'docx', { 'render.ts': rendererSource('docx') });
    await generatePreviewBundles({ renderersDir, outDir });

    rmSync(path.join(renderersDir, 'docx'), { recursive: true });
    await generatePreviewBundles({ renderersDir, outDir });

    expect(readdirSync(outDir).sort()).toEqual(['pdf.iife.txt', 'preview-hashes.gen.json', 'registry.ts', 'third-party-notices.txt']);
  });

  it('writes an empty registry when there is no renderer', async () => {
    const root = tempDir();
    const outDir = path.join(root, 'generated');
    await generatePreviewBundles({ renderersDir: path.join(root, 'renderers'), outDir });

    expect(readGenerated(outDir, 'registry.ts')).toContain('export const previewBundles: readonly PreviewBundle[] = [];');
    expect(JSON.parse(readGenerated(outDir, 'preview-hashes.gen.json'))).toEqual({});
  });

  it('fails when a written bundle has no hash', async () => {
    const root = tempDir();
    const renderersDir = path.join(root, 'renderers');
    const outDir = path.join(root, 'generated');
    writeRenderer(renderersDir, 'pdf', { 'render.ts': rendererSource('pdf') });
    await generatePreviewBundles({ renderersDir, outDir });

    writeFileSync(path.join(outDir, 'preview-hashes.gen.json'), '{}\n');

    expect(() => verifyGeneratedBundles(outDir)).toThrow('preview bundle pdf: missing or wrong hash');
  });

  it.each([
    ['an unknown key', "export default { plugins: [], define: {} };\n", 'has an unknown key: define'],
    ['a notice that does not resolve', "export default { plugins: [], notices: ['no-such-package/LICENSE'] };\n", "names a notice that doesn't resolve"],
    ['no plugins array', 'export default { notices: [] };\n', 'must export a plugins array'],
  ])('fails a build.config.mjs with %s', async (_label, config, message) => {
    const root = tempDir();
    const renderersDir = path.join(root, 'renderers');
    writeRenderer(renderersDir, 'pdf', { 'render.ts': rendererSource('pdf'), 'build.config.mjs': config });
    await expect(generatePreviewBundles({ renderersDir, outDir: path.join(root, 'generated') })).rejects.toThrow(message);
  });
});

describe('the generated folder this run uses', () => {
  it('holds a hash for each bundle, equal to its sha256 after \\r\\n? normalization', () => {
    expect(existsSync(path.join(GENERATED_DIR, 'registry.ts'))).toBe(true);
    const hashes = JSON.parse(readFileSync(path.join(GENERATED_DIR, 'preview-hashes.gen.json'), 'utf8'));
    const bundles = readdirSync(GENERATED_DIR).filter((name) => name.endsWith('.iife.txt'));
    expect(Object.keys(hashes).sort()).toEqual(bundles.map((name) => name.replace('.iife.txt', '')).sort());
    for (const name of bundles) {
      const text = readFileSync(path.join(GENERATED_DIR, name), 'utf8');
      expect(hashes[name.replace('.iife.txt', '')]).toBe(scriptSha256(normalizeScriptText(text)));
    }
  });
});
