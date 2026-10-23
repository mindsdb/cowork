/*
 * The xlsx renderer against real SheetJS and happy-dom: the committed preview
 * fixtures, plus small workbooks built here with the same generator. SheetJS
 * runs with the edits build.config.mjs makes to it, as in the preview bundle.
 * The entries in fixtures.yaml are checked here against the renderer alone, so
 * a wrong expectation shows up before the browser spec runs it in the preview
 * frame.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import JSZip from 'jszip';
import { load } from 'js-yaml';
import { read, utils, version, write, type WorkBook } from 'xlsx';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { PreviewFixture } from '../../../../../../e2e/document-preview/harness';
import { buildWorkbook, withUnicodePaths, type FixtureSheet, type FixtureWorkbook } from '../../../../../../e2e/document-preview/fixtures/xlsx/make-fixtures.mjs';
import type { PreviewErrorCode, PreviewLimits, RenderSummary, RendererContext } from '../../contract';
import { isPreviewError } from '../../errors';
import { previewLimits } from '../../limits';
import renderer from './render';

/* SheetJS as the preview bundle ships it: its module with each
   build.config.mjs plugin's transform applied, loaded from a data: URL. */
const { shippedSheetjs } = vi.hoisted(() => ({
  async shippedSheetjs(): Promise<typeof import('xlsx')> {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const id = join(__dirname, '../../../../../../node_modules/xlsx/xlsx.mjs');
    const config: { default: { plugins: TransformPlugin[] } } = await import(pathToFileURL(join(__dirname, 'build.config.mjs')).href);
    const code = config.default.plugins.reduce((text, plugin) => plugin.transform(text, id)?.code ?? text, readFileSync(id, 'utf8'));
    return import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  },
}));

/* SheetJS fills its defaults into the options object it gets, so the spy hands
   it a copy and keeps the caller's object as the caller wrote it. */
vi.mock('xlsx', async () => {
  const shipped = await shippedSheetjs();
  return { ...shipped, read: vi.fn((data: unknown, options?: object) => shipped.read(data, { ...options })) };
});

interface TransformPlugin { transform(code: string, id: string): { code: string } | null }

interface CodeCheck { name: string; pattern: string; flags?: string; matches?: string[]; skips?: string[] }

interface TestContext extends RendererContext {
  progress: Mock<RendererContext['progress']>;
  openZip: Mock<RendererContext['openZip']>;
  requestAsset: Mock<RendererContext['requestAsset']>;
}

/* How render() ended, in the terms of a fixture's expectation. */
type RenderEnding = { outcome: 'rendered'; summary: RenderSummary } | { outcome: 'error'; errorCode: PreviewErrorCode };

const FIXTURES = join(__dirname, '../../../../../../e2e/document-preview/fixtures/xlsx');
const FIXTURE_LIST = load(readFileSync(join(FIXTURES, 'fixtures.yaml'), 'utf8')) as PreviewFixture[];
const SOURCE_CHECKS = (load(readFileSync(join(__dirname, 'code-checks.yaml'), 'utf8')) as { source: CodeCheck[] }).source;

function fixture(file: string): ArrayBuffer {
  return new Uint8Array(readFileSync(join(FIXTURES, file))).buffer;
}

async function workbook(...sheets: FixtureSheet[]): Promise<ArrayBuffer> {
  return (await buildWorkbook({ sheets })).buffer as ArrayBuffer;
}

async function workbookOf(book: FixtureWorkbook): Promise<ArrayBuffer> {
  return (await buildWorkbook(book)).buffer as ArrayBuffer;
}

/* The archive with each named part added or replaced, and each part named
   null removed. JSZip writes each name as given. */
async function withParts(bytes: ArrayBuffer, parts: Record<string, string | Uint8Array | null>): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(bytes);
  for (const [name, data] of Object.entries(parts)) {
    if (data === null) zip.remove(name);
    else zip.file(name, data);
  }
  return (await zip.generateAsync({ type: 'uint8array' })).buffer as ArrayBuffer;
}

/* The text of one part of the archive. */
async function partText(bytes: ArrayBuffer, name: string): Promise<string> {
  const text = await (await JSZip.loadAsync(bytes)).file(name)?.async('string');
  if (text === undefined) throw new Error(`The archive has no ${name}`);
  return text;
}

/* A sheet whose cell at row r, column c (both from 0) reads `r,c`. */
function grid(name: string, rows: number, columns: number): FixtureSheet {
  return { name, rows: Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => `${r},${c}`)) };
}

/* A one-sheet workbook from SheetJS's own .xlsx or .xlsb writer. */
function sheetjsWorkbook(bookType: 'xlsx' | 'xlsb'): ArrayBuffer {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet([['written']]), 'Written');
  return write(book, { type: 'array', bookType }) as ArrayBuffer;
}

const BINARY_WORKBOOK_TYPE = 'application/vnd.ms-excel.sheet.binary.macroEnabled.main';
const XLSX_WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

/* SheetJS's own .xlsb with its workbook part moved to `part`, where no name
   check looks, and a stand-in xl/workbook.xml beside it. contentTypes gets
   the [Content_Types].xml text that names the moved part and returns the
   part as the archive holds it. */
async function movedBinaryWorkbook(part: string, contentTypes: (text: string) => string | Uint8Array): Promise<ArrayBuffer> {
  const xlsb = sheetjsWorkbook('xlsb');
  const types = (await partText(xlsb, '[Content_Types].xml')).replace('/xl/workbook.bin', `/${part}`);
  const relationships = (await partText(xlsb, '_rels/.rels')).replace('xl/workbook.bin', part);
  const workbookPart = await (await JSZip.loadAsync(xlsb)).file('xl/workbook.bin')?.async('uint8array');
  if (!workbookPart) throw new Error("SheetJS's .xlsb has no xl/workbook.bin");
  return withParts(xlsb, {
    'xl/workbook.bin': null,
    [part]: workbookPart,
    'xl/workbook.xml': '<workbook/>',
    '[Content_Types].xml': contentTypes(types),
    '_rels/.rels': relationships,
  });
}

/* Content types that give the moved part the .xlsx workbook's type, so only
   its name ending in bin sends SheetJS to its binary reader. */
function asXlsxWorkbook(contentTypes: string): string {
  return contentTypes.replaceAll(BINARY_WORKBOOK_TYPE, XLSX_WORKBOOK_TYPE);
}

/* Text saved as UTF-16 with its byte order mark, as SheetJS can read a part. */
function utf16(text: string): Uint8Array {
  return new Uint8Array([0xff, 0xfe, ...Buffer.from(text, 'utf16le')]);
}

/* Text saved one byte per character, so a no-break space is the lone byte
   0xA0, which SheetJS reads as whitespace. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function context(limits: Partial<PreviewLimits> = {}, signal = new AbortController().signal): TestContext {
  return {
    root: document.createElement('div'),
    limits: { ...previewLimits({ touch: false }), ...limits },
    signal,
    progress: vi.fn(),
    openZip: vi.fn(),
    requestAsset: vi.fn(),
  };
}

function tabs(ctx: RendererContext): HTMLButtonElement[] {
  return [...ctx.root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

function visiblePanel(ctx: RendererContext): HTMLElement {
  const shown = [...ctx.root.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter((panel) => !panel.hidden);
  expect(shown).toHaveLength(1);
  return shown[0];
}

/* The visible grid's body cells, row by row. */
function cellTexts(ctx: RendererContext): string[][] {
  return [...visiblePanel(ctx).querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((td) => td.textContent ?? ''));
}

/* Whatever render() rejected with, unchecked: an abort rejects with the
   signal's reason, which is not a PreviewError. */
async function renderRejection(bytes: ArrayBuffer, ctx = context()): Promise<unknown> {
  return renderer.render(bytes, ctx).then(
    () => { throw new Error('render() resolved'); },
    (error: unknown) => error,
  );
}

/* A rejection that isPreviewError doesn't recognize ends as internal, as the
   runtime reports it. */
async function renderEnding(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderEnding> {
  return renderer.render(bytes, ctx).then(
    (summary): RenderEnding => ({ outcome: 'rendered', summary }),
    (error: unknown): RenderEnding => ({ outcome: 'error', errorCode: isPreviewError(error) ? error.code : 'internal' }),
  );
}

/* The text a reader sees, close to the frame body's innerText that the harness
   reads: every text node outside the style sheet and hidden panels, one per
   line, so the text of neighbouring cells never runs together. */
function shownText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node instanceof Element && (node.localName === 'style' || node.hasAttribute('hidden'))
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT),
  });
  const lines: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) lines.push(node.textContent ?? '');
  }
  return lines.join('\n');
}

