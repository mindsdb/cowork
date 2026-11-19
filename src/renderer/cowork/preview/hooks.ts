/*
 * The files a renderer folder may hold. The preview bundle generator finds them
 * by itself, so adding a type edits no shared file.
 *
 * - renderers/<type>/render.ts default-exports a RendererModule. Its presence
 *   makes the type previewable.
 * - renderers/<type>/build.config.mjs is optional. It default-exports a
 *   RendererBuildConfig, applied to that type's IIFE build only. Each `notices`
 *   entry is a bare module specifier, resolved from the repository root with
 *   createRequire, such as 'pdfjs-dist/standard_fonts/LICENSE_FOXIT'. The
 *   generator appends that file's text to third-party-notices.txt. It covers
 *   license files that the read of each bundled package's LICENSE and NOTICE
 *   misses: files in package subfolders, and files that reach the app through
 *   assets.ts instead of the IIFE.
 * - renderers/<type>/assets.ts is optional. It default-exports a
 *   RendererAssetsModule.
 *
 * tsc never checks build.config.mjs, so the generator checks its default export
 * when it loads it. The build fails on any key other than `plugins` and
 * `notices`, and on a `notices` entry that doesn't resolve. render.ts and
 * assets.ts mark their default exports with `satisfies RendererModule` and
 * `satisfies RendererAssetsModule`, so typecheck checks them.
 *
 * The generator writes preview/generated/registry.ts (gitignored), and nobody
 * edits it by hand.
 */
import type { PluginOption } from 'vite';

import type { DocumentRenderer, PreviewAssetProvider } from './contract';

export interface RendererBuildConfig { plugins: PluginOption[]; notices?: readonly string[] }
export type RendererAssetsModule = () => Promise<PreviewAssetProvider>;
export type RendererModule = DocumentRenderer;
