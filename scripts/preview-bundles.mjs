/*
 * Builds the document preview frame bundles.
 *
 * Each src/renderer/cowork/preview/renderers/<type>/render.ts gets one Vite
 * library build of the frame runtime with that renderer, as a single IIFE.
 * The generator writes into the gitignored preview/generated/ folder:
 *   - <type>.iife.txt, the script text the frame's srcdoc inlines;
 *   - preview-hashes.gen.json, each script's base64 sha256 for the frame policy;
 *   - registry.ts, the lazy loaders the viewer reads.
 * It writes third-party-notices.txt, the LICENSE and NOTICE files of every
 * package a bundle holds plus each type's build.config.mjs `notices`, into the
 * renderer's public folder (src/renderer/public, also gitignored there).
 * src/renderer/vite.config.ts sets no publicDir, so Vite copies its default
 * public folder, this one, into both dist/renderer and dist/renderer-web.
 *
 * A type's build.config.mjs plugins apply to that type's build only, and its
 * assets.ts is wired into the registry when it exists. A bundle that isn't one
 * chunk, or whose text could end the inline script, change under the HTML
 * parser or reach for Node or a module loader, fails the build, so the frame
 * never runs a script without a hash. A bundle is the same text whatever
 * NODE_ENV the calling process has, so the dev server and Vitest load the
 * bytes a build ships.
 *
 * The package.json prebuild, predev and pretypecheck hooks and Vitest's
 * globalSetup run it, and the postbuild hooks run verify-preview-build.mjs on
 * each build output. It sits outside the folders .dockerignore drops (build,
 * out, dist, release), so the image builds can run it too.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'vite';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_DIR = path.join(REPO_ROOT, 'src/renderer/cowork/preview');
const PUBLIC_DIR = path.join(REPO_ROOT, 'src/renderer/public');

export const RENDERER_SPECIFIER = 'virtual:cowork-preview-renderer';
export const NOTICES_FILE = 'third-party-notices.txt';

const TYPE_NAME = /^[a-z0-9]+$/;
const BUNDLE_SUFFIX = '.iife.txt';
const BUILD_CONFIG_KEYS = new Set(['plugins', 'notices']);
const NOTICE_FILE = /^(?:licen[cs]e|notice)/i;

/* Notice files a package keeps outside its top-level LICENSE and NOTICE files,
   by package name, added whenever a bundle holds that package. pako ports
   zlib's C code, and the Zlib license of that code is in lib/zlib/README, not
   in pako's LICENSE. Every bundle holds pako, through the runtime's JSZip. */
const PACKAGE_NOTICE_FILES = new Map([['pako', ['lib/zlib/README']]]);

/* Text a frame bundle must not hold. The first two end or confuse the inline
   <script>; NUL changes under the HTML parser; the next three reach for Node or
   a module loader that the frame doesn't have. The last is the stand-in Vite
   gives a Node built-in module outside production builds, so a bundle holding
   it would differ between the dev server or Vitest and the build that ships. */
