/*
 * A test-only renderer for the frame's own 'navigation' fixture set. It never
 * ships in the app: the bundle generator builds only
 * src/renderer/cowork/preview/renderers/<type>/render.ts, and the harness's
 * Vite config builds this file for the harness page alone.
 *
 * It stands in for a renderer that leaves a file's links in its DOM. It parses
 * the fixture as HTML with DOMParser, which runs no script and loads nothing,
 * and moves the parsed body into ctx.root as it is, so every link, form and
 * resource the file holds reaches the frame's live DOM. Only the runtime's
 * link guard, the sandbox and the frame policy then keep the frame at
 * about:srcdoc.
 *
 * It declares 'docx' because DocumentRenderer.type stays one of the four
 * document types; the harness sends it that type.
 */
import type { RendererModule } from '../../src/renderer/cowork/preview/hooks';

export default {
  type: 'docx',
  async render(bytes, ctx) {
    const markup = new TextDecoder().decode(bytes);
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    ctx.root.append(...Array.from(parsed.body.childNodes));
    ctx.progress(1, 1);
    return { type: 'docx', units: 1, truncated: false };
  },
} satisfies RendererModule;
