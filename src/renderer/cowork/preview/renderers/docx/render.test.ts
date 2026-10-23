/*
 * The Word renderer, run on the real docx-preview with the harness's .docx
 * fixtures. Every fixture renders, except the ones render.test.yaml lists as
 * parse-failed or unsupported. Single tests swap one docx-preview step for a
 * failure, or wrap it to look at what render() hands it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as docxPreview from 'docx-preview';
import { load } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PreviewLimits, RendererContext } from '../../contract';
import { previewLimits } from '../../limits';
import renderer, { DOCX_OPTIONS, EMPTY_IMAGE } from './render';

vi.mock('docx-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('docx-preview')>();
  return { ...actual, parseAsync: vi.fn(actual.parseAsync), renderDocument: vi.fn(actual.renderDocument) };
});

interface RenderCases { parseFailed: string[]; unsupported: string[] }

const CASES = load(readFileSync(join(__dirname, 'render.test.yaml'), 'utf8')) as RenderCases;
const FIXTURES = join(__dirname, '../../../../../../e2e/document-preview/fixtures/docx');
const DOCX_FILES = readdirSync(FIXTURES).filter((name) => name.endsWith('.docx'));

/* The fixture whose 2,000 drawings name one 480 KB picture. */
const PICTURE_PER_REFERENCE = 'picture-per-reference.docx';
const RENDERED_FILES = DOCX_FILES.filter((name) => !CASES.parseFailed.includes(name) && !CASES.unsupported.includes(name));

/* A data: URL of a PNG whose header says side by side, followed by `padding`
   bytes of zeros. */
function pngOfSize(side: number, padding = 0): string {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, side);
  new DataView(bytes.buffer).setUint32(20, side);
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

/* A CSS url() of anything but a data: or blob: URL or an in-page
   #fragment. */
