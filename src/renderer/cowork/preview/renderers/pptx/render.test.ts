/*
 * The pptx renderer against the decks and expectations in render.test.yaml,
 * through a RendererContext shaped like the frame runtime's: the archive comes
 * from ctx.openZip, and the test records every entry the renderer reads.
 *
 * happy-dom's XML parser, which these tests run on, drops an r:id that follows
 * an id on the same element. PowerPoint writes each sldId that way, and so do
 * the committed fixtures, which the pptx spec renders in Chromium. So the
 * test's archive hands the renderer each sldId with r:id first.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { buildDeck, FIXTURE_DIR, type DeckSpec } from '../../../../../../e2e/document-preview/fixtures/pptx/deck';
import type { GuardedZip, PreviewErrorCode, PreviewLimits, RenderSummary, RendererContext } from '../../contract';
import { isPreviewError, previewError } from '../../errors';
import { previewLimits } from '../../limits';
import renderer from './render';
import type { PlaceholderKind } from './styles';

interface CaseExpectation {
  error?: PreviewErrorCode;
  units?: number;
  truncated?: boolean;
  text?: string[];
  slides?: string[];
  lastSlide?: string;
  placeholders?: PlaceholderKind[];
  shapes?: number;
  images?: number;
  rtl?: string[];
  overlaps?: string[][];
  markupExcludes?: string[];
  unread?: string[];
  withinMs?: number;
}

interface RenderCase {
  name: string;
  file?: string;
  deck?: DeckSpec;
  /* The file's bytes as base64, for a file that isn't a deck. */
  bytes?: string;
  limits?: Partial<PreviewLimits>;
  expect: CaseExpectation;
}

interface RenderCases {
  label: string;
  cases: RenderCase[];
}

/* The archive the renderer reads, and the entry names it asked for, in order. */
interface RecordedZip {
  zip: GuardedZip;
  reads: string[];
}

interface RunOptions {
  limits?: Partial<PreviewLimits>;
  signal?: AbortSignal;
  openZip?: RendererContext['openZip'];
  onProgress?: (done: number, total: number | null) => void;
}

interface Run {
  root: HTMLElement;
  /* Each archive the renderer opened through ctx.openZip. */
  opened: RecordedZip[];
  progress: Array<[number, number | null]>;
  /* performance.now() just before render() is called. */
  started: number;
  rendered: Promise<RenderSummary>;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DATA = load(readFileSync(join(__dirname, 'render.test.yaml'), 'utf8')) as RenderCases;
const SLD_ID_ID_FIRST = /<p:sldId id="(\d+)" r:id="(\w+)"\/>/g;

/* Elements that can load, play or navigate, none of which a slide preview draws. */
const FORBIDDEN_ELEMENTS = 'a, area, [href], iframe, frame, object, embed, video, audio, source, script, form, base';

type Source = Pick<RenderCase, 'file' | 'deck' | 'bytes'>;

async function deckBytes(source: Source): Promise<ArrayBuffer> {
  if (source.bytes !== undefined) return new Uint8Array(Buffer.from(source.bytes, 'base64')).buffer;
  const bytes = source.file ? readFileSync(join(FIXTURE_DIR, source.file)) : await buildDeck(source.deck ?? {});
  return new Uint8Array(bytes).buffer;
}

async function recordingZip(bytes: ArrayBuffer): Promise<RecordedZip> {
  const archive = await JSZip.loadAsync(bytes);
  const names = Object.values(archive.files).filter((entry) => !entry.dir).map((entry) => entry.name);
  const reads: string[] = [];
  const entry = (name: string): JSZip.JSZipObject | null => {
    reads.push(name);
    return archive.file(name);
  };
  return {
    reads,
    zip: {
      names: () => names,
      bytes: async (name) => (await entry(name)?.async('uint8array')) ?? null,
      text: async (name) => {
        const text = await entry(name)?.async('string');
        return text === undefined ? null : text.replace(SLD_ID_ID_FIRST, '<p:sldId r:id="$2" id="$1"/>');
      },
    },
  };
}

async function startRender(source: Source, options: RunOptions = {}): Promise<Run> {
  const bytes = await deckBytes(source);
  const root = document.createElement('div');
  document.body.append(root);
  const progress: Array<[number, number | null]> = [];
  const opened: RecordedZip[] = [];
  const ctx: RendererContext = {
    root,
    limits: { ...previewLimits({ touch: false }), ...options.limits },
    signal: options.signal ?? new AbortController().signal,
    progress(done, total) {
      progress.push([done, total]);
      options.onProgress?.(done, total);
    },
    openZip:
      options.openZip ??
      (async (archive) => {
        const zip = await recordingZip(archive);
        opened.push(zip);
        return zip.zip;
      }),
    requestAsset: async () => null,
  };
  const started = performance.now();
  return { root, opened, progress, started, rendered: renderer.render(bytes, ctx) };
}

function slideElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('section.pptx-slide'));
}

function shapeWithText(root: HTMLElement, text: string): HTMLElement {
  const shape = Array.from(root.querySelectorAll<HTMLElement>('.pptx-shape')).find((el) => el.textContent === text);
  if (!shape) throw new Error(`No shape reads "${text}"`);
  return shape;
}

function rect(el: HTMLElement): Rect {
  const { left, top, width, height } = el.style;
  return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) };
}

