/*
 * The renderer bundles the viewer can mount. The bundle generator writes
 * generated/registry.ts as a list of PreviewBundle, and the viewer loads one
 * bundle's script text and assets only when it previews a file of that type.
 */
import type { DocumentPreviewType, PreviewAssetProvider } from '../contract';

export interface PreviewBundle {
  type: DocumentPreviewType;
  /* The base64 sha256 of the script text, for the frame policy. */
  scriptSha256: string;
  loadScript(): Promise<string>;
  loadAssets: (() => Promise<PreviewAssetProvider>) | null;
}

export interface LoadedPreviewBundle {
  scriptText: string;
  scriptSha256: string;
  assets: PreviewAssetProvider | null;
}

/* Resolves to null when the build has no bundle for the type. */
export type PreviewBundleLoader = (type: DocumentPreviewType) => Promise<LoadedPreviewBundle | null>;

export async function loadPreviewBundle(
  bundles: readonly PreviewBundle[],
  type: DocumentPreviewType,
): Promise<LoadedPreviewBundle | null> {
  const bundle = bundles.find((entry) => entry.type === type);
  if (!bundle) return null;
  const [scriptText, assets] = await Promise.all([bundle.loadScript(), bundle.loadAssets?.() ?? null]);
  return { scriptText, scriptSha256: bundle.scriptSha256, assets };
}