const LOADING_URL = /url\(\s*["']?(?!\s*(?:data:|blob:|#))/i;

function fixtureBytes(name: string): ArrayBuffer {
  const bytes = readFileSync(join(FIXTURES, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function context(limits: PreviewLimits = previewLimits({ touch: false }), signal = new AbortController().signal): RendererContext {
  const root = document.createElement('div');
  document.body.append(root);
  return {
    root,
    limits,
    signal,
    progress: vi.fn(),
    openZip: vi.fn(),
    requestAsset: vi.fn(async () => null),
  };
}

const MIB = 1024 * 1024;

/* A font's data: URL, `length` characters long. */
function fontUrl(length: number): string {
  const head = 'data:font/ttf;base64,';
  return head + 'A'.repeat(length - head.length);
}

/* Renders title-and-paragraph.docx with a font table that embeds one font
   for each of `lengths`, as a data: URL that long, which renderFontTable
   loads one at a time, each into an @font-face rule of its own. Gives the
   lengths of the fonts loaded and the number of @font-face rules written. */
async function renderEmbeddedFonts(lengths: number[], limits: PreviewLimits): Promise<{ loaded: number[]; faces: number }> {
  const actual = await vi.importActual<typeof import('docx-preview')>('docx-preview');
  const urls = new Map(lengths.map((length, index) => [`rIdFont${index}`, fontUrl(length)]));
  const loaded: number[] = [];
  vi.mocked(docxPreview.parseAsync).mockImplementationOnce(async (data, options) => {
    const wordDocument = await actual.parseAsync(data, options);
    wordDocument.loadFont = async (id: string) => {
      const url = urls.get(id) ?? null;
      loaded.push(url?.length ?? 0);
      return url;
    };
    const key = '{00000000-0000-0000-0000-000000000000}';
    wordDocument.fontTablePart = {
      fonts: [...urls.keys()].map((id, index) => ({ name: `Embedded ${index}`, embedFontRefs: [{ id, key, type: 'regular' }] })),
    };
    return wordDocument;
  });
  const ctx = context(limits);
  await renderer.render(fixtureBytes('title-and-paragraph.docx'), ctx);
  const styleText = Array.from(ctx.root.querySelectorAll('style'), (style) => style.textContent).join('\n');
  return { loaded, faces: styleText.match(/@font-face/g)?.length ?? 0 };
}

/* A source the frame's policy lets an image load. */
const INLINE_SOURCE = /^(?:data|blob):/;

/* An SVG image, which may keep a data: or blob: href: docx-preview draws a
   VML picture as one. */
function isSvgImage(element: Element): boolean {
  return element.namespaceURI === 'http://www.w3.org/2000/svg' && element.localName === 'image';
}

/* Every place in root that still names something to load or open. */
function leftoverTargets(root: HTMLElement): string[] {
  const hrefs = Array.from(root.querySelectorAll('*')).flatMap((element) => (
    Array.from(element.attributes).filter((attribute) => attribute.localName === 'href' && !attribute.value.startsWith('#')
      && !(isSvgImage(element) && INLINE_SOURCE.test(attribute.value)))
  )).map((attribute) => `href=${attribute.value}`);
  const sources = Array.from(root.querySelectorAll('[src]'), (element) => element.getAttribute('src') ?? '')
    .filter((source) => !INLINE_SOURCE.test(source)).map((source) => `src=${source}`);
  /* Any other attribute, such as an SVG fill or stroke, that holds a url() to
     load or a CSS escape that could spell one. */
  const paints = Array.from(root.querySelectorAll('*')).flatMap((element) => (
    Array.from(element.attributes).filter((attribute) => !['href', 'src', 'style'].includes(attribute.localName)
      && (attribute.value.includes('\\') || LOADING_URL.test(attribute.value)))
  )).map((attribute) => `${attribute.localName}=${attribute.value}`);
  const styles = [
    ...Array.from(root.querySelectorAll('style'), (style) => style.textContent ?? ''),
    ...Array.from(root.querySelectorAll('[style]'), (element) => element.getAttribute('style') ?? ''),
  ].filter((text) => LOADING_URL.test(text));
  const embeds = Array.from(root.querySelectorAll('iframe, frame, object, embed, script, link, meta, base'), (element) => element.localName);
  return [...hrefs, ...sources, ...paints, ...styles, ...embeds];
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('the docx renderer', () => {
  it('runs docx-preview with exactly the five locked-down options', async () => {
    expect(DOCX_OPTIONS).toStrictEqual({
      renderAltChunks: false,
      useBase64URL: true,
      renderComments: false,
      renderChanges: false,
      experimental: false,
    });
    const bytes = fixtureBytes('title-and-paragraph.docx');
    await renderer.render(bytes, context());
    expect(docxPreview.parseAsync).toHaveBeenCalledWith(bytes, DOCX_OPTIONS);
    expect(docxPreview.renderDocument).toHaveBeenCalledWith(expect.anything(), DOCX_OPTIONS);
  });

  it('renders one document and reports parse, layout and insert through progress', async () => {
    const ctx = context();
    await expect(renderer.render(fixtureBytes('title-and-paragraph.docx'), ctx)).resolves.toEqual({ type: 'docx', units: 1, truncated: false });
    expect(ctx.root.textContent).toContain('Quarterly summary');
    expect(vi.mocked(ctx.progress).mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });

  it('finds every file render.test.yaml lists among the fixtures', () => {
    expect(DOCX_FILES).toEqual(expect.arrayContaining([...CASES.parseFailed, ...CASES.unsupported]));
  });

  it.each(RENDERED_FILES)('renders %s and leaves nothing in it that loads or opens a URL', async (name) => {
    const ctx = context();
    await renderer.render(fixtureBytes(name), ctx);
    expect(leftoverTargets(ctx.root)).toEqual([]);
  });

  it.each(CASES.parseFailed)('fails %s with parse-failed and inserts nothing', async (name) => {
    const ctx = context();
    await expect(renderer.render(fixtureBytes(name), ctx)).rejects.toMatchObject({ code: 'parse-failed' });
    expect(ctx.root.childNodes).toHaveLength(0);
  });

  it.each(CASES.unsupported)('fails %s with unsupported before docx-preview lays anything out', async (name) => {
    const ctx = context();
    await expect(renderer.render(fixtureBytes(name), ctx)).rejects.toMatchObject({ code: 'unsupported' });
    expect(docxPreview.renderDocument).not.toHaveBeenCalled();
    expect(ctx.root.childNodes).toHaveLength(0);
  });

  it('reads the output budget from ctx.limits', async () => {
    /* 128 inflated bytes buy one node, fewer than any document builds. */
    const ctx = context({ ...previewLimits({ touch: false }), maxInflatedBytes: 128 });
    await expect(renderer.render(fixtureBytes('title-and-paragraph.docx'), ctx)).rejects.toMatchObject({ code: 'unsupported' });
    expect(docxPreview.renderDocument).not.toHaveBeenCalled();
  });

  it('gives each page a stacking context of its own, last of the styles, so a watermark paints in front of the page', async () => {
    const ctx = context();
    await renderer.render(fixtureBytes('vml-watermark.docx'), ctx);
    const styles = Array.from(ctx.root.querySelectorAll('style'), (style) => style.textContent);
    expect(styles.at(-1)).toBe('section.docx { isolation: isolate; }');
    expect(ctx.root.querySelectorAll('section.docx')).toHaveLength(1);
  });

  it('never hands a compound file to docx-preview', async () => {
    await expect(renderer.render(fixtureBytes('compound-file.docx'), context())).rejects.toMatchObject({ code: 'unsupported' });
    expect(docxPreview.parseAsync).not.toHaveBeenCalled();
  });

  it('cleans the nodes and holds links before the frame document adopts them', async () => {
    const ctx = context();
    const holdLinks = vi.spyOn(ctx.root, 'addEventListener');
    const adopt = vi.spyOn(ctx.root, 'append').mockImplementation(function append(this: HTMLElement, ...nodes) {
      const wrapper = document.createElement('div');
      for (const node of nodes) wrapper.append(typeof node === 'string' ? node : node.cloneNode(true));
      expect(leftoverTargets(wrapper)).toEqual([]);
      HTMLElement.prototype.append.apply(this, nodes);
    });
    await renderer.render(fixtureBytes('script-link.docx'), ctx);
    expect(adopt).toHaveBeenCalledOnce();
    expect(holdLinks.mock.calls.map(([type, , capture]) => [type, capture])).toEqual([['click', true], ['auxclick', true], ['keydown', true]]);
    expect(Math.max(...holdLinks.mock.invocationCallOrder)).toBeLessThan(adopt.mock.invocationCallOrder[0]);
  });

  it('answers a picture the file does not hold with an empty data: image, never a URL', async () => {
    let missingPicture: string | null = 'not asked';
    vi.mocked(docxPreview.renderDocument).mockImplementationOnce(async (wordDocument, options) => {
      missingPicture = await wordDocument.loadDocumentImage('rIdNotInTheFile');
      const actual = await vi.importActual<typeof import('docx-preview')>('docx-preview');
      return actual.renderDocument(wordDocument, options);
    });
    await renderer.render(fixtureBytes('title-and-paragraph.docx'), context());
    expect(missingPicture).toMatch(/^data:image\/gif;base64,/);
  });

  it('answers a picture or picture bullet past the image cap, or of no size it can read, with the empty image', async () => {
    const actual = await vi.importActual<typeof import('docx-preview')>('docx-preview');
    /* 23,170 by 23,170 is about 2 GB decoded, past 256 MiB / 4 pixels. */
    const pictures: Record<string, string> = {
      rIdHuge: pngOfSize(23_170),
      rIdSmall: pngOfSize(640),
      rIdTiff: `data:image/tiff;base64,${btoa('II*\u0000\u0008\u0000\u0000\u0000')}`,
      rIdHugeBullet: pngOfSize(23_170),
    };
    vi.mocked(docxPreview.parseAsync).mockImplementationOnce(async (data, options) => {
      const wordDocument = await actual.parseAsync(data, options);
      wordDocument.getPathById = (_part: unknown, id: string) => `word/media/${id}`;
      wordDocument.loadDocumentImage = async (id: string) => pictures[id] ?? null;
      wordDocument.loadNumberingImage = async (id: string) => pictures[id] ?? null;
      return wordDocument;
    });
    let shown: (string | null)[] = [];
    vi.mocked(docxPreview.renderDocument).mockImplementationOnce(async (wordDocument, options) => {
      shown = await Promise.all([
        ...['rIdHuge', 'rIdSmall', 'rIdTiff'].map((id) => wordDocument.loadDocumentImage(id)),
        wordDocument.loadNumberingImage('rIdHugeBullet'),
      ]);
      return actual.renderDocument(wordDocument, options);
    });
    await renderer.render(fixtureBytes('title-and-paragraph.docx'), context());
    expect(shown).toEqual([EMPTY_IMAGE, expect.stringMatching(/^blob:/), EMPTY_IMAGE, EMPTY_IMAGE]);
  });

  it('shows a picture and a picture bullet each through a blob: URL of its bytes and media type', async () => {
    const actual = await vi.importActual<typeof import('docx-preview')>('docx-preview');
    const picture = pngOfSize(640, 100);
    vi.mocked(docxPreview.parseAsync).mockImplementationOnce(async (data, options) => {
      const wordDocument = await actual.parseAsync(data, options);
      wordDocument.getPathById = (_part: unknown, id: string) => `word/media/${id}`;
      wordDocument.loadDocumentImage = async () => picture;
      wordDocument.loadNumberingImage = async () => picture;
      return wordDocument;
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    let shown: (string | null)[] = [];
    vi.mocked(docxPreview.renderDocument).mockImplementationOnce(async (wordDocument, options) => {
      shown = [await wordDocument.loadDocumentImage('rIdPicture'), await wordDocument.loadNumberingImage('rIdBullet')];
      return actual.renderDocument(wordDocument, options);
    });
    await renderer.render(fixtureBytes('title-and-paragraph.docx'), context());
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(shown).toEqual(createObjectURL.mock.results.map((result) => result.value));
    for (const [blob] of createObjectURL.mock.calls as [Blob][]) {
      expect(blob.type).toBe('image/png');
      expect(Buffer.from(await blob.arrayBuffer())).toEqual(Buffer.from(picture.slice(picture.indexOf(',') + 1), 'base64'));
    }
  });

  it(`loads the one picture ${PICTURE_PER_REFERENCE}'s 2,000 drawings name once, through either relationship id, and leaves nothing that loads a URL`, async () => {
    const actual = await vi.importActual<typeof import('docx-preview')>('docx-preview');
    const picture = pngOfSize(8);
    const loads: (string | null)[] = [];
    /* Stands in for docx-preview's own loader, which would inflate the
       480 KB part and encode it again on each call. */
    vi.mocked(docxPreview.parseAsync).mockImplementationOnce(async (data, options) => {
      const wordDocument = await actual.parseAsync(data, options);
      wordDocument.loadDocumentImage = async (id: string, part?: unknown) => {
        loads.push(wordDocument.getPathById(part ?? wordDocument.documentPart, id));
        return picture;
      };
      return wordDocument;
    });
    const ctx = context();
    await renderer.render(fixtureBytes(PICTURE_PER_REFERENCE), ctx);
    expect(loads).toEqual(['word/media/image1.bmp']);
    const sources = Array.from(ctx.root.querySelectorAll('img'), (image) => image.getAttribute('src'));
    expect(sources).toHaveLength(2_000);
    expect(new Set(sources).size).toBe(1);
    expect(sources[0]).toMatch(/^blob:/);
    expect(leftoverTargets(ctx.root)).toEqual([]);
  });

  it(`makes one blob: URL for the picture ${PICTURE_PER_REFERENCE}'s 2,000 drawings name, and shows it in every drawing`, async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const ctx = context();
    await renderer.render(fixtureBytes(PICTURE_PER_REFERENCE), ctx);
    expect(createObjectURL).toHaveBeenCalledOnce();
    const sources = Array.from(ctx.root.querySelectorAll('img'), (image) => image.getAttribute('src'));
    expect(sources).toHaveLength(2_000);
    expect(new Set(sources)).toEqual(new Set([createObjectURL.mock.results[0].value]));
  });

  it('writes a picture bullet into style text as a blob: URL, which cleaning keeps', async () => {
    const actual = await vi.importActual<typeof import('docx-preview')>('docx-preview');
    const bullet = pngOfSize(8, 100);
    /* happy-dom's XML parser loses the namespaced attributes docx-preview
       reads numbering.xml by, so this level stands in for the one it parses
       from a real file, such as picture-bullet-per-paragraph.docx. */
    vi.mocked(docxPreview.parseAsync).mockImplementationOnce(async (data, options) => {
      const wordDocument = await actual.parseAsync(data, options);
      wordDocument.getPathById = (_part: unknown, id: string) => `word/media/${id}`;
      wordDocument.loadNumberingImage = async () => bullet;
      wordDocument.numberingPart = {
        domNumberings: [{ id: '1', level: 0, bullet: { src: 'rIdBullet', style: 'width:9pt;height:9pt' }, pStyle: {}, rStyle: {} }],
      };
      return wordDocument;
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const ctx = context();
    await renderer.render(fixtureBytes('title-and-paragraph.docx'), ctx);
    expect(createObjectURL).toHaveBeenCalledOnce();
    const styleText = Array.from(ctx.root.querySelectorAll('style'), (style) => style.textContent).join('\n');
    expect(styleText).toContain(`--docx-ridbullet: url(${createObjectURL.mock.results[0].value})`);
    expect(styleText).toContain('background: var(--docx-ridbullet)');
    expect(styleText).not.toContain('data:image/png');
  });

  it('copies embedded fonts\' data: URLs into style text up to maxInflatedBytes / 16 characters, then loads no more', async () => {
    /* 16 MiB of inflated bytes buy 1 MiB of font URLs. Two halves fill it
       exactly, so the small font after them fails before it loads. */
    const limits = { ...previewLimits({ touch: false }), maxInflatedBytes: 16 * MIB };
    await expect(renderEmbeddedFonts([MIB / 2, MIB / 2, 1_000], limits)).resolves.toEqual({ loaded: [MIB / 2, MIB / 2], faces: 2 });
  });

  it('fails the first embedded font whose data: URL would pass the budget, and each later one before it loads', async () => {
    const limits = { ...previewLimits({ touch: false }), maxInflatedBytes: 16 * MIB };
    await expect(renderEmbeddedFonts([MIB / 2, MIB / 2 + 1, 1_000], limits)).resolves.toEqual({ loaded: [MIB / 2, MIB / 2 + 1], faces: 1 });
  });

  it('fails with parse-failed when docx-preview cannot read the file', async () => {
    vi.mocked(docxPreview.parseAsync).mockRejectedValueOnce(new Error('end of central directory not found'));
    const ctx = context();
    await expect(renderer.render(fixtureBytes('title-and-paragraph.docx'), ctx)).rejects.toMatchObject({ code: 'parse-failed' });
    expect(ctx.root.childNodes).toHaveLength(0);
  });

  it('fails with parse-failed when docx-preview cannot lay the file out', async () => {
    vi.mocked(docxPreview.renderDocument).mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'body')"));
    const ctx = context();
    await expect(renderer.render(fixtureBytes('title-and-paragraph.docx'), ctx)).rejects.toMatchObject({ code: 'parse-failed' });
    expect(ctx.root.childNodes).toHaveLength(0);
  });

  it('stops with the abort reason, not parse-failed, when the preview is stopped while parsing', async () => {
    const controller = new AbortController();
    vi.mocked(docxPreview.parseAsync).mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('stopped mid-parse');
    });
    const ctx = context(undefined, controller.signal);
    const error: unknown = await renderer.render(fixtureBytes('title-and-paragraph.docx'), ctx).catch((reason: unknown) => reason);
    expect(error).toBe(controller.signal.reason);
    expect(ctx.root.childNodes).toHaveLength(0);
  });

  it('inserts nothing when the preview is stopped while laying out', async () => {
    const controller = new AbortController();
    vi.mocked(docxPreview.renderDocument).mockImplementationOnce(async () => {
      controller.abort();
      return [document.createElement('section')];
    });
    const ctx = context(undefined, controller.signal);
    const error: unknown = await renderer.render(fixtureBytes('title-and-paragraph.docx'), ctx).catch((reason: unknown) => reason);
    expect(error).toBe(controller.signal.reason);
    expect(ctx.root.childNodes).toHaveLength(0);
  });
});
