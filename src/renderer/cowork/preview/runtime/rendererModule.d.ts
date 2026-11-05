/* The renderer a frame bundle runs. The bundle generator resolves this module
   to one renderers/<type>/render.ts per build (scripts/preview-bundles.mjs). */
declare module 'virtual:cowork-preview-renderer' {
  import type { RendererModule } from '../hooks';

  const renderer: RendererModule;
  export default renderer;
}