/* Lets every task queued so far run, so a grid that builds a batch of rows per
   task gets as far as it will. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/* Each test counts only its own SheetJS reads and progress reports. */
afterEach(() => {
  vi.clearAllMocks();
});

describe('xlsx renderer module', () => {
  it('renders the xlsx type', () => {
    expect(renderer.type).toBe('xlsx');
  });

  it('runs on the vendored SheetJS 0.20.3, not the npm registry 0.18.5', () => {
    expect(version).toBe('0.20.3');
  });
});

describe('xlsx renderer', () => {
  it('parses with SheetJS dense, with HTML, styles, cell text and formulas off and number formats kept, cut at ctx.limits.maxSheetRows', async () => {
    await renderer.render(fixture('two-sheets.xlsx'), context({ maxSheetRows: 1234 }));
    const options = {
      type: 'array', dense: true, cellHTML: false, cellStyles: false, cellText: false, cellNF: true, cellFormula: false, sheetRows: 1234,
    };
    expect(vi.mocked(read).mock.calls).toEqual([
      [expect.any(Uint8Array), { ...options, sheets: [0] }],
      [expect.any(Uint8Array), { ...options, sheets: [1] }],
    ]);
  });

  /* Each read inflates the whole archive again, so the reads are capped. */
  it.each([
    { sheetCount: 4, runs: [[0], [1], [2], [3]] },
    { sheetCount: 15, runs: [[0], [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14]] },
  ])('reads $sheetCount sheets in $runs.length reads, and every tab shows its own sheet', async ({ sheetCount, runs }) => {
    const names = Array.from({ length: sheetCount }, (_, i) => `S${i + 1}`);
    const ctx = context();
    const summary = await renderer.render(await workbook(...names.map((name) => ({ name, rows: [[name]] }))), ctx);

    expect(summary.units).toBe(sheetCount);
    expect(vi.mocked(read).mock.calls.map(([, options]) => options?.sheets)).toEqual(runs);
    expect(tabs(ctx).map((tab) => tab.textContent)).toEqual(names);
    for (const [i, name] of names.entries()) {
      tabs(ctx)[i].click();
      expect(cellTexts(ctx)).toEqual([[name]]);
    }
  });

  it('shows the two-sheet workbook as two tabs, and the second tab shows its cells', async () => {
    const ctx = context();
    const summary = await renderer.render(fixture('two-sheets.xlsx'), ctx);

    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 2, truncated: false });
    expect(tabs(ctx).map((tab) => tab.textContent)).toEqual(['Regions', 'Products']);
    expect(tabs(ctx).map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect([...visiblePanel(ctx).querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['', 'A', 'B']);
    expect([...visiblePanel(ctx).querySelectorAll('tbody th')].map((th) => th.textContent)).toEqual(['1', '2', '3']);
    expect(cellTexts(ctx)).toEqual([['Region', 'Revenue'], ['North', '120'], ['South', '95']]);

    tabs(ctx)[1].click();

    expect(tabs(ctx).map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(cellTexts(ctx)).toEqual([['Product', 'Units'], ['Widget', '40'], ['Gadget', '12']]);
    expect(visiblePanel(ctx).getAttribute('aria-labelledby')).toBe(tabs(ctx)[1].id);

    tabs(ctx)[0].click();

    expect(cellTexts(ctx)[1]).toEqual(['North', '120']);
  });

  /* render() keeps no cells of a later sheet, so its tab reads it again each
     time it opens. */
  it('reads a later sheet again each time its tab opens, and never reads the first sheet again', async () => {
    const ctx = context();
    await renderer.render(await workbook({ name: 'One', rows: [['one']] }, { name: 'Two', rows: [['two']] }, { name: 'Three', rows: [['three']] }), ctx);
    const sheetsRead = (): unknown[] => vi.mocked(read).mock.calls.map(([, options]) => options?.sheets);

    expect(sheetsRead()).toEqual([[0], [1], [2]]);

    tabs(ctx)[2].click();
    tabs(ctx)[1].click();
    tabs(ctx)[1].click();
    tabs(ctx)[0].click();
    tabs(ctx)[1].click();

    expect(sheetsRead()).toEqual([[0], [1], [2], [2], [1], [1]]);
    expect(cellTexts(ctx)).toEqual([['two']]);
  });

  /* A later read that throws something other than a PreviewError leaves no
     panel behind, so the next click on its tab reads the sheet again. */
  it('reads a later sheet again on the next click after its read throws', async () => {
    const ctx = context();
    await renderer.render(await workbook({ name: 'One', rows: [['one']] }, { name: 'Two', rows: [['two']] }), ctx);
    vi.mocked(read).mockImplementationOnce(() => null as unknown as WorkBook);

    expect(() => tabs(ctx)[1].click()).toThrow(TypeError);
    tabs(ctx)[1].click();

    expect(cellTexts(ctx)).toEqual([['two']]);
  });

  it('shows a note in a later tab whose read fails when the tab opens', async () => {
    const ctx = context();
    await renderer.render(await workbook({ name: 'One', rows: [['one']] }, { name: 'Two', rows: [['two']] }), ctx);
    vi.mocked(read).mockImplementationOnce(() => { throw new Error('the read failed'); });

    tabs(ctx)[1].click();

    expect(visiblePanel(ctx).textContent).toBe('This sheet could not be read.');

    tabs(ctx)[0].click();
    tabs(ctx)[1].click();

    expect(cellTexts(ctx)).toEqual([['two']]);
  });

  it('keeps only the first grid and the open tab\'s grid, and builds a left tab again when it reopens', async () => {
    const ctx = context();
    await renderer.render(await workbook({ name: 'One', rows: [['one']] }, { name: 'Two', rows: [['two']] }, { name: 'Three', rows: [['three']] }), ctx);
    const firstPanel = visiblePanel(ctx);
    const panelIds = (): string[] => [...ctx.root.querySelectorAll('[role="tabpanel"]')].map((panel) => panel.id);

    tabs(ctx)[1].click();
    tabs(ctx)[2].click();

    expect(panelIds()).toEqual(['xlsx-panel-0', 'xlsx-panel-2']);

    tabs(ctx)[1].click();

    expect(panelIds()).toEqual(['xlsx-panel-0', 'xlsx-panel-1']);
    expect(cellTexts(ctx)).toEqual([['two']]);

    tabs(ctx)[0].click();

    expect(panelIds()).toEqual(['xlsx-panel-0']);
    expect(visiblePanel(ctx)).toBe(firstPanel);
  });

  /* A tab opens after render() resolved, when no watchdog runs, so a later
     grid never holds the frame for all its rows at once. */
  it('builds a later sheet\'s grid a batch of rows per task, and stops once its tab is left', async () => {
    const ctx = context();
    await renderer.render(await workbook(grid('First', 1, 1), grid('Rows', 250, 1)), ctx);

    tabs(ctx)[1].click();

    expect(cellTexts(ctx)).toHaveLength(100);
    await settle();
    expect(cellTexts(ctx)).toHaveLength(250);
    expect(cellTexts(ctx)[249]).toEqual(['249,0']);

    tabs(ctx)[0].click();
    tabs(ctx)[1].click();
    const leftPanel = visiblePanel(ctx);
    tabs(ctx)[0].click();
    await settle();

    expect(leftPanel.querySelectorAll('tbody tr')).toHaveLength(100);
  });

  /* The checks read the archive with SheetJS's own zip reader, which names
     every entry as read() does, so they never read JSZip's names for it. */
  it('reads the archive only through SheetJS, never through ctx.openZip, and asks for no asset', async () => {
    const ctx = context();
    await renderer.render(fixture('two-sheets.xlsx'), ctx);
    expect(ctx.openZip).not.toHaveBeenCalled();
    expect(ctx.requestAsset).not.toHaveBeenCalled();
  });

  /* Each part here sends SheetJS to a reader other than its .xlsx one, or
     feeds one (see checkPackage). Each sits beside a valid workbook, so only
     the refusal keeps the file from SheetJS. */
  it.each([
    { label: 'META-INF/manifest.xml', name: 'META-INF/manifest.xml' },
    { label: 'a manifest named in mixed case', name: 'meta-inf/MANIFEST.XML' },
    { label: 'a manifest named with a leading slash', name: '/META-INF/manifest.xml' },
    { label: 'a manifest named under Root Entry/', name: 'Root Entry/META-INF/manifest.xml' },
    { label: 'a manifest named with a backslash', name: 'META-INF\\manifest.xml' },
    { label: 'objectdata.xml', name: 'objectdata.xml' },
    { label: 'content.xml, which an unlisted manifest would send SheetJS to', name: 'content.xml' },
    { label: 'Index/Document.iwa', name: 'Index/Document.iwa' },
    { label: 'any .iwa entry', name: 'Data/Tables.IWA' },
    { label: 'an Index.zip entry in a folder', name: 'docs/INDEX.ZIP' },
    { label: 'an Index.zip entry with a NUL in its name', name: 'Ind\0ex.zip' },
    { label: 'a binary workbook part', name: 'xl/workbook.bin' },
  ])('fails with unsupported for a workbook beside $label, and never hands it to SheetJS', async ({ name }) => {
    const ctx = context();
    const bytes = await withParts(await workbook(grid('Kept', 1, 1)), { [name]: 'x' });
    expect(await renderEnding(bytes, ctx)).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'unsupported' });
    expect(read).not.toHaveBeenCalled();
    expect(ctx.root.childElementCount).toBe(0);
  });

  it.each([
    { label: 'no [Content_Types].xml', part: '[Content_Types].xml' },
    { label: 'no xl/workbook.xml', part: 'xl/workbook.xml' },
  ])('fails with unsupported for a zip with $label, and never hands it to SheetJS', async ({ part }) => {
    const bytes = await withParts(await workbook(grid('Kept', 1, 1)), { [part]: null });
    expect(await renderEnding(bytes, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'unsupported' });
    expect(read).not.toHaveBeenCalled();
  });

  /* JSZip lists an entry under the name a Unicode Path extra field gives it,
     while SheetJS reads the name in the entry's local header. */
  it('fails with unsupported for OpenDocument parts renamed by Unicode Path fields, and never hands it to SheetJS', async () => {
    const ctx = context();
    const bytes = fixture('unicode-path-parts.xlsx');
    const listed = Object.keys((await JSZip.loadAsync(bytes)).files);
    expect(listed).toEqual(expect.arrayContaining(['customXml/item1.xml', 'customXml/item2.xml', 'styles.xml']));
    expect(listed.filter((name) => name === 'META-INF/manifest.xml' || name === 'content.xml')).toEqual([]);
    expect(await renderEnding(bytes, ctx)).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'unsupported' });
    expect(read).not.toHaveBeenCalled();
  });

  /* The archive guard compares no flags between an entry's local header and
     its directory record, and SheetJS's zip reader refuses an entry whose
     local header says it is encrypted. */
  it('fails with parse-failed for an archive SheetJS\'s zip reader refuses, keeps its error as the cause, and never parses it', async () => {
    const bytes = new Uint8Array(await workbook(grid('Kept', 1, 1)));
    bytes[6] |= 0x01;
    const error = await renderRejection(bytes.buffer as ArrayBuffer);
    if (!isPreviewError(error)) throw new Error('render() rejected with something other than a PreviewError');
    expect(error.code).toBe('parse-failed');
    expect(error.cause).toBeInstanceOf(Error);
    expect(read).not.toHaveBeenCalled();
  });

  it('still shows a workbook beside parts no other reader takes', async () => {
    const ctx = context();
    const bytes = await withParts(await workbook(grid('Kept', 1, 1)), { 'docProps/app.xml': '<Properties/>', 'customXml/item1.xml': '<x/>' });
    expect(await renderEnding(bytes, ctx)).toEqual<RenderEnding>({ outcome: 'rendered', summary: { type: 'xlsx', units: 1, truncated: false } });
    expect(cellTexts(ctx)).toEqual([['0,0']]);
  });

  /* SheetJS reads as .xlsb whatever part its content types name as the
     workbook, when that name ends in bin. Each archive here holds SheetJS's
     own binary workbook under a name the part name check doesn't refuse. */
  it.each([
    { label: 'the binary workbook type', part: 'xl/book.bin', contentTypes: (text: string): string | Uint8Array => text },
    { label: 'the .xlsx workbook type', part: 'xl/book.bin', contentTypes: asXlsxWorkbook },
    { label: 'the .xlsx workbook type, in UTF-16', part: 'xl/book.bin', contentTypes: (text: string) => utf16(asXlsxWorkbook(text)) },
    { label: 'the .xlsx workbook type, with a > in the part name', part: 'xl/a>b.bin', contentTypes: asXlsxWorkbook },
    {
      label: 'the binary workbook type, with a lone 0xA0 byte between its attributes',
      part: 'xl/book.bin',
      contentTypes: (text: string) => latin1(text.replace('PartName="/xl/book.bin" ContentType=', 'PartName="/xl/book.bin"\u00a0ContentType=')),
    },
  ])('fails with unsupported for content types that name a binary workbook part under $label, and never hands it to SheetJS', async ({ part, contentTypes }) => {
    const ctx = context();
    expect(await renderEnding(await movedBinaryWorkbook(part, contentTypes), ctx)).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'unsupported' });
    expect(read).not.toHaveBeenCalled();
    expect(ctx.root.childElementCount).toBe(0);
  });

  /* SheetJS's .xlsx writer gives the bin extension the binary workbook's
     content type in a Default entry, which names no workbook. */
  it('still shows a workbook SheetJS\'s own .xlsx writer saved', async () => {
    const ctx = context();
    const bytes = sheetjsWorkbook('xlsx');
    expect(await partText(bytes, '[Content_Types].xml')).toContain(`<Default Extension="bin" ContentType="${BINARY_WORKBOOK_TYPE}"/>`);
    expect(await renderEnding(bytes, ctx)).toEqual<RenderEnding>({ outcome: 'rendered', summary: { type: 'xlsx', units: 1, truncated: false } });
    expect(cellTexts(ctx)).toEqual([['written']]);
  });

  /* The hostile fixture's text, markup shown as written and cached values
     only, is checked from fixtures.yaml below. This checks what the text can't
     show: after a click on every element, as the harness does for a hostile
     fixture, both sheets' grids hold no link and nothing that loads, and
     nothing was fetched. */
  it('turns no hyperlinked or markup cell into a link or a load, even after every element is clicked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const startUrl = window.location.href;
    const ctx = context();
    await renderer.render(fixture('hostile.xlsx'), ctx);

    for (const node of ctx.root.querySelectorAll<HTMLElement>('*')) node.click();

    expect(ctx.root.querySelectorAll('[role="tabpanel"]')).toHaveLength(2);
    expect(ctx.root.querySelectorAll('a, area, img, iframe, object, embed, script, link, form')).toHaveLength(0);
    expect(ctx.root.querySelectorAll('[href], [src], [action], [formaction], [background]')).toHaveLength(0);
    for (const node of ctx.root.querySelectorAll('*')) {
      for (const { name, value } of node.attributes) {
        expect(`${name}=${value}`).not.toMatch(/:\/\/|javascript:|example\.com/i);
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.location.href).toBe(startUrl);
    fetchSpy.mockRestore();
  });

  it.each([
    { label: 'past the row cap', sheet: grid('Long', 6, 3), rows: 4, columns: 3, truncated: true },
    { label: 'past the row cap with no <dimension>', sheet: { ...grid('Long', 6, 3), omitDimension: true }, rows: 4, columns: 3, truncated: true },
    { label: 'past the column cap', sheet: grid('Wide', 3, 5), rows: 3, columns: 3, truncated: true },
    { label: 'filling the row cap exactly', sheet: grid('Tall', 4, 3), rows: 4, columns: 3, truncated: true },
    { label: 'one row under the row cap, at the column cap', sheet: grid('Full', 3, 3), rows: 3, columns: 3, truncated: false },
  ])('shows a sheet $label from A1 up to the caps in ctx.limits', async ({ sheet, rows, columns, truncated }) => {
    const ctx = context({ maxSheetRows: 4, maxSheetColumns: 3 });
    const summary = await renderer.render(await workbook(sheet), ctx);

    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 1, truncated });
    const cells = cellTexts(ctx);
    expect(cells).toHaveLength(rows);
    expect(cells.every((row) => row.length === columns)).toBe(true);
    expect(cells[0][0]).toBe('0,0');
    expect(cells[rows - 1][columns - 1]).toBe(`${rows - 1},${columns - 1}`);
    expect(visiblePanel(ctx).querySelectorAll('thead th')).toHaveLength(columns + 1);
  });

  /* With no <dimension>, SheetJS keeps no trace of the rows past sheetRows, so
     only a cell in the row at the cap shows the sheet is cut. */
  it.each([
    { label: 'a cell in the row at the cap', rows: [['top'], [null], [null], ['at cap'], [null], ['late']], truncated: true },
    { label: 'no cell in the row at the cap, the known limit', rows: [['top'], [null], [null], [null], [null], ['late']], truncated: false },
  ])('reports a sparse sheet with no <dimension> and $label as truncated: $truncated', async ({ rows, truncated }) => {
    const ctx = context({ maxSheetRows: 4 });
    const summary = await renderer.render(await workbook({ name: 'Sparse', rows, omitDimension: true }), ctx);
    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 1, truncated });
    expect(shownText(ctx.root)).not.toContain('late');
  });

  /* The over-report sheetView names. SheetJS sets !fullref from the
     <dimension> alone, so both sheets parse the same, and !fullref is the
     only sign of the second sheet's cell past the cap. */
  it.each([
    { label: 'no cell past the cap, the known over-report', rows: [['a'], ['b'], ['c']] },
    { label: 'a cell past the cap and none in the row at the cap', rows: [['a'], ['b'], ['c'], [null], [null], ['late']] },
  ])('reports a sheet whose <dimension> reaches past the row cap, with $label, as truncated', async ({ rows }) => {
    const ctx = context({ maxSheetRows: 4 });
    const valid = await workbook({ name: 'Formatted', rows });
    const sheet = (await partText(valid, 'xl/worksheets/sheet1.xml')).replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:B5000"/>');
    const summary = await renderer.render(await withParts(valid, { 'xl/worksheets/sheet1.xml': sheet }), ctx);
    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 1, truncated: true });
    expect(cellTexts(ctx)).toEqual([['a'], ['b'], ['c']]);
  });

  it('names the columns past Z the way a spreadsheet does', async () => {
    const ctx = context();
    await renderer.render(await workbook(grid('Letters', 1, 28)), ctx);
    const labels = [...visiblePanel(ctx).querySelectorAll('thead th')].map((th) => th.textContent);
    expect(labels.slice(-3)).toEqual(['Z', 'AA', 'AB']);
  });

  /* SheetJS formats no cell itself, so each of these goes through cellText. */
  it.each([
    { label: 'a workbook counting from 1900', date1904: false, date: '2023-03-15' },
    { label: 'a workbook counting from 1904', date1904: true, date: '2027-03-16' },
  ])('shows each cell in its number format, and booleans and errors as Excel does, in $label', async ({ date1904, date }) => {
    const ctx = context();
    const row = [
      { number: 45000, format: 'yyyy-mm-dd' },
      { number: 0.1234, format: '0.00%' },
      { number: 0.256, format: '0.0%' },
      { number: 1234.5, format: '"$"#,##0.00' },
      { number: -1234.5, format: '"$"#,##0.00;("$"#,##0.00)' },
      1234.5678901234,
      true,
      false,
      { error: '#DIV/0!' },
      { error: '#N/A' },
      { error: '#SPILL!' },
      { error: '#CALC!' },
    ];
    await renderer.render(await workbookOf({ date1904, sheets: [{ name: 'Formats', rows: [row] }] }), ctx);
    expect(cellTexts(ctx)).toEqual([[date, '12.34%', '25.6%', '$1,234.50', '($1,234.50)', '1234.56789', 'TRUE', 'FALSE', '#DIV/0!', '#N/A', '#SPILL!', '#CALC!']]);
  });

  /* openpyxl and XlsxWriter save Excel's built-in currency, accounting and
     East Asian date formats as a format id with no format code. */
  it('shows a number in a built-in format the file names by its id alone', async () => {
    const ctx = context();
    const amounts = [7, 44, 5, 42].map((formatId) => ({ number: 1234.5, formatId }));
    await renderer.render(await workbook({ name: 'Built-in', rows: [[...amounts, { number: 45000.25, formatId: 31 }, { number: 0.125, formatId: 67 }]] }), ctx);
    expect(cellTexts(ctx)).toEqual([['$1,234.50 ', ' $1,234.50 ', '$1,235 ', ' $1,235 ', '3/15/23', '13%']]);
  });

  /* Excel caps a number format at 255 characters, and SheetJS's formatter
     costs time and memory in proportion to the format's length. */
  it('shows a cell whose number format runs past 255 characters as General', async () => {
    const ctx = context();
    const atCap = `"${'a'.repeat(253)}"`;
    const pastCap = `"${'b'.repeat(254)}"`;
    await renderer.render(await workbook({ name: 'Long', rows: [[{ number: 7, format: atCap }, { number: 7, format: pastCap }]] }), ctx);
    expect(cellTexts(ctx)).toEqual([['a'.repeat(253), '7']]);
  });

  /* The exported report fixture runs whole only in the browser spec. */
  it('shows the exported report\'s formats, shared strings and shared formulas\' cached results', async () => {
    const ctx = context({ maxSheetRows: 3, maxSheetColumns: 14 });
    const summary = await renderer.render(fixture('export-past-caps.xlsx'), ctx);
    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 1, truncated: true });
    expect(cellTexts(ctx)).toEqual([
      ['Order', 'Date', 'Region', 'Product', 'Units', 'Price', 'Amount', 'Discount', 'Net', 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'],
      ['ORD-00000', '2024-01-01', 'North', 'Product 1', '1', '$5.00', '$5.00', '0.0%', '$5.00', '3', '$1.00', '$1.10', '6%', 'On track'],
      ['ORD-00001', '2024-01-02', 'South', 'Product 2', '14', '$42.50', '$595.00', '5.0%', '$565.25', '6', '$2.00', '$2.20', '12%', 'Late'],
    ]);
  });

  it('cuts a cell\'s text at 1,000 characters with an ellipsis', async () => {
    const ctx = context();
    await renderer.render(await workbook({ name: 'Long', rows: [['x'.repeat(1_000), 'y'.repeat(1_500)]] }), ctx);
    expect(cellTexts(ctx)).toEqual([['x'.repeat(1_000), `${'y'.repeat(1_000)}\u2026`]]);
  });

  /* happy-dom lays nothing out, so each cell gets the widths a browser would
     measure. */
  it('titles a cut cell with its whole text once the pointer reaches it, and leaves other cells alone', async () => {
    const ctx = context();
    await renderer.render(await workbook({ name: 'Notes', rows: [['A note far longer than its column', 'short', 'titled']] }), ctx);
    const [cut, fits, titled] = visiblePanel(ctx).querySelectorAll('td');
    for (const [cell, scrollWidth] of [[cut, 240], [fits, 40], [titled, 240]] as const) {
      Object.defineProperty(cell, 'scrollWidth', { value: scrollWidth });
      Object.defineProperty(cell, 'clientWidth', { value: 83 });
    }
    titled.title = 'set before';

    expect(cut.hasAttribute('title')).toBe(false);
    for (const cell of [cut, fits, titled]) cell.dispatchEvent(new Event('pointerover', { bubbles: true }));

    expect(cut.title).toBe('A note far longer than its column');
    expect(fits.hasAttribute('title')).toBe(false);
    expect(titled.title).toBe('set before');
  });

  it('reports truncated when any sheet, not only the first, is past a cap', async () => {
    const ctx = context({ maxSheetRows: 4, maxSheetColumns: 3 });
    const summary = await renderer.render(await workbook(grid('Small', 2, 2), grid('Long', 6, 2)), ctx);
    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 2, truncated: true });

    tabs(ctx)[1].click();

    expect(cellTexts(ctx)).toHaveLength(4);
  });

  it.each([
    { sheetCount: 256, truncated: false },
    { sheetCount: 257, truncated: true },
  ])('gives at most 256 sheets a tab and never parses a sheet past them: $sheetCount sheets', async ({ sheetCount, truncated }) => {
    const ctx = context();
    const names = Array.from({ length: sheetCount }, (_, i) => `S${i + 1}`);
    const summary = await renderer.render(await workbook(...names.map((name) => ({ name, rows: [[name]] }))), ctx);

    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 256, truncated });
    expect(tabs(ctx).map((tab) => tab.textContent)).toEqual(names.slice(0, 256));
    const parsed = vi.mocked(read).mock.calls.flatMap(([, options]) => options?.sheets as number[]);
    expect(parsed).toEqual(Array.from({ length: 256 }, (_, i) => i));
    expect(vi.mocked(read)).toHaveBeenCalledTimes(8);
  });

  /* SheetJS parses a part once for each sheet that reads it, and compares part
     names in any case and with either slash. */
  it.each([
    'worksheets/sheet1.xml',
    '/xl/worksheets/sheet1.xml',
    'WORKSHEETS/Sheet1.XML',
    'worksheets\\sheet1.xml',
  ])('fails with parse-failed before any later read when a sheet\'s relationship names another sheet\'s part as %s', async (target) => {
    const ctx = context();
    const bytes = await workbook(grid('First', 2, 2), grid('Second', 1, 1), { name: 'Alias', rows: [], target });
    expect(await renderEnding(bytes, ctx)).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(ctx.root.childElementCount).toBe(0);
  });

  /* SheetJS decodes a Target's escapes, reads a value with no quotes, and
     keeps the last of two attributes it files under one name. Each of these
     names the first sheet's part for SheetJS. The workbook's third sheet has
     a part of its own, which only the replaced Target named. */
  it.each([
    { label: 'a decimal character reference', attributes: 'Target="worksheets/sheet&#49;.xml"' },
    { label: 'a hexadecimal character reference', attributes: 'Target="worksheets/sheet&#x31;.xml"' },
    { label: 'an _xHHHH_ escape', attributes: 'Target="worksheets/sheet_x0031_.xml"' },
    { label: 'a CDATA section', attributes: 'Target="<![CDATA[worksheets/sheet1.xml]]>"' },
    { label: 'an unquoted value', attributes: 'Target=worksheets/sheet1.xml ' },
    { label: 'a second Target', attributes: 'Target="worksheets/missing.xml" Target="worksheets/sheet1.xml"' },
    { label: 'a prefixed Target after the plain one', attributes: 'Target="worksheets/missing.xml" x:Target="worksheets/sheet1.xml"' },
  ])('fails with parse-failed before any later read when a sheet\'s relationship names another sheet\'s part through $label', async ({ attributes }) => {
    const valid = await workbook(grid('First', 2, 2), grid('Second', 1, 1), grid('Third', 1, 1));
    const rels = await partText(valid, 'xl/_rels/workbook.xml.rels');
    const aliased = rels.replace(/(<Relationship Id="rId3" [^>]*?)Target="[^"]*"/, `$1${attributes}`);
    expect(aliased).not.toBe(rels);
    const ctx = context();
    expect(await renderEnding(await withParts(valid, { 'xl/_rels/workbook.xml.rels': aliased }), ctx)).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  /* SheetJS reads a .rels part one character per byte, so a lone 0xA0 byte
     separates two attributes as a space does. */
  it('fails with parse-failed before any later read when a sheet\'s relationship has a lone 0xA0 byte before its Target', async () => {
    const valid = await workbook(grid('First', 2, 2), grid('Second', 1, 1), grid('Third', 1, 1));
    const rels = await partText(valid, 'xl/_rels/workbook.xml.rels');
    const aliased = rels.replace(/(<Relationship Id="rId3" [^>]*?) Target="[^"]*"/, '$1\u00a0Target="worksheets/sheet1.xml"');
    expect(aliased).not.toBe(rels);
    const bytes = await withParts(valid, { 'xl/_rels/workbook.xml.rels': latin1(aliased) });
    expect(await renderEnding(bytes, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  /* Unicode Path fields can swap two entries' names for JSZip, so JSZip's
     xl/_rels/workbook.xml.rels here holds the other entry's bytes, while
     SheetJS reads the .rels part that names the first sheet's part twice. */
  it('fails with parse-failed before any later read when the .rels part SheetJS reads goes under another name for JSZip', async () => {
    const valid = await workbook(grid('First', 2, 2), grid('Second', 1, 1), grid('Third', 1, 1));
    const rels = await partText(valid, 'xl/_rels/workbook.xml.rels');
    const aliased = rels.replace(/(<Relationship Id="rId3" [^>]*?)Target="[^"]*"/, '$1Target="worksheets/sheet1.xml"');
    const swapped = withUnicodePaths(
      new Uint8Array(await withParts(valid, { 'xl/_rels/workbook.xml.rels': aliased, 'customXml/item1.xml': rels })),
      { 'xl/_rels/workbook.xml.rels': 'customXml/item1.xml', 'customXml/item1.xml': 'xl/_rels/workbook.xml.rels' },
    );
    expect(await (await JSZip.loadAsync(swapped)).file('xl/_rels/workbook.xml.rels')?.async('string')).toBe(rels);
    expect(await renderEnding(swapped.buffer as ArrayBuffer, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  /* SheetJS reads both the archive's names and a Target one character per
     byte, so a non-ASCII name matches as its UTF-8 bytes. */
  it('fails with parse-failed before any later read when two sheets\' relationships name one part whose name is not ASCII', async () => {
    const valid = await workbook(grid('First', 1, 1), { name: 'Alias A', rows: [], target: 'worksheets/ventes-é.xml' }, { name: 'Alias B', rows: [], target: 'worksheets/ventes-é.xml' });
    const bytes = await withParts(valid, { 'xl/worksheets/ventes-é.xml': await partText(valid, 'xl/worksheets/sheet1.xml') });
    expect(await renderEnding(bytes, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('fails with parse-failed before any later read when two sheets share one relationship id', async () => {
    const valid = await workbook(grid('First', 1, 1), grid('Second', 1, 1));
    const shared = (await partText(valid, 'xl/workbook.xml')).replace('r:id="rId2"', 'r:id="rId1"');
    expect(await renderEnding(await withParts(valid, { 'xl/workbook.xml': shared }), context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  /* The content types may name the workbook part anything, and SheetJS then
     reads the .rels part beside it. */
  it('finds two sheets sharing a part through the .rels part beside a workbook part named elsewhere', async () => {
    const valid = await workbook(grid('First', 1, 1), { name: 'Alias', rows: [], target: 'worksheets/sheet1.xml' });
    const zip = await JSZip.loadAsync(valid);
    const book = await partText(valid, 'xl/workbook.xml');
    const rels = await partText(valid, 'xl/_rels/workbook.xml.rels');
    const contentTypes = (await partText(valid, '[Content_Types].xml')).replace('/xl/workbook.xml', '/xl/book.xml');
    zip.file('xl/book.xml', book);
    zip.file('xl/_rels/book.xml.rels', rels);
    zip.file('xl/workbook.xml', book.replace(/<sheet name="Alias"[^>]*\/>/, ''));
    zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship Id="rId2"[^>]*\/>/, ''));
    zip.file('[Content_Types].xml', contentTypes);
    const moved = (await zip.generateAsync({ type: 'uint8array' })).buffer as ArrayBuffer;

    expect(await renderEnding(moved, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
  });

  /* A run of later sheets ends before its parts would inflate past one
     part's cap, so no later read parses more sheet XML than the first read
     may. 15 sheets make runs of two; sheets 3 and 4 each take most of the
     cap. */
  it('ends a run of later sheets before their parts inflate past ctx.limits.maxZipEntryInflatedBytes', async () => {
    const bytes = await workbook(...Array.from({ length: 15 }, (_, i) => (i === 3 || i === 4 ? grid(`Large ${i}`, 40, 10) : grid(`Small ${i}`, 1, 1))));
    const large = (await partText(bytes, 'xl/worksheets/sheet4.xml')).length;
    await renderer.render(bytes, context({ maxZipEntryInflatedBytes: Math.floor(large * 1.5) }));
    expect(vi.mocked(read).mock.calls.map(([, options]) => options?.sheets)).toEqual([[0], [1, 2], [3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14]]);
  });

  /* A browser skips laying out a block of rows while it is off screen, which
     a table's own rows can't do, so a grid at the caps costs about as much to
     show as the rows in view. */
  it('puts each batch of rows in a block the browser skips while it is off screen, under one table of column labels', async () => {
    const ctx = context();
    await renderer.render(await workbook(grid('Rows', 250, 3)), ctx);
    const panel = visiblePanel(ctx);
    const blocks = [...panel.querySelectorAll<HTMLElement>('.xlsx-rows')];

    expect(blocks.map((block) => block.querySelectorAll('tbody tr').length)).toEqual([100, 100, 50]);
    expect(panel.querySelectorAll('thead')).toHaveLength(1);
    expect(panel.querySelector('thead')?.closest('.xlsx-rows')).toBeNull();
    expect([...panel.querySelectorAll('table'), ...blocks].map((node) => node.style.width)).toEqual(Array(7).fill('336px'));
    expect(ctx.root.querySelector('style')?.textContent).toMatch(/\.xlsx-rows \{[^}]*content-visibility: auto;/);
  });

  it('reports progress in batches of rows while it builds the first grid', async () => {
    const ctx = context();
    await renderer.render(await workbook(grid('Rows', 250, 1)), ctx);
    expect(ctx.progress.mock.calls).toEqual([[0, null], [100, 250], [200, 250], [250, 250]]);
  });

  it('reports the sheets read before each later read', async () => {
    const ctx = context();
    await renderer.render(await workbook(grid('Rows', 250, 1), grid('B', 1, 1), grid('C', 1, 1)), ctx);
    expect(ctx.progress.mock.calls).toEqual([[0, null], [1, 3], [2, 3], [100, 250], [200, 250], [250, 250]]);
  });

  it('stops before the next read once the signal aborts, and mounts nothing', async () => {
    const controller = new AbortController();
    const ctx = context({}, controller.signal);
    ctx.progress.mockImplementation((done, total) => {
      if (done === 1 && total === 3) controller.abort();
    });

    const error = await renderRejection(await workbook(grid('A', 1, 1), grid('B', 1, 1), grid('C', 1, 1)), ctx);

    expect(error).toBe(controller.signal.reason);
    expect(read).toHaveBeenCalledTimes(1);
    expect(ctx.root.childElementCount).toBe(0);
  });

  /* With a part's cap of 1 byte, the scan for uncalculated formulas gives the
     frame a task after each sheet part it reads, so a stop during the first
     read ends the scan at its next part, before the later reads report. */
  it('stops between sheet parts while it looks for uncalculated formulas once the signal aborts', async () => {
    const controller = new AbortController();
    const ctx = context({ maxZipEntryInflatedBytes: 1 }, controller.signal);
    const readSheetjs = vi.mocked(read).getMockImplementation();
    if (!readSheetjs) throw new Error('The read spy has no implementation');
    vi.mocked(read).mockImplementationOnce((data, options) => {
      controller.abort();
      return readSheetjs(data, options);
    });

    expect(await renderRejection(await workbook(grid('A', 1, 1), grid('B', 1, 1), grid('C', 1, 1)), ctx)).toBe(controller.signal.reason);
    expect(ctx.progress.mock.calls).toEqual([[0, null]]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(ctx.root.childElementCount).toBe(0);
  });

  it('stops at the next batch once the signal aborts, and mounts nothing', async () => {
    const controller = new AbortController();
    const ctx = context({}, controller.signal);
    ctx.progress.mockImplementation((done) => {
      if (done === 100) controller.abort();
    });

    const error = await renderRejection(await workbook(grid('Rows', 250, 1)), ctx);

    expect(error).toBe(controller.signal.reason);
    expect(ctx.progress.mock.calls).toEqual([[0, null], [100, 250]]);
    expect(ctx.root.childElementCount).toBe(0);
  });

  /* Reading the archive inflates it, as the first read does again, so the
     parent hears from the preview, and a stop takes effect, between the two. */
  it('reports its start once the archive passes its checks, and stops before the first read once the signal aborts', async () => {
    const controller = new AbortController();
    const ctx = context({}, controller.signal);
    ctx.progress.mockImplementation((done, total) => {
      if (done === 0 && total === null) controller.abort();
    });

    expect(await renderRejection(fixture('two-sheets.xlsx'), ctx)).toBe(controller.signal.reason);
    expect(ctx.progress.mock.calls).toEqual([[0, null]]);
    expect(read).not.toHaveBeenCalled();
  });

  it('never parses once the signal has aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await renderRejection(fixture('two-sheets.xlsx'), context({}, controller.signal));
    expect(error).toBe(controller.signal.reason);
    expect(read).not.toHaveBeenCalled();
  });

  it('shows an empty sheet as a note', async () => {
    const ctx = context();
    const summary = await renderer.render(await workbook({ name: 'Blank', rows: [] }), ctx);
    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 1, truncated: false });
    expect(visiblePanel(ctx).textContent).toBe('This sheet is empty.');
    expect(visiblePanel(ctx).querySelector('table')).toBeNull();
  });

  /* In a dense read SheetJS gives a chart sheet no cells. */
  it.each([
    { tab: 0, sheets: [{ name: 'Chart', rows: [], chart: true }, grid('Data', 1, 1)] },
    { tab: 1, sheets: [grid('Data', 1, 1), { name: 'Chart', rows: [], chart: true }] },
  ])('says a chart sheet holds a chart the preview doesn\'t show, as tab $tab', async ({ tab, sheets }) => {
    const ctx = context();
    const summary = await renderer.render(await workbook(...sheets), ctx);
    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 2, truncated: false });

    tabs(ctx)[tab].click();

    expect(visiblePanel(ctx).textContent).toBe("This sheet holds a chart, which the preview doesn't show.");
  });

  /* SheetJS keeps no trace of a chart or picture placed on a worksheet in a
     dense read. */
  it.each([
    { tab: 0, sheets: [{ name: 'Chart', rows: [], drawing: true }, grid('Data', 1, 1)] },
    { tab: 1, sheets: [grid('Data', 1, 1), { name: 'Chart', rows: [], drawing: true }] },
  ])('says a worksheet that holds only a chart or picture holds one the preview doesn\'t show, as tab $tab', async ({ tab, sheets }) => {
    const ctx = context();
    await renderer.render(await workbook(...sheets), ctx);

    tabs(ctx)[tab].click();

    expect(visiblePanel(ctx).textContent).toBe("This sheet holds a chart or picture, which the preview doesn't show.");
  });

  it('still calls a worksheet with no drawing empty, and shows the cells of one with a drawing', async () => {
    const ctx = context();
    await renderer.render(await workbook({ name: 'Blank', rows: [] }, { name: 'Drawn', rows: [['cell']], drawing: true }), ctx);
    expect(visiblePanel(ctx).textContent).toBe('This sheet is empty.');

    tabs(ctx)[1].click();

    expect(cellTexts(ctx)).toEqual([['cell']]);
  });

  /* openpyxl and XlsxWriter ask for every workbook they save to be calculated
     when it opens, so the note needs a formula as well. */
  it.each([
    { label: 'holds no formula', sheets: [grid('Data', 2, 2), grid('More', 1, 1)], note: false },
    { label: 'holds a formula in a later sheet only', sheets: [grid('Data', 1, 1), { name: 'Sums', rows: [[{ formula: 'SUM(1,2)' }]] }], note: true },
  ])('notes uncalculated formulas for a workbook that asks to be calculated when it opens and $label: $note', async ({ sheets, note }) => {
    const ctx = context();
    await renderer.render(await workbookOf({ calcOnLoad: true, sheets }), ctx);
    expect(ctx.root.querySelector('.xlsx-calc-note') !== null).toBe(note);
  });

  /* ExcelJS saves a formula it was given no result for with no value, and
     asks for no calculation, so such a formula gets the note on its own. A
     formula whose result is empty text is saved with an empty value, and a
     filled-down formula's later cells with an empty <f/>. */
  it.each<{ label: string; sheets: FixtureSheet[]; note: boolean }>([
    {
      label: 'formulas that all have values',
      sheets: [{
        name: 'Sums',
        rows: [
          [1, { formula: 'A1*2', cached: '2' }, { formula: '""', cached: '' }],
          [2, { shared: 0, cached: 4, formula: 'A2*2', ref: 'B2:B3' }],
          [3, { shared: 0, cached: 6 }],
        ],
      }],
      note: false,
    },
    { label: 'a formula with no value', sheets: [{ name: 'Sums', rows: [['Total', { formula: 'SUM(1,2)', omitValue: true }]] }], note: true },
    {
      label: 'a formula with no value after one with a value, in a later sheet only',
      sheets: [grid('Data', 1, 1), { name: 'Sums', rows: [[{ formula: 'SUM(1,2)', cached: '3' }], [{ formula: 'SUM(3,4)', omitValue: true }]] }],
      note: true,
    },
  ])('notes uncalculated formulas for a workbook that asks for no calculation and holds $label: $note', async ({ sheets, note }) => {
    const ctx = context();
    await renderer.render(await workbook(...sheets), ctx);
    expect(ctx.root.querySelector('.xlsx-calc-note') !== null).toBe(note);
  });

  /* A sheet part may give every element a namespace prefix. Excel saves a
     list that checks a cell's entry against another sheet, and XlsxWriter a
     sparkline, in an extension after the cells, as an <xm:f> in no cell. */
  it.each([
    { label: 'prefixed formulas that have values', cells: '<x:c r="A1"><x:v>1</x:v></x:c><x:c r="B1"><x:f>A1*2</x:f><x:v>2</x:v></x:c>', extension: '', calcOnLoad: false, note: false },
    {
      label: 'prefixed formulas that have values, in a workbook that asks to be calculated when it opens',
      cells: '<x:c r="A1"><x:v>1</x:v></x:c><x:c r="B1"><x:f>A1*2</x:f><x:v>2</x:v></x:c>',
      extension: '',
      calcOnLoad: true,
      note: true,
    },
    { label: 'a prefixed formula with no value', cells: '<x:c r="A1"><x:v>1</x:v></x:c><x:c r="B1"><x:f>A1*2</x:f></x:c>', extension: '', calcOnLoad: false, note: true },
    {
      label: 'a formula in an extension after the cells',
      cells: '<x:c r="A1"><x:v>1</x:v></x:c>',
      extension: '<x:extLst><x:ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">'
        + '<x14:dataValidations count="1" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:dataValidation type="list">'
        + '<x14:formula1><xm:f>Lists!$A$1:$A$3</xm:f></x14:formula1><xm:sqref>A1</xm:sqref></x14:dataValidation></x14:dataValidations></x:ext></x:extLst>',
      calcOnLoad: false,
      note: false,
    },
    {
      label: 'a sparkline\'s formula in an extension after the cells, in a workbook that asks to be calculated when it opens',
      cells: '<x:c r="A1"><x:v>1</x:v></x:c>',
      extension: '<x:extLst><x:ext xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}">'
        + '<x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:sparklineGroup displayEmptyCellsAs="gap"><x14:sparklines>'
        + '<x14:sparkline><xm:f>Sheet!A1:A1</xm:f><xm:sqref>B1</xm:sqref></x14:sparkline></x14:sparklines></x14:sparklineGroup></x14:sparklineGroups></x:ext></x:extLst>',
      calcOnLoad: true,
      note: false,
    },
  ])('notes uncalculated formulas for a sheet part that holds $label: $note', async ({ cells, extension, calcOnLoad, note }) => {
    const part = '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<x:sheetData><x:row r="1">${cells}</x:row></x:sheetData>${extension}</x:worksheet>`;
    const ctx = context();
    await renderer.render(await withParts(await workbookOf({ calcOnLoad, sheets: [grid('Sheet', 1, 1)] }), { 'xl/worksheets/sheet1.xml': part }), ctx);
    expect(cellTexts(ctx)[0][0]).toBe('1');
    expect(ctx.root.querySelector('.xlsx-calc-note') !== null).toBe(note);
  });

  /* A scan that searched again from each formula would read this part's
     100,000 formulas in one cell, and its 100,000 after the last cell, once
     per formula, which takes several seconds. */
  it('looks for a formula with no value in one pass over a sheet part', async () => {
    const formulas = '<f/>'.repeat(100_000);
    const part = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<sheetData><row r="1"><c r="A1">${formulas}<v>1</v></c></row></sheetData>${formulas}</worksheet>`;
    const bytes = await withParts(await workbook(grid('Sheet', 1, 1)), { 'xl/worksheets/sheet1.xml': part });
    const ctx = context();
    const started = performance.now();
    await renderer.render(bytes, ctx);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(cellTexts(ctx)).toEqual([['1']]);
    expect(ctx.root.querySelector('.xlsx-calc-note')).toBeNull();
  });

  /* The Python writers' reports hold no formula in a cell, show Excel's
     built-in formats, and keep a chart on a worksheet, and the XlsxWriter
     one has a sparkline, saved as an <xm:f> after the cells. fixtures.yaml
     checks the sheet each opens on; these check the other. */
  it('shows the openpyxl report\'s built-in formats with no note on formulas, and its chart worksheet\'s note', async () => {
    const ctx = context();
    await renderer.render(fixture('openpyxl-report.xlsx'), ctx);
    expect(ctx.root.querySelector('.xlsx-calc-note')).toBeNull();
    expect(cellTexts(ctx)).toEqual([['Format', 'Amount'], ['Currency', '$1,234.50 '], ['Accounting', ' $1,234.50 '], ['Whole currency', '$1,235 '], ['Whole accounting', ' $1,235 ']]);

    tabs(ctx)[1].click();

    expect(visiblePanel(ctx).textContent).toBe("This sheet holds a chart or picture, which the preview doesn't show.");
  });

  it('opens the XlsxWriter report on its chart worksheet\'s note with no note on formulas, and shows its built-in formats', async () => {
    const ctx = context();
    await renderer.render(fixture('xlsxwriter-report.xlsx'), ctx);
    expect(ctx.root.querySelector('.xlsx-calc-note')).toBeNull();
    expect(visiblePanel(ctx).textContent).toBe("This sheet holds a chart or picture, which the preview doesn't show.");

    tabs(ctx)[1].click();

    expect(cellTexts(ctx)).toEqual([['Format', 'Amount'], ['Currency', '$1,234.50 '], ['Accounting', ' $1,234.50 '], ['Date', '3/15/23']]);
  });

  /* The uncalculated fixture's note is checked from fixtures.yaml below. This
     checks where it sits, and that a calculated workbook gets none. */
  it('notes above the grid that formulas saved uncalculated may show blank or 0, and only then', async () => {
    const ctx = context();
    await renderer.render(fixture('uncalculated.xlsx'), ctx);
    const preview = ctx.root.firstElementChild;
    expect([...preview?.children ?? []].map((child) => child.className)).toEqual(['xlsx-calc-note', '', 'xlsx-panels', 'xlsx-tabs']);
    expect(cellTexts(ctx)[3]).toEqual(['Total', '']);

    const calculated = context();
    await renderer.render(fixture('two-sheets.xlsx'), calculated);
    expect(calculated.root.querySelector('.xlsx-calc-note')).toBeNull();
  });

  /* The Python writers' totals, saved as each writer saves them, and the
     same total saved with no value, as ExcelJS saves it. */
  it.each([
    { file: 'openpyxl-total.xlsx', total: '' },
    { file: 'xlsxwriter-total.xlsx', total: '0' },
    { file: 'formula-without-value.xlsx', total: '' },
  ])('shows the total in $file as saved, under the note that formulas weren\'t calculated', async ({ file, total }) => {
    const ctx = context();
    await renderer.render(fixture(file), ctx);
    expect(ctx.root.querySelector('.xlsx-calc-note')).not.toBeNull();
    expect(cellTexts(ctx)).toEqual([['Item', 'Amount'], ['Rent', '1200'], ['Power', '80'], ['Water', '45'], ['Total', total]]);
  });

  it('never calls a sheet empty when its cells all lie past the row cap', async () => {
    const ctx = context({ maxSheetRows: 4 });
    const rows = [[null], [null], [null], [null], [null], ['late']];
    const summary = await renderer.render(await workbook({ name: 'Late', rows }), ctx);
    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 1, truncated: true });
    expect(visiblePanel(ctx).textContent).toBe('This sheet has no cells in the rows shown.');
  });

  /* SheetJS gives no sheet for a name whose part is missing. The fixtures.yaml
     entry covers a missing first sheet; this covers one behind a later tab. */
  it('says a later sheet SheetJS gave no sheet for could not be read, and shows the others', async () => {
    const ctx = context();
    const summary = await renderer.render(await workbook({ name: 'Kept', rows: [['kept']] }, { name: 'Gone', rows: [], omitPart: true }), ctx);

    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 2, truncated: false });
    expect(cellTexts(ctx)).toEqual([['kept']]);

    tabs(ctx)[1].click();

    expect(visiblePanel(ctx).textContent).toBe('This sheet could not be read.');
  });

  it('fails with parse-failed when SheetJS gives no sheet for any name', async () => {
    const ctx = context();
    const bytes = await workbook({ name: 'Gone', rows: [], omitPart: true }, { name: 'Lost', rows: [], omitPart: true });
    expect(await renderEnding(bytes, ctx)).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(ctx.root.childElementCount).toBe(0);
  });

  /* SheetJS keeps its sheets in a plain object, so these names find
     Object.prototype's members when SheetJS parsed no sheet for them. */
  it.each(['constructor', 'toString', '__proto__'])('says a later sheet named %s whose part is missing could not be read', async (name) => {
    const ctx = context();
    await renderer.render(await workbook({ name: 'Kept', rows: [['kept']] }, { name, rows: [], omitPart: true }), ctx);

    tabs(ctx)[1].click();

    expect(visiblePanel(ctx).textContent).toBe('This sheet could not be read.');
  });

  it('fails with parse-failed when sheets named constructor and toString both have no part', async () => {
    const bytes = await workbook({ name: 'constructor', rows: [], omitPart: true }, { name: 'toString', rows: [], omitPart: true });
    expect(await renderEnding(bytes, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
  });

  /* SheetJS stores a sheet named __proto__ as its sheet object's prototype,
     not as a property of its own. */
  it('shows a sheet named __proto__ and the sheet beside it', async () => {
    const ctx = context();
    await renderer.render(await workbook({ name: '__proto__', rows: [['proto']] }, { name: 'Next', rows: [['next']] }), ctx);
    expect(cellTexts(ctx)).toEqual([['proto']]);

    tabs(ctx)[1].click();

    expect(cellTexts(ctx)).toEqual([['next']]);
  });

  it('marks a hidden sheet in its tab', async () => {
    const ctx = context();
    const summary = await renderer.render(await workbook(grid('Shown', 1, 1), { ...grid('Kept', 1, 1), hidden: true }), ctx);
    expect(summary.units).toBe(2);
    expect(tabs(ctx).map((tab) => tab.textContent)).toEqual(['Shown', 'Kept (hidden)']);
  });

  /* A spreadsheet app opens on the tab the workbook was saved on, and never on
     a hidden sheet. */
  it.each<{ label: string; book: FixtureWorkbook; start: number }>([
    { label: 'a hidden first sheet', book: { sheets: [{ name: 'Secret', rows: [['secret']], hidden: true }, { name: 'Report', rows: [['report']] }] }, start: 1 },
    { label: 'a very hidden first sheet', book: { sheets: [{ name: 'Secret', rows: [['secret']], veryHidden: true }, { name: 'Report', rows: [['report']] }] }, start: 1 },
    { label: 'the saved active tab', book: { activeTab: 2, sheets: [grid('One', 1, 1), grid('Two', 1, 1), { name: 'Report', rows: [['report']] }] }, start: 2 },
    { label: 'a saved active tab that is hidden', book: { activeTab: 0, sheets: [{ name: 'Secret', rows: [['secret']], hidden: true }, { name: 'Report', rows: [['report']] }] }, start: 1 },
    { label: 'a saved active tab past the last sheet', book: { activeTab: 5, sheets: [{ name: 'Report', rows: [['report']] }, grid('Two', 1, 1)] }, start: 0 },
    { label: 'every sheet hidden', book: { sheets: [{ name: 'Report', rows: [['report']], hidden: true }, { ...grid('Two', 1, 1), veryHidden: true }] }, start: 0 },
  ])('opens on the right sheet for $label, and keeps hidden tabs marked', async ({ book, start }) => {
    const ctx = context();
    const summary = await renderer.render(await workbookOf(book), ctx);

    expect(summary.units).toBe(book.sheets.length);
    expect(tabs(ctx).map((tab) => tab.getAttribute('aria-selected') === 'true')).toEqual(book.sheets.map((_, i) => i === start));
    expect(tabs(ctx).map((tab) => tab.textContent)).toEqual(book.sheets.map((sheet) => (sheet.hidden || sheet.veryHidden ? `${sheet.name} (hidden)` : sheet.name)));
    expect(visiblePanel(ctx).getAttribute('aria-labelledby')).toBe(tabs(ctx)[start].id);
    expect(cellTexts(ctx)).toEqual([['report']]);
  });

  it('reads the sheet it opens on right after the first sheet, keeps its grid, and still reads every sheet once', async () => {
    const ctx = context();
    await renderer.render(await workbookOf({ activeTab: 2, sheets: [grid('One', 1, 1), grid('Two', 1, 1), { name: 'Report', rows: [['report']] }, grid('Four', 1, 1)] }), ctx);
    const startPanel = visiblePanel(ctx);

    expect(vi.mocked(read).mock.calls.map(([, options]) => options?.sheets)).toEqual([[0], [2], [1], [3]]);
    expect(ctx.progress.mock.calls).toEqual([[0, null], [1, 4], [2, 4], [3, 4], [1, 1]]);

    tabs(ctx)[0].click();
    tabs(ctx)[1].click();

    expect(cellTexts(ctx)).toEqual([['0,0']]);
    expect([...ctx.root.querySelectorAll('[role="tabpanel"]')].map((panel) => panel.id)).toEqual(['xlsx-panel-2', 'xlsx-panel-1']);

    tabs(ctx)[2].click();

    expect(visiblePanel(ctx)).toBe(startPanel);
  });

  it('keeps to 8 reads and parses each of the first 256 sheets once when it opens on another sheet', async () => {
    const ctx = context();
    const names = Array.from({ length: 257 }, (_, i) => `S${i + 1}`);
    const summary = await renderer.render(await workbookOf({ activeTab: 100, sheets: names.map((name) => ({ name, rows: [[name]] })) }), ctx);

    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 256, truncated: true });
    expect(cellTexts(ctx)).toEqual([['S101']]);
    const runs = vi.mocked(read).mock.calls.map(([, options]) => options?.sheets as number[]);
    expect(runs).toHaveLength(8);
    expect(runs.slice(0, 2)).toEqual([[0], [100]]);
    expect(runs.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 256 }, (_, i) => i));
  });

  it('fails with parse-failed for text that is not a zip, and never hands it to SheetJS', async () => {
    const bytes = new TextEncoder().encode('<table><tr><td>a</td></tr></table>').buffer as ArrayBuffer;
    expect(await renderEnding(bytes, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(read).not.toHaveBeenCalled();
  });

  it('fails with unsupported for an encrypted workbook or an old .xls', async () => {
    const compoundFile = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(await renderEnding(compoundFile.buffer, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'unsupported' });
    expect(read).not.toHaveBeenCalled();
  });

  /* The slide preview checks the same 8 bytes, so both previews end such a
     file the same way. */
  it('fails with parse-failed, not unsupported, for a file with only the first half of the 8-byte compound-file signature', async () => {
    const firstHalf = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await renderEnding(firstHalf.buffer, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(read).not.toHaveBeenCalled();
  });

  it('fails with unsupported for a zip that holds no workbook, and never hands it to SheetJS', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'not a workbook');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    expect(await renderEnding(bytes.buffer as ArrayBuffer, context())).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'unsupported' });
    expect(read).not.toHaveBeenCalled();
  });

  /* The content types name a workbook part the archive lacks, so SheetJS
     throws. */
  it('fails with parse-failed for a package SheetJS cannot read as a workbook, and keeps SheetJS\'s error as the cause', async () => {
    const valid = await workbook(grid('Kept', 1, 1));
    const contentTypes = (await partText(valid, '[Content_Types].xml')).replace('/xl/workbook.xml', '/xl/missing.xml');
    const error = await renderRejection(await withParts(valid, { '[Content_Types].xml': contentTypes }));
    if (!isPreviewError(error)) throw new Error('render() rejected with something other than a PreviewError');
    expect(error.code).toBe('parse-failed');
    expect(error.cause).toBeInstanceOf(Error);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('fails with parse-failed for the corrupt fixture, whose workbook lists no sheet', async () => {
    const ctx = context();
    expect(await renderEnding(fixture('corrupt.xlsx'), ctx)).toEqual<RenderEnding>({ outcome: 'error', errorCode: 'parse-failed' });
    expect(ctx.root.childElementCount).toBe(0);
  });
});

/* The three past-caps fixtures fill the grid at the caps, 400,000 cells.
   happy-dom needs several GB of heap to hold them, while a browser draws them
   in a few seconds, so only the browser spec runs those fixtures. The cap
   tests above cover their logic at small caps, and the exported report's
   cells are checked at small caps above too. */
const BROWSER_ONLY_FIXTURES: readonly string[] = ['past-caps.xlsx', 'export-past-caps.xlsx', 'text-past-caps.xlsx'];

/* The runtime's archive guard ends this fixture with parse-failed before the
   renderer reads it, and its entry states that ending. The renderer's own
   answer, unsupported, has its test above. */
const GUARD_ENDED_FIXTURES: readonly string[] = ['unicode-path-parts.xlsx'];

describe('fixtures.yaml on the renderer alone', () => {
  const fixtures = FIXTURE_LIST.filter(({ file }) => !BROWSER_ONLY_FIXTURES.includes(file) && !GUARD_ENDED_FIXTURES.includes(file));

  it.each(fixtures)('$kind: $name ends as its entry expects', async ({ file, expect: want }) => {
    const ctx = context();
    const ending = await renderEnding(fixture(file), ctx);
    const text = shownText(ctx.root);

    expect(ending.outcome).toBe(want.outcome);
    if (ending.outcome === 'error') {
      if (want.errorCode !== undefined) expect(ending.errorCode).toBe(want.errorCode);
    } else {
      expect(ending.summary.type).toBe('xlsx');
      if (want.units !== undefined) expect(ending.summary.units).toBe(want.units);
      if (want.minUnits !== undefined) expect(ending.summary.units).toBeGreaterThanOrEqual(want.minUnits);
      if (want.truncated !== undefined) expect(ending.summary.truncated).toBe(want.truncated);
    }
    for (const included of want.textIncludes ?? []) expect(text).toContain(included);
    for (const excluded of want.textExcludes ?? []) expect(text).not.toContain(excluded);
  });
});

describe('render.ts source', () => {
  const source = readFileSync(join(__dirname, 'render.ts'), 'utf8');

  it.each(SOURCE_CHECKS)('holds no $name', ({ pattern, flags }) => {
    expect(source).not.toMatch(new RegExp(pattern, flags));
  });

  it.each(SOURCE_CHECKS.filter(({ matches, skips }) => matches || skips))('$name matches its examples and skips its non-examples', ({ pattern, flags, matches, skips }) => {
    const check = new RegExp(pattern, flags);
    expect((matches ?? []).filter((text) => !check.test(text))).toEqual([]);
    expect((skips ?? []).filter((text) => check.test(text))).toEqual([]);
  });
});
