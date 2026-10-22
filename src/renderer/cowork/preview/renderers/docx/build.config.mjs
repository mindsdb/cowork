/*
 * The Word preview's IIFE build settings, a RendererBuildConfig (hooks.ts).
 *
 * The build needs no plugin. It bundles pako through docx-preview's jszip, and
 * pako's LICENSE file carries only pako's MIT text. pako/lib/zlib/README
 * carries the Zlib license of the zlib code pako ports, and no code, so the
 * notices add that file.
 */
export default {
  plugins: [],
  notices: ['pako/lib/zlib/README'],
};