const FORBIDDEN_SCRIPT_TEXT = [
  { label: '</script', pattern: /<\/script/i },
  { label: '<script', pattern: /<script/i },
  { label: 'a NUL character', pattern: /\0/ },
  { label: 'a leftover process.', pattern: /\bprocess\./ },
  { label: 'import(', pattern: /\bimport\s*\(/ },
  { label: 'import.meta', pattern: /\bimport\s*\.\s*meta\b/ },
  { label: "Vite's development stand-in for a Node module", pattern: /has been externalized for browser compatibility/ },
];

/* The HTML parser turns \r\n and lone \r into \n before the frame policy hashes
   the inline script, so the text is normalized the same way before hashing. */
export function normalizeScriptText(text) {
  return text.replace(/\r\n?/g, '\n');
}

export function scriptSha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

export function checkScriptText(type, text) {
  for (const { label, pattern } of FORBIDDEN_SCRIPT_TEXT) {
    if (pattern.test(text)) throw new Error(`preview bundle ${type}: the script holds ${label}`);
  }
}

/* The one chunk a type's build must produce. Anything else in the output, a
   second chunk or an emitted asset, would never reach the frame. */
export function singleChunk(type, output) {
  const [first] = output;
  if (output.length !== 1 || first.type !== 'chunk') {
    const files = output.map((item) => `${item.type} ${item.fileName}`).join(', ');
    throw new Error(`preview bundle ${type}: the build must give exactly one chunk, got ${files}`);
  }
  return first;
}

/* Every script has a hash, and every hash is the sha256 of its script after
   \r\n? normalization. A missing or wrong hash fails the build, so the frame
   never runs a script its policy doesn't name. */
export function checkHashes(scripts, hashes) {
  for (const { type, text } of scripts) {
    const hash = hashes[type];
    if (typeof hash !== 'string' || hash !== scriptSha256(normalizeScriptText(text))) {
      throw new Error(`preview bundle ${type}: missing or wrong hash in preview-hashes.gen.json`);
    }
  }
}

/* Reads the generated folder back from disk and checks each bundle against
   preview-hashes.gen.json, so what the app loads is what the hashes name. */
export function verifyGeneratedBundles(outDir) {
  const hashes = JSON.parse(readFileSync(path.join(outDir, 'preview-hashes.gen.json'), 'utf8'));
  const scripts = readdirSync(outDir)
    .filter((name) => name.endsWith(BUNDLE_SUFFIX))
    .map((name) => ({ type: name.slice(0, -BUNDLE_SUFFIX.length), text: readFileSync(path.join(outDir, name), 'utf8') }));
  checkHashes(scripts, hashes);
  return scripts.map((script) => script.type);
}

function packageRoot(moduleId) {
  const marker = '/node_modules/';
  const at = moduleId.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = moduleId.slice(at + marker.length).split('/');
  const depth = rest[0].startsWith('@') ? 2 : 1;
  return moduleId.slice(0, at + marker.length) + rest.slice(0, depth).join('/');
}

export async function loadBuildConfig(rendererDir, repoRoot) {
  const file = path.join(rendererDir, 'build.config.mjs');
  if (!existsSync(file)) return { plugins: [], noticeFiles: [] };
  const config = (await import(pathToFileURL(file).href)).default;
  const label = path.relative(repoRoot, file);
  if (!config || typeof config !== 'object') throw new Error(`${label} must default-export an object`);
  for (const key of Object.keys(config)) {
    if (!BUILD_CONFIG_KEYS.has(key)) throw new Error(`${label} has an unknown key: ${key}`);
  }
  if (!Array.isArray(config.plugins)) throw new Error(`${label} must export a plugins array`);
  const notices = config.notices ?? [];
  if (!Array.isArray(notices)) throw new Error(`${label} notices must be an array`);
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const noticeFiles = notices.map((specifier) => {
    try {
      return require.resolve(specifier);
    } catch {
      throw new Error(`${label} names a notice that doesn't resolve: ${specifier}`);
    }
  });
  return { plugins: config.plugins, noticeFiles };
}

/*
 * Builds one frame bundle: the runtime entry with `renderPath` as its
 * renderer. Returns the checked, normalized script text, its hash, and the
 * package folders it holds.
 */
export async function buildPreviewBundle({
  type,
  renderPath,
  runtimeEntry = path.join(PREVIEW_DIR, 'runtime/frameEntry.ts'),
  repoRoot = REPO_ROOT,
  plugins = [],
}) {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const result = await build({
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    root: repoRoot,
    publicDir: false,
    plugins,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: {
      alias: [
        { find: new RegExp(`^${RENDERER_SPECIFIER}$`), replacement: renderPath },
        /* JSZip's package points browsers at its prebuilt file, which inlines
           the setimmediate package and its Node branch. Its source takes
           setImmediate from the runtime's own module instead, and a renderer
           that imports jszip shares the runtime's copy. */
        { find: /^jszip$/, replacement: require.resolve('jszip/lib/index.js') },
        { find: /^setimmediate$/, replacement: path.join(path.dirname(runtimeEntry), 'setImmediate.ts') },
        /* JSZip's browser map sends readable-stream to a file that requires
           Node's stream module. Vite's own stand-in for that module is an
           empty object in a production build and a warning Proxy otherwise,
           and Vite picks by the NODE_ENV of the process that runs the build:
           unset (so production) in the npm hooks, development in the dev
           server, test in Vitest. The runtime's empty module stands in for it
           in every build, so they all give the same bundle. */
        { find: /^stream$/, replacement: path.join(path.dirname(runtimeEntry), 'nodeStream.ts') },
      ],
    },
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      minify: true,
      reportCompressedSize: false,
      lib: {
        entry: runtimeEntry,
        formats: ['iife'],
        name: 'coworkDocumentPreview',
        fileName: () => `${type}.iife.js`,
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = singleChunk(type, outputs.flatMap((item) => item.output));
  const text = normalizeScriptText(chunk.code);
  checkScriptText(type, text);
  const packages = new Set(chunk.moduleIds.map(packageRoot).filter(Boolean));
  return { type, text, sha256: scriptSha256(text), packages };
}

function noticeSection(title, text) {
  return `${'='.repeat(72)}\n${title}\n${'-'.repeat(72)}\n${text.trim()}\n`;
}

/* The LICENSE and NOTICE files of every bundled package, then the extra
   notice files: the ones PACKAGE_NOTICE_FILES names for a bundled package and
   the ones the build configs name, each once. */
export function thirdPartyNotices(packageDirs, noticeFiles, repoRoot = REPO_ROOT) {
  const sections = [];
  const extraFiles = [...noticeFiles];
  for (const dir of [...packageDirs].sort()) {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const files = readdirSync(dir).filter((name) => NOTICE_FILE.test(name) && statSync(path.join(dir, name)).isFile()).sort();
    const title = `${manifest.name} ${manifest.version}`;
    if (files.length === 0) {
      sections.push(noticeSection(title, `No LICENSE or NOTICE file. package.json license: ${manifest.license ?? 'none'}`));
    }
    for (const name of files) {
      sections.push(noticeSection(`${title} (${name})`, readFileSync(path.join(dir, name), 'utf8')));
    }
    for (const name of PACKAGE_NOTICE_FILES.get(manifest.name) ?? []) extraFiles.push(path.join(dir, name));
  }
  for (const file of [...new Set(extraFiles)].sort()) {
    sections.push(noticeSection(path.relative(repoRoot, file), readFileSync(file, 'utf8')));
  }
  return ['Third-party software in the document preview frame bundles.', '', ...sections].join('\n');
}

/* Checks that a renderer build output carries the notices file the generator
   wrote, byte for byte, so a build that drops or changes it fails.
   verify-preview-build.mjs runs it on each build output. */
export function verifyBuildNotices(buildDir, publicDir = PUBLIC_DIR) {
  const shipped = path.join(buildDir, NOTICES_FILE);
  if (!existsSync(shipped)) throw new Error(`${buildDir} has no ${NOTICES_FILE}`);
  const written = path.join(publicDir, NOTICES_FILE);
  if (readFileSync(shipped, 'utf8') !== readFileSync(written, 'utf8')) {
    throw new Error(`${shipped} differs from ${written}`);
  }
}

function moduleSpecifier(fromDir, file) {
  const relative = path.relative(fromDir, file).split(path.sep).join('/').replace(/\.ts$/, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export function registrySource(bundles, { outDir, runtimeDir }) {
  const lines = [
    '/* Written by scripts/preview-bundles.mjs. Do not edit. */',
    `import type { PreviewBundle } from '${moduleSpecifier(outDir, path.join(runtimeDir, 'bundle.ts'))}';`,
  ];
  if (bundles.length === 0) {
    lines.push('', 'export const previewBundles: readonly PreviewBundle[] = [];', '');
    return lines.join('\n');
  }
  lines.push("import hashes from './preview-hashes.gen.json';");
  lines.push('', 'export const previewBundles: readonly PreviewBundle[] = [');
  for (const bundle of bundles) {
    const loadAssets = bundle.assetsPath
      ? `() => import('${moduleSpecifier(outDir, bundle.assetsPath)}').then((module) => module.default())`
      : 'null';
    lines.push(
      '  {',
      `    type: '${bundle.type}',`,
      `    scriptSha256: hashes.${bundle.type},`,
      `    loadScript: () => import('./${bundle.type}${BUNDLE_SUFFIX}?raw').then((module) => module.default),`,
      `    loadAssets: ${loadAssets},`,
      '  },',
    );
  }
  lines.push('];', '');
  return lines.join('\n');
}

/* Writes a file only when its text changed, so a dev server watching the
   folder reloads only for a real change. */
function writeIfChanged(file, text) {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
  writeFileSync(file, text);
}

/*
 * Builds every renderer under `renderersDir` and brings `outDir` to exactly
 * the files those builds give, so a removed renderer leaves no stale bundle
 * behind. It writes the notices into `publicDir`, the folder Vite copies into
 * each renderer build output. It reads the written bundles back and checks
 * their hashes last.
 */
export async function generatePreviewBundles({
  repoRoot = REPO_ROOT,
  renderersDir = path.join(PREVIEW_DIR, 'renderers'),
  runtimeDir = path.join(PREVIEW_DIR, 'runtime'),
  outDir = path.join(PREVIEW_DIR, 'generated'),
  publicDir = PUBLIC_DIR,
} = {}) {
  const types = existsSync(renderersDir)
    ? readdirSync(renderersDir).filter((name) => existsSync(path.join(renderersDir, name, 'render.ts'))).sort()
    : [];
  const bundles = [];
  const noticeFiles = [];
  for (const type of types) {
    if (!TYPE_NAME.test(type)) throw new Error(`preview renderer folder names must be lowercase letters and digits: ${type}`);
    const rendererDir = path.join(renderersDir, type);
    const config = await loadBuildConfig(rendererDir, repoRoot);
    const bundle = await buildPreviewBundle({
      type,
      renderPath: path.join(rendererDir, 'render.ts'),
      runtimeEntry: path.join(runtimeDir, 'frameEntry.ts'),
      repoRoot,
      plugins: config.plugins,
    });
    const assetsPath = path.join(rendererDir, 'assets.ts');
    bundles.push({ ...bundle, assetsPath: existsSync(assetsPath) ? assetsPath : null });
    noticeFiles.push(...config.noticeFiles);
  }
  const hashes = Object.fromEntries(bundles.map((bundle) => [bundle.type, bundle.sha256]));
  const packages = new Set(bundles.flatMap((bundle) => [...bundle.packages]));
  const files = new Map([
    ...bundles.map((bundle) => [`${bundle.type}${BUNDLE_SUFFIX}`, bundle.text]),
    ['preview-hashes.gen.json', `${JSON.stringify(hashes, null, 2)}\n`],
    ['registry.ts', registrySource(bundles, { outDir, runtimeDir })],
  ]);
  mkdirSync(outDir, { recursive: true });
  for (const name of readdirSync(outDir)) {
    if (!files.has(name)) rmSync(path.join(outDir, name), { recursive: true, force: true });
  }
  for (const [name, text] of files) writeIfChanged(path.join(outDir, name), text);
  mkdirSync(publicDir, { recursive: true });
  writeIfChanged(path.join(publicDir, NOTICES_FILE), thirdPartyNotices(packages, noticeFiles, repoRoot));
  verifyGeneratedBundles(outDir);
  return { types: bundles.map((bundle) => bundle.type), outDir };
}

/* Vitest's globalSetup entry: the generated folder exists before any test
   file imports it. */
export async function setup() {
  await generatePreviewBundles();
}

/* Run as a script by the npm hooks. No top-level await, so a Vite config
   that imports this module can still be bundled as CommonJS. */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  generatePreviewBundles().then(({ types, outDir }) => {
    console.log(`preview bundles: ${types.length ? types.join(', ') : 'no renderers'} -> ${path.relative(REPO_ROOT, outDir)}`);
  }, (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
