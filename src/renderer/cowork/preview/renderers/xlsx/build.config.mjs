/*
 * Build settings for the xlsx preview bundle.
 *
 * SheetJS checks whether it runs in Node by reading `process.versions`. In the
 * preview frame it never does, so this plugin replaces that one check with
 * `false`, which is what it evaluates to in a browser, and the bundle keeps no
 * `process.` reference. The build fails unless the check appears exactly once
 * in SheetJS's module, so a SheetJS change that moves it can't slip through.
 */
const SHEETJS_MODULE = '/node_modules/xlsx/xlsx.mjs';
const NODE_CHECK = "typeof Buffer !== 'undefined' && typeof process !== 'undefined' && typeof process.versions !== 'undefined' && !!process.versions.node";

const dropNodeCheck = {
  name: 'xlsx-preview-drop-node-check',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith(SHEETJS_MODULE)) return null;
    const parts = code.split(NODE_CHECK);
    if (parts.length !== 2) {
      throw new Error(`Expected SheetJS's Node check once in ${id}, found it ${parts.length - 1} times`);
    }
    return { code: parts.join('false'), map: null };
  },
};

export default { plugins: [dropNodeCheck] };
