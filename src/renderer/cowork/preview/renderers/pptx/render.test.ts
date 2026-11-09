/*
 * The pptx renderer against the decks and expectations in render.test.yaml,
 * through a RendererContext shaped like the frame runtime's: the archive comes
 * from ctx.openZip, and the test records every entry the renderer reads.
 *
 * happy-dom's XML parser, which these tests run on, drops an r:id that follows
 * an id on the same element. PowerPoint writes each sldId that way, and so do
 * the committed fixtures, which the pptx spec renders in Chromium. So the
 * test's archive hands the renderer each sldId with r:id first. The parser
 * also rejects an XML declaration in single quotes, which python-pptx writes,
 * so the archive hands the renderer that declaration in double quotes.
 *
 * The xml helpers run unchanged through a spy, so a case can count how many
 * times the renderer lists a shape tree's p:sp shapes.
 *
 * happy-dom drops a style value that uses max() or cqw, so the cases check a
 * line's or outline's color and the sides it draws, not its width, and a
 * paragraph's alignment, bullet, typeface and color, not its font size.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDeck, FIXTURE_DIR, type DeckSpec } from '../../../../../../e2e/document-preview/fixtures/pptx/deck';
import { FORBIDDEN_ELEMENTS } from '../../../../../../e2e/document-preview/fixtures/pptx/forbidden';
import { loadFixtures } from '../../../../../../e2e/document-preview/harness';
import type { GuardedZip, PreviewErrorCode, PreviewLimits, RenderSummary, RendererContext } from '../../contract';
import { isPreviewError, previewError } from '../../errors';
import { previewLimits } from '../../limits';
import renderer from './render';
import type { PlaceholderKind } from './styles';
import { children } from './xml';

vi.mock('./xml', async (importOriginal) => {
  const xml = await importOriginal<typeof import('./xml')>();
  return { ...xml, children: vi.fn(xml.children) };
});

/* A drawn line's inline box, turn and color. */
interface LineExpectation {
  left: string;
  top: string;
  width: string;
  transform: string;
  color: string;
}

/* A cropped picture: its clipping box, and the picture inside it, each as
   inline left, top, width and height. */
interface CropExpectation {
  frame: [string, string, string, string];
  picture: [string, string, string, string];
}

/* What a paragraph draws: its inline text-align, the bullet before it ('' for
   none) and the bullet's inline color, and its first run's inline font family
   and color. A field left out isn't checked. */
interface ParagraphExpectation {
  align?: string;
  bullet?: string;
  bulletColor?: string;
  font?: string;
  color?: string;
}

interface CaseExpectation {
  error?: PreviewErrorCode;
  units?: number;
  truncated?: boolean;
  text?: string[];
  textExcludes?: string[];
  slides?: string[];
  lastSlide?: string;
  placeholders?: PlaceholderKind[];
  shapes?: number;
  images?: number;
  rtl?: string[];
  overlaps?: string[][];
  markupExcludes?: string[];
  unread?: string[];
  readCounts?: Record<string, number>;
  maxShapeTreeScans?: number;
  backgrounds?: string[];
  fills?: Record<string, string>;
  outlines?: Record<string, string>;
  lines?: LineExpectation[];
  crops?: CropExpectation[];
  boxes?: Record<string, [string, string, string, string]>;
  transforms?: Record<string, string>;
  anchors?: Record<string, string>;
  paragraphs?: Record<string, ParagraphExpectation>;
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

/* A committed deck's case takes its units, truncated and error from the
   deck's fixtures.yaml entry, which the pptx spec checks too, so the two
   can't drift. A case that changes ctx.limits states its own. */
function withFixtureSummaries(data: RenderCases): RenderCases {
  const fixtures = new Map(loadFixtures('pptx').map(({ file, expect: want }) => [file, want]));
  const cases = data.cases.map((testCase) => {
    if (testCase.file === undefined || testCase.limits !== undefined) return testCase;
    const fixture = fixtures.get(testCase.file);
    if (!fixture) throw new Error(`fixtures/pptx/fixtures.yaml has no entry for ${testCase.file}`);
    const { units, truncated, error } = testCase.expect;
    if (units !== undefined || truncated !== undefined || error !== undefined) {
      throw new Error(`render.test.yaml case '${testCase.name}' repeats what fixtures.yaml says of ${testCase.file}`);
    }
    return { ...testCase, expect: { ...testCase.expect, units: fixture.units, truncated: fixture.truncated, error: fixture.errorCode } };
  });
  return { ...data, cases };
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
  /* Called as the renderer asks the recorded archive for an entry. */
  onRead?: (name: string) => void;
}

interface Run {
  root: HTMLElement;
  /* Each archive the renderer opened through ctx.openZip. */
  opened: RecordedZip[];
  progress: Array<[number, number | null]>;
  rendered: Promise<RenderSummary>;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DATA = withFixtureSummaries(load(readFileSync(join(__dirname, 'render.test.yaml'), 'utf8')) as RenderCases);
const SLD_ID_ID_FIRST = /<p:sldId id="(\d+)" r:id="(\w+)"\/>/g;
const XML_DECLARATION = /^<\?xml\s[^?]*\?>/;
const PICTURE_URL = /^url\("data:image\/(?:png|jpeg|gif|bmp|webp);base64,[A-Za-z0-9+/=]+"\)$/;

type Source = Pick<RenderCase, 'file' | 'deck' | 'bytes'>;

async function deckBytes(source: Source): Promise<ArrayBuffer> {
  if (source.bytes !== undefined) return new Uint8Array(Buffer.from(source.bytes, 'base64')).buffer;
  const bytes = source.file ? readFileSync(join(FIXTURE_DIR, source.file)) : await buildDeck(source.deck ?? {});
  return new Uint8Array(bytes).buffer;
}

async function recordingZip(bytes: ArrayBuffer, onRead?: (name: string) => void): Promise<RecordedZip> {
  const archive = await JSZip.loadAsync(bytes);
  const names = Object.values(archive.files).filter((entry) => !entry.dir).map((entry) => entry.name);
  const reads: string[] = [];
  const entry = (name: string): JSZip.JSZipObject | null => {
    reads.push(name);
    onRead?.(name);
    return archive.file(name);
  };
  return {
    reads,
    zip: {
      names: () => names,
      bytes: async (name) => (await entry(name)?.async('uint8array')) ?? null,
      text: async (name) => {
        const text = await entry(name)?.async('string');
        if (text === undefined) return null;
        return text
          .replace(XML_DECLARATION, (declaration) => declaration.replaceAll("'", '"'))
          .replace(SLD_ID_ID_FIRST, '<p:sldId r:id="$2" id="$1"/>');
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
        const zip = await recordingZip(archive, options.onRead);
        opened.push(zip);
        return zip.zip;
      }),
    requestAsset: async () => null,
    beginDraw: () => () => undefined,
  };
  return { root, opened, progress, rendered: renderer.render(bytes, ctx) };
}

/* How many times the renderer listed a shape tree's p:sp shapes since the spy was cleared. */
function shapeTreeScans(): number {
  return vi.mocked(children).mock.calls.filter(([, name]) => name === 'sp').length;
}

function slideElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('section.pptx-slide'));
}

