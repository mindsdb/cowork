/*
 * The PDF preview's IIFE build settings, a RendererBuildConfig (hooks.ts).
 *
 * pdfjs-dist ships code the frame can't run, and text the preview bundle
 * check refuses:
 * - The worker loads its JBIG2, CCITT and JPX decoders through WasmImage. With
 *   wasm off it imports the no-wasm fallback by URL, a dynamic import() the
 *   frame can't make, so scanned pages would draw blank. The transform swaps
 *   that one import() for the two fallback modules, bundled statically.
 * - pdf.mjs imports a worker script by URL, and keeps import() in the source
 *   text of a cross-origin worker wrapper. The preview always runs the bundled
 *   worker on the frame's thread, so both become errors that never run.
 * - import.meta.url names the script's own URL, which an inline script has
 *   none of. Every read becomes "", which the code already handles.
 * - pdf.js reads process.* only on paths behind its isNodeJS test. The frame
 *   is never Node, so isNodeJS becomes the constant false and the bundler
 *   drops those paths. core-js's engine check keeps the process global in a
 *   local variable named process, which the transform renames.
 * Each swap must match exactly once, and no import( or import.meta may remain
 * in a rewritten file, or the build fails. A pdfjs-dist bump that moves this
 * code fails here instead of shipping blank scans.
 */

const WORKER_FILE = 'legacy/build/pdf.worker.mjs';
const MAIN_FILE = 'legacy/build/pdf.mjs';

/* The worker's only dynamic import, in WasmImage#getJsModule. */
const NO_WASM_IMPORT =
  /import\(\s*\/\*webpackIgnore: true\*\/\s*\/\*@vite-ignore\*\/\s*`\$\{WasmImage\.#wasmUrl\}\$\{this\._noWasmFilename\}`\)/g;

/* pdf.mjs's import of a worker script, in PDFWorker._setupFakeWorkerGlobal. */
const WORKER_SCRIPT_IMPORT = /import\(\s*\/\*webpackIgnore: true\*\/\s*\/\*@vite-ignore\*\/\s*this\.workerSrc\)/g;

/* The source text pdf.mjs wraps a cross-origin worker script in. */
const WORKER_WRAPPER_SOURCE = '`await import("${url}");`';

/* pdf.js's test for Node, in pdf.mjs and in the worker. */
const IS_NODE_JS = /const isNodeJS = typeof process === "object"[^;]*;/g;

/* core-js's engine check, in pdf.mjs and in the worker. */
const CORE_JS_PROCESS = 'var process = globalThis.process;\nvar Deno = globalThis.Deno;\nvar versions = process && process.versions || Deno && Deno.version;';
const CORE_JS_NODE_PROCESS = 'var nodeProcess = globalThis.process;\nvar Deno = globalThis.Deno;\nvar versions = nodeProcess && nodeProcess.versions || Deno && Deno.version;';

const NO_WASM_MODULES = [
  'import __coworkJbig2NoWasm from "../../wasm/jbig2_nowasm_fallback.js";',
  'import __coworkOpenjpegNoWasm from "../../wasm/openjpeg_nowasm_fallback.js";',
  'const __coworkNoWasmModules = {',
  '  "jbig2_nowasm_fallback.js": __coworkJbig2NoWasm,',
  '  "openjpeg_nowasm_fallback.js": __coworkOpenjpegNoWasm,',
  '};',
  '',
].join('\n');

const NO_WORKER_SCRIPT = 'The document preview runs the bundled pdf.js worker and loads no worker script.';

/* What each rewritten file swaps, target first. Every target must match once. */
const NODE_SWAPS = [
  [IS_NODE_JS, 'const isNodeJS = false;'],
  [CORE_JS_PROCESS, CORE_JS_NODE_PROCESS],
];
const SWAPS = {
  [WORKER_FILE]: [
    [NO_WASM_IMPORT, 'Promise.resolve({ default: __coworkNoWasmModules[this._noWasmFilename] })'],
    ...NODE_SWAPS,
  ],
  [MAIN_FILE]: [
    [WORKER_SCRIPT_IMPORT, `Promise.reject(new Error(${JSON.stringify(NO_WORKER_SCRIPT)}))`],
    [WORKER_WRAPPER_SOURCE, `\`throw new Error(${JSON.stringify(NO_WORKER_SCRIPT)});\``],
    ...NODE_SWAPS,
  ],
};

const PDFJS_FILE = /\/pdfjs-dist\/(legacy\/build\/pdf\.worker\.mjs|legacy\/build\/pdf\.mjs|wasm\/(?:jbig2|openjpeg)_nowasm_fallback\.js)$/;

/* Module loader syntax the frame can't run, spaced however the source spaces
   it. */
const LOADER_SYNTAX = [
  ['import(', /\bimport\s*\(/],
  ['import.meta', /\bimport\s*\.\s*meta\b/],
];

function replaceOnce(code, target, replacement, file) {
  const count = typeof target === 'string' ? code.split(target).length - 1 : [...code.matchAll(target)].length;
  if (count !== 1) {
    throw new Error(`pdfjs-dist ${file}: the no-wasm transform expected one match for ${target}, found ${count}.`);
  }
  return code.replace(target, () => replacement);
}

/* Rewrites one pdfjs-dist file, named by its path inside the package. */
export function rewritePdfjsSource(code, file) {
  let out = code;
  for (const [target, replacement] of SWAPS[file] ?? []) out = replaceOnce(out, target, replacement, file);
  if (file === WORKER_FILE) out = NO_WASM_MODULES + out;
  out = out.replaceAll('import.meta.url', '""');
  for (const [label, pattern] of LOADER_SYNTAX) {
    if (pattern.test(out)) throw new Error(`pdfjs-dist ${file}: ${label} is left after the no-wasm transform.`);
  }
  return out;
}

/* The Vite plugin that applies rewritePdfjsSource, and fails the build when
   the worker or pdf.mjs never passed through it. */
export function pdfjsNoWasmPlugin() {
  const rewritten = new Set();
  return {
    name: 'cowork-pdfjs-no-wasm',
    enforce: 'pre',
    buildStart() {
      rewritten.clear();
    },
    transform(code, id) {
      const match = PDFJS_FILE.exec(id.split('?')[0].replaceAll('\\', '/'));
      if (!match) return null;
      rewritten.add(match[1]);
      return { code: rewritePdfjsSource(code, match[1]), map: { mappings: '' } };
    },
    buildEnd(error) {
      if (error) return;
      for (const file of Object.keys(SWAPS)) {
        if (!rewritten.has(file)) this.error(`pdfjs-dist ${file} never reached the no-wasm transform.`);
      }
    },
  };
}

export default {
  plugins: [pdfjsNoWasmPlugin()],
  /* License files that ship with the bundled no-wasm decoders and the qcms
     glue in the worker (wasm/), and with the CMaps and standard fonts that
     assets.ts serves. */
  notices: [
    'pdfjs-dist/wasm/LICENSE_JBIG2',
    'pdfjs-dist/wasm/LICENSE_OPENJPEG',
    'pdfjs-dist/wasm/LICENSE_PDFJS_JBIG2',
    'pdfjs-dist/wasm/LICENSE_PDFJS_OPENJPEG',
    'pdfjs-dist/wasm/LICENSE_PDFJS_QCMS',
    'pdfjs-dist/wasm/LICENSE_QCMS',
    'pdfjs-dist/standard_fonts/LICENSE_FOXIT',
    'pdfjs-dist/standard_fonts/LICENSE_LIBERATION',
    'pdfjs-dist/cmaps/LICENSE',
  ],
};
