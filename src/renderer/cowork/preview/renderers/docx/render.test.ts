/*
 * The Word renderer, run on the real docx-preview with the harness's .docx
 * fixtures. Every fixture renders, except the ones render.test.yaml lists as
 * parse-failed. Single tests swap one docx-preview step for a failure, or wrap
 * it to look at what render() hands it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as docxPreview from 'docx-preview';
import { load } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RendererContext } from '../../contract';
import { previewLimits } from '../../limits';
import renderer, { DOCX_OPTIONS } from './render';

vi.mock('docx-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('docx-preview')>();
  return { ...actual, parseAsync: vi.fn(actual.parseAsync), renderDocument: vi.fn(actual.renderDocument) };
});

interface RenderCases { parseFailed: string[] }

const CASES = load(readFileSync(join(__dirname, 'render.test.yaml'), 'utf8')) as RenderCases;
const FIXTURES = join(__dirname, '../../../../../../e2e/document-preview/fixtures/docx');
const DOCX_FILES = readdirSync(FIXTURES).filter((name) => name.endsWith('.docx'));
const RENDERED_FILES = DOCX_FILES.filter((name) => !CASES.parseFailed.includes(name));

/* A CSS url() of anything but a data: URL or an in-page #fragment. */
const LOADING_URL = /url\(\s*["']?(?!\s*(?:data:|#))/i;

function fixtureBytes(name: string): ArrayBuffer {
  const bytes = readFileSync(join(FIXTURES, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function context(signal = new AbortController().signal): RendererContext {
  const root = document.createElement('div');
  document.body.append(root);
  return {
    root,
    limits: previewLimits({ touch: false }),
    signal,
    progress: vi.fn(),
    openZip: vi.fn(),
    requestAsset: vi.fn(async () => null),
  };
}

/* Every place in root that still names something to load or open. */
function leftoverTargets(root: HTMLElement): string[] {
  const hrefs = Array.from(root.querySelectorAll('*')).flatMap((element) => (
    Array.from(element.attributes).filter((attribute) => attribute.localName === 'href' && !attribute.value.startsWith('#'))
  )).map((attribute) => `href=${attribute.value}`);
  const sources = Array.from(root.querySelectorAll('[src]'), (element) => element.getAttribute('src') ?? '')
    .filter((source) => !source.startsWith('data:')).map((source) => `src=${source}`);
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

  it('finds every file render.test.yaml lists as parse-failed among the fixtures', () => {
    expect(DOCX_FILES).toEqual(expect.arrayContaining(CASES.parseFailed));
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
    const ctx = context(controller.signal);
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
    const ctx = context(controller.signal);
    const error: unknown = await renderer.render(fixtureBytes('title-and-paragraph.docx'), ctx).catch((reason: unknown) => reason);
    expect(error).toBe(controller.signal.reason);
    expect(ctx.root.childNodes).toHaveLength(0);
  });
});