function overlap(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

function expectSlides(root: HTMLElement, summary: RenderSummary, want: CaseExpectation): void {
  const slides = slideElements(root);
  expect(slides).toHaveLength(summary.units);
  for (const [i, text] of (want.slides ?? []).entries()) expect(slides[i]?.textContent).toContain(text);
  if (want.lastSlide !== undefined) expect(slides.at(-1)?.textContent).toContain(want.lastSlide);
  for (const text of want.text ?? []) expect(root.textContent).toContain(text);
}

function expectDrawn(root: HTMLElement, want: CaseExpectation): void {
  if (want.placeholders !== undefined) {
    const kinds = Array.from(root.querySelectorAll<HTMLElement>('[data-placeholder]'), (el) => el.dataset.placeholder);
    expect(kinds).toEqual(want.placeholders);
  }
  if (want.shapes !== undefined) expect(root.querySelectorAll('.pptx-shape')).toHaveLength(want.shapes);
  const images = Array.from(root.querySelectorAll('img'));
  if (want.images !== undefined) expect(images).toHaveLength(want.images);
  for (const img of images) expect(img.getAttribute('src')).toMatch(/^data:image\/(?:png|jpeg|gif|bmp|webp);base64,/);
  if (want.rtl !== undefined) {
    expect(Array.from(root.querySelectorAll('p[dir="rtl"]'), (p) => p.textContent)).toEqual(want.rtl);
  }
  for (const texts of want.overlaps ?? []) {
    const shapes = texts.map((text) => shapeWithText(root, text));
    for (const [i, shape] of shapes.slice(1).entries()) {
      const below = shapes[i];
      expect(below.compareDocumentPosition(shape) & Node.DOCUMENT_POSITION_FOLLOWING, `${texts[i + 1]} drawn after ${texts[i]}`).toBeTruthy();
      expect(overlap(rect(below), rect(shape)), `${texts[i + 1]} overlaps ${texts[i]}`).toBe(true);
    }
  }
  expect(root.querySelectorAll(FORBIDDEN_ELEMENTS)).toHaveLength(0);
  for (const text of want.markupExcludes ?? []) expect(root.innerHTML).not.toContain(text);
}

function expectReads(opened: RecordedZip[], want: CaseExpectation): void {
  expect(opened).toHaveLength(1);
  const [zip] = opened;
  const names = zip.zip.names();
  expect(zip.reads.filter((name) => !names.includes(name))).toEqual([]);
  for (const name of want.unread ?? []) {
    expect(names, `${name} is in the package`).toContain(name);
    expect(zip.reads, `${name} is never read`).not.toContain(name);
  }
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the pptx renderer', () => {
  it('previews the pptx type', () => {
    expect(renderer.type).toBe('pptx');
  });

  it.each(DATA.cases)('$name', async (testCase) => {
    const want = testCase.expect;
    const run = await startRender(testCase, { limits: testCase.limits });
    if (want.error) {
      await expect(run.rendered).rejects.toMatchObject({ name: 'PreviewError', code: want.error });
      return;
    }

    const summary = await run.rendered;
    if (want.withinMs !== undefined) expect(performance.now() - run.started, 'render time in ms').toBeLessThan(want.withinMs);
    expect(summary.type).toBe('pptx');
    if (want.units !== undefined) expect(summary.units).toBe(want.units);
    if (want.truncated !== undefined) expect(summary.truncated).toBe(want.truncated);
    expect(run.root.querySelector('.pptx-deck')?.firstElementChild?.textContent).toBe(DATA.label);
    expectSlides(run.root, summary, want);
    expectDrawn(run.root, want);
    expectReads(run.opened, want);
  });
});

describe('progress and stopping', () => {
  const THREE_SLIDES = { file: 'three-slides.pptx' };

  it('reports progress before the first slide and after each one', async () => {
    const run = await startRender(THREE_SLIDES);
    await run.rendered;
    expect(run.progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });

  it('opens nothing when the signal has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let opened = false;
    const run = await startRender(THREE_SLIDES, {
      signal: controller.signal,
      openZip: async () => {
        opened = true;
        throw new Error('openZip ran');
      },
    });
    await expect(run.rendered).rejects.toMatchObject({ name: 'AbortError' });
    expect(opened).toBe(false);
    expect(run.root.childElementCount).toBe(0);
  });

  it('stops between slides when the signal aborts', async () => {
    const controller = new AbortController();
    const run = await startRender(THREE_SLIDES, {
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 1) controller.abort();
      },
    });
    await expect(run.rendered).rejects.toMatchObject({ name: 'AbortError' });
    expect(slideElements(run.root)).toHaveLength(1);
  });
});

describe('errors', () => {
  it("passes on the archive guard's own PreviewError", async () => {
    const run = await startRender({ file: 'three-slides.pptx' }, {
      openZip: () => Promise.reject(previewError('zip-limit', 'past the cap')),
    });
    await expect(run.rendered).rejects.toMatchObject({ code: 'zip-limit', message: 'past the cap' });
  });

  it('fails with parse-failed when the bytes do not open as an archive', async () => {
    const run = await startRender({ file: 'three-slides.pptx' }, {
      openZip: () => Promise.reject(new Error('not a zip')),
    });
    const error = await run.rendered.catch((reason: unknown) => reason);
    expect(isPreviewError(error)).toBe(true);
    expect(error).toMatchObject({ name: 'PreviewError', code: 'parse-failed' });
  });
});
