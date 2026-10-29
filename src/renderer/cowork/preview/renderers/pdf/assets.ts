/*
 * The CMaps and standard fonts the PDF preview asks for by name. This module
 * runs in the Cowork page, not the frame: the parent answers each asset
 * request from it, so the frame never fetches anything.
 *
 * Each file is a lazy module whose default export is the file as a base64
 * data: URL, so the build splits every one into its own chunk and loads it
 * only when the frame asks for that name. import.meta.glob skips node_modules
 * unless the glob is exhaustive.
 */
import type { PreviewAssetProvider } from '../../contract';
import type { RendererAssetsModule } from '../../hooks';

const ASSET_MODULES: Record<string, () => Promise<string>> = {
  ...import.meta.glob<string>('../../../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
    query: '?url&inline',
    import: 'default',
    exhaustive: true,
  }),
  ...import.meta.glob<string>('../../../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
    query: '?url&inline',
    import: 'default',
    exhaustive: true,
  }),
};

const LOADERS = new Map(
  Object.entries(ASSET_MODULES).map(([path, load]) => [path.slice(path.lastIndexOf('/') + 1), load]),
);

/* The bytes a base64 data: URL carries. */
export function dataUrlBytes(url: string): ArrayBuffer {
  const marker = ';base64,';
  const start = url.indexOf(marker);
  if (!url.startsWith('data:') || start < 0) throw new Error('Expected a base64 data: URL.');
  const text = atob(url.slice(start + marker.length));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

const provider: PreviewAssetProvider = {
  names: [...LOADERS.keys()],
  async load(name) {
    const load = LOADERS.get(name);
    return load ? dataUrlBytes(await load()) : null;
  },
};

export default (async () => provider) satisfies RendererAssetsModule;
