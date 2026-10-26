/*
 * The elements a slide preview never draws, for render.test.ts in happy-dom
 * and pptx.spec.ts in Chromium alike: each can load, play, navigate or run.
 * happy-dom rejects the namespace form [*|href], so the selector names
 * xlink:href by its qualified name instead. This file stays apart from
 * deck.ts, which reads import.meta and so loads only as a module.
 */
export const FORBIDDEN_ELEMENTS =
  'a, area, [href], [xlink\\:href], iframe, frame, object, embed, video, audio, source, script, form, base';
