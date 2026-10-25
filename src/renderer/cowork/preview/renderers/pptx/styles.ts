/*
 * The slide preview's fixed text and stylesheet. Shape positions and sizes are
 * percentages of the slide, and lengths inside a slide are cqw, so a slide
 * scales with the width of the frame and nothing reads the window size. The
 * label sticks to the top of the frame, so it stays in view over every slide.
 */

export const PREVIEW_LABEL = 'Preview may differ from PowerPoint';
export const NO_SLIDES_NOTE = 'This presentation has no slides.';
export const UNREADABLE_SLIDE_NOTE = "This slide couldn't be shown.";

/* What a placeholder box says in place of content the preview doesn't draw. */
export const PLACEHOLDER_LABELS = {
  chart: 'Chart not shown in preview',
  diagram: 'Diagram not shown in preview',
  video: 'Video not shown in preview',
  audio: 'Audio not shown in preview',
  picture: 'Picture not shown in preview',
  object: 'Object not shown in preview',
} as const;

export type PlaceholderKind = keyof typeof PLACEHOLDER_LABELS;

export const PPTX_STYLES = `
.pptx-deck {
  box-sizing: border-box;
  min-height: 100%;
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  background: #ececec;
  color: #000;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.pptx-label, .pptx-note {
  margin: 0;
  align-self: stretch;
  text-align: center;
  font-size: 12px;
  line-height: 1.4;
  color: #444;
}
.pptx-label {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 4px 0;
  background: #ececec;
}
.pptx-slide {
  position: relative;
  width: 100%;
  max-width: 1280px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  container-type: inline-size;
}
.pptx-slide-note {
  display: flex;
  align-items: center;
  justify-content: center;
}
.pptx-shape {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}
.pptx-picture {
  position: absolute;
  box-sizing: border-box;
  object-fit: fill;
}
.pptx-picture-crop {
  position: absolute;
  overflow: hidden;
}
.pptx-placeholder {
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1px dashed #8a8a8a;
  background: #f4f4f4;
  color: #444;
  font-size: 12px;
  line-height: 1.3;
  text-align: center;
  overflow: hidden;
}
.pptx-p {
  margin: 0;
  line-height: 1.2;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.pptx-bullet {
  display: inline-block;
  min-width: 1.2em;
}
.pptx-table {
  width: 100%;
  height: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.pptx-table td {
  border: 1px solid #9a9a9a;
  vertical-align: top;
  padding: 0.4cqw 0.8cqw;
  overflow: hidden;
}
`;