function shapeWithText(root: HTMLElement, text: string): HTMLElement {
  const shape = Array.from(root.querySelectorAll<HTMLElement>('.pptx-shape')).find((el) => el.textContent === text);
  if (!shape) throw new Error(`No shape reads "${text}"`);
  return shape;
}

/* A paragraph's runs, without the bullet drawn before them. */
function runsOf(paragraph: HTMLElement): HTMLElement[] {
  return Array.from(paragraph.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.localName === 'span' && !el.classList.contains('pptx-bullet'),
  );
}

function paragraphWithText(root: HTMLElement, text: string): HTMLElement {
  const paragraph = Array.from(root.querySelectorAll<HTMLElement>('p.pptx-p')).find(
    (p) => runsOf(p).map((run) => run.textContent).join('') === text,
  );
  if (!paragraph) throw new Error(`No paragraph reads "${text}"`);
  return paragraph;
}

/* The shape box that holds a paragraph reading `text`, so a shape of several
   paragraphs or with bullets is found by any one of its paragraphs. */
function shapeHolding(root: HTMLElement, text: string): HTMLElement {
  const shape = paragraphWithText(root, text).closest<HTMLElement>('.pptx-shape');
  if (!shape) throw new Error(`The paragraph "${text}" is in no shape`);
  return shape;
}

function rect(el: HTMLElement): Rect {
  const { left, top, width, height } = el.style;
  return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) };
}

function box(el: HTMLElement): [string, string, string, string] {
  const { left, top, width, height } = el.style;
  return [left, top, width, height];
}

/* A slide's or shape's fill as backgrounds and fills name it: picture for a
   data: picture stretched over it, tiled and the tile's background-size for
   one repeated in tiles, else its inline background color. */
