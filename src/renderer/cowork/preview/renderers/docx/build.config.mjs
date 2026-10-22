/*
 * The Word preview's IIFE build settings, a RendererBuildConfig (hooks.ts).
 *
 * The build needs no plugin. It bundles pako through docx-preview's jszip, and
 * pako's LICENSE file carries only pako's MIT text. pako ports zlib, whose
 * Zlib license sits in the header of each lib/zlib source file instead, so the
 * notices take the shortest of those files for that text.
 */
export default {
  plugins: [],
  notices: ['pako/lib/zlib/messages.js'],
};
