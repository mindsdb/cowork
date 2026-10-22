/* Hand-written declarations for preview-bundles.mjs, so its tests and the
   document preview harness's Vite config can import it under
   `npm run typecheck:test`. */
import type { PluginOption } from 'vite';

export declare const RENDERER_SPECIFIER: 'virtual:cowork-preview-renderer';
export declare const NOTICES_FILE: 'third-party-notices.txt';

export interface ScriptText {
  type: string;
  text: string;
}

export interface PreviewBundleBuild {
  type: string;
  /** The checked script text, \r\n? already normalized to \n. */
  text: string;
  /** The base64 sha256 of `text`. */
  sha256: string;
  /** The node_modules package folders the bundle holds. */
  packages: Set<string>;
}

export interface BuildPreviewBundleOptions {
  type: string;
  renderPath: string;
  runtimeEntry?: string;
  repoRoot?: string;
  plugins?: PluginOption[];
}

export interface GeneratePreviewBundlesOptions {
  repoRoot?: string;
  renderersDir?: string;
  runtimeDir?: string;
  outDir?: string;
  /** Where the notices file goes: the folder Vite copies into each renderer build output. */
  publicDir?: string;
}

export interface OutputItem {
  type: 'chunk' | 'asset';
  fileName: string;
}

export declare function normalizeScriptText(text: string): string;
export declare function scriptSha256(text: string): string;
export declare function checkScriptText(type: string, text: string): void;
export declare function singleChunk<T extends OutputItem>(type: string, output: readonly T[]): T;
export declare function checkHashes(scripts: readonly ScriptText[], hashes: Readonly<Record<string, unknown>>): void;
export declare function verifyGeneratedBundles(outDir: string): string[];
export declare function loadBuildConfig(
  rendererDir: string,
  repoRoot: string,
): Promise<{ plugins: PluginOption[]; noticeFiles: string[] }>;
export declare function buildPreviewBundle(options: BuildPreviewBundleOptions): Promise<PreviewBundleBuild>;
export declare function thirdPartyNotices(
  packageDirs: Iterable<string>,
  noticeFiles: readonly string[],
  repoRoot?: string,
): string;
export declare function verifyBuildNotices(buildDir: string, publicDir?: string): void;
export declare function generatePreviewBundles(
  options?: GeneratePreviewBundlesOptions,
): Promise<{ types: string[]; outDir: string }>;
export declare function setup(): Promise<void>;
export declare function teardown(): void;