function fillOf(el: HTMLElement): string {
  const { backgroundImage, backgroundColor, backgroundSize, backgroundRepeat } = el.style;
  if (!backgroundImage.startsWith('url(')) return backgroundColor;
  expect(backgroundImage).toMatch(PICTURE_URL);
  if (backgroundRepeat === 'repeat') return `tiled ${backgroundSize}`;
  expect(backgroundSize).toBe('100% 100%');
  return 'picture';
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
  for (const text of want.textExcludes ?? []) expect(root.textContent).not.toContain(text);
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

function expectStyles(root: HTMLElement, want: CaseExpectation): void {
  if (want.backgrounds !== undefined) expect(slideElements(root).map(fillOf)).toEqual(want.backgrounds);
  for (const [text, fill] of Object.entries(want.fills ?? {})) {
    expect(fillOf(shapeWithText(root, text)), `fill of ${text}`).toBe(fill);
  }
  for (const [text, color] of Object.entries(want.outlines ?? {})) {
    const { style } = shapeWithText(root, text);
    expect([style.borderStyle, style.borderColor], `outline of ${text}`).toEqual(color ? ['solid', color] : ['', '']);
  }
  if (want.lines !== undefined) {
    const lines = Array.from(root.querySelectorAll<HTMLElement>('.pptx-line'), ({ style }) => {
      expect([style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle], 'a line draws its top border only').toEqual(['solid', '', '', '']);
      expect(style.backgroundColor, 'a line has no fill').toBe('');
      return { left: style.left, top: style.top, width: style.width, transform: style.transform, color: style.borderTopColor };
    });
    expect(lines).toEqual(want.lines);
  }
  if (want.crops !== undefined) {
    const crops = Array.from(root.querySelectorAll<HTMLElement>('.pptx-picture-crop'), (frame) => {
      const img = frame.querySelector('img');
      if (!img) throw new Error('A crop box holds no picture');
      expect(img.style.transform, 'rotation and flips stay on the crop box').toBe('');
      return { frame: box(frame), picture: box(img) };
    });
    expect(crops).toEqual(want.crops);
  }
  for (const [text, wanted] of Object.entries(want.boxes ?? {})) {
    expect(box(shapeHolding(root, text)), `box of ${text}`).toEqual(wanted);
  }
  for (const [text, transform] of Object.entries(want.transforms ?? {})) {
    expect(shapeHolding(root, text).style.transform, `transform of ${text}`).toBe(transform);
  }
  for (const [text, anchor] of Object.entries(want.anchors ?? {})) {
    expect(shapeHolding(root, text).style.justifyContent, `anchor of ${text}`).toBe(anchor);
  }
  for (const [text, wanted] of Object.entries(want.paragraphs ?? {})) {
    const paragraph = paragraphWithText(root, text);
    const [run] = runsOf(paragraph);
    const bullet = paragraph.querySelector<HTMLElement>('.pptx-bullet');
    const drawn: Required<ParagraphExpectation> = {
      align: paragraph.style.textAlign,
      bullet: bullet?.textContent ?? '',
      bulletColor: bullet?.style.color ?? '',
      font: run.style.fontFamily,
      color: run.style.color,
    };
    expect(drawn, `paragraph ${text}`).toMatchObject(wanted);
  }
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
  for (const [name, count] of Object.entries(want.readCounts ?? {})) {
    expect(zip.reads.filter((read) => read === name), `reads of ${name}`).toHaveLength(count);
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
    vi.mocked(children).mockClear();
    const run = await startRender(testCase, { limits: testCase.limits });
    if (want.error) {
      await expect(run.rendered).rejects.toMatchObject({ name: 'PreviewError', code: want.error });
      return;
    }

    const summary = await run.rendered;
    if (want.maxShapeTreeScans !== undefined) expect(shapeTreeScans(), 'shape tree scans').toBeLessThanOrEqual(want.maxShapeTreeScans);
    expect(summary.type).toBe('pptx');
    if (want.units !== undefined) expect(summary.units).toBe(want.units);
    if (want.truncated !== undefined) expect(summary.truncated).toBe(want.truncated);
    expect(run.root.querySelector('.pptx-deck')?.firstElementChild?.textContent).toBe(DATA.label);
    expectSlides(run.root, summary, want);
    expectDrawn(run.root, want);
    expectStyles(run.root, want);
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

  it('reports progress after each slide it draws and none past the element cap', async () => {
    const run = await startRender({ deck: { numberedSlides: 3 } }, { limits: { maxSlideElements: 32 } });
    await expect(run.rendered).resolves.toEqual({ type: 'pptx', units: 2, truncated: true });
    expect(run.progress).toEqual([[0, 3], [1, 3], [2, 3]]);
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

  /* three-slides.pptx draws slide3.xml first, then slide1.xml, whose picture
     is ppt/media/swatch.png. */
  it('reads no picture of a slide whose parts were being read when the signal aborted', async () => {
    const controller = new AbortController();
    const run = await startRender(THREE_SLIDES, {
      signal: controller.signal,
      onRead: (name) => {
        if (name === 'ppt/slides/slide1.xml') controller.abort();
      },
    });
    await expect(run.rendered).rejects.toMatchObject({ name: 'AbortError' });
    const { reads } = run.opened[0];
    expect(reads).toContain('ppt/slides/slide1.xml');
    expect(reads.filter((name) => name.startsWith('ppt/media/')), 'pictures read after the abort').toEqual([]);
    expect(slideElements(run.root)).toHaveLength(1);
  });

  it('encodes no picture whose bytes arrive after the signal aborts', async () => {
    const controller = new AbortController();
    const encode = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    try {
      const run = await startRender(THREE_SLIDES, {
        signal: controller.signal,
        onRead: (name) => {
          if (name === 'ppt/media/swatch.png') controller.abort();
        },
      });
      await expect(run.rendered).rejects.toMatchObject({ name: 'AbortError' });
      expect(run.opened[0].reads).toContain('ppt/media/swatch.png');
      expect(encode).not.toHaveBeenCalled();
    } finally {
      encode.mockRestore();
    }
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
