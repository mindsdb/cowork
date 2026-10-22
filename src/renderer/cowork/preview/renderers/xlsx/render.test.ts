/*
 * The xlsx renderer against real SheetJS and happy-dom: the committed preview
 * fixtures, plus small workbooks built here with the same generator. The
 * entries in fixtures.yaml are checked here against the renderer alone, so a
 * wrong expectation shows up before the browser spec runs it in the preview
 * frame.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import JSZip from 'jszip';
import { load } from 'js-yaml';
import { read, version } from 'xlsx';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { PreviewFixture } from '../../../../../../e2e/document-preview/harness';
import { buildWorkbook, type FixtureSheet } from '../../../../../../e2e/document-preview/fixtures/xlsx/make-fixtures.mjs';
import type { PreviewError, PreviewErrorCode, PreviewLimits, RenderSummary, RendererContext } from '../../contract';
import { previewLimits } from '../../limits';
import renderer from './render';

/* SheetJS fills its defaults into the options object it gets, so the spy hands
   it a copy and keeps the caller's object as the caller wrote it. */
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return { ...actual, read: vi.fn((data: unknown, options?: object) => actual.read(data, { ...options })) };
});

interface CodeCheck { name: string; pattern: string; flags?: string }

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

/* A sheet whose cell at row r, column c (both from 0) reads `r,c`. */
function grid(name: string, rows: number, columns: number): FixtureSheet {
  return { name, rows: Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => `${r},${c}`)) };
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

async function renderFailure(bytes: ArrayBuffer, ctx = context()): Promise<PreviewError> {
  return renderer.render(bytes, ctx).then(
    () => { throw new Error('render() resolved'); },
    (error: PreviewError) => error,
  );
}

async function renderEnding(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderEnding> {
  return renderer.render(bytes, ctx).then(
    (summary): RenderEnding => ({ outcome: 'rendered', summary }),
    (error: PreviewError): RenderEnding => ({ outcome: 'error', errorCode: error.code }),
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
  it('parses with SheetJS dense, with HTML and styles off, cut at ctx.limits.maxSheetRows', async () => {
    await renderer.render(fixture('two-sheets.xlsx'), context({ maxSheetRows: 1234 }));
    const options = { type: 'array', dense: true, cellHTML: false, cellStyles: false, sheetRows: 1234 };
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

  it('opens no archive of its own and asks for no asset', async () => {
    const ctx = context();
    await renderer.render(fixture('two-sheets.xlsx'), ctx);
    expect(ctx.openZip).not.toHaveBeenCalled();
    expect(ctx.requestAsset).not.toHaveBeenCalled();
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

  it('names the columns past Z the way a spreadsheet does', async () => {
    const ctx = context();
    await renderer.render(await workbook(grid('Letters', 1, 28)), ctx);
    const labels = [...visiblePanel(ctx).querySelectorAll('thead th')].map((th) => th.textContent);
    expect(labels.slice(-3)).toEqual(['Z', 'AA', 'AB']);
  });

  it('reports truncated when any sheet, not only the first, is past a cap', async () => {
    const ctx = context({ maxSheetRows: 4, maxSheetColumns: 3 });
    const summary = await renderer.render(await workbook(grid('Small', 2, 2), grid('Long', 6, 2)), ctx);
    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 2, truncated: true });

    tabs(ctx)[1].click();

    expect(cellTexts(ctx)).toHaveLength(4);
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

    const error = await renderFailure(await workbook(grid('A', 1, 1), grid('B', 1, 1), grid('C', 1, 1)), ctx);

    expect(error).toBe(controller.signal.reason);
    expect(read).toHaveBeenCalledTimes(1);
    expect(ctx.root.childElementCount).toBe(0);
  });

  it('stops at the next batch once the signal aborts, and mounts nothing', async () => {
    const controller = new AbortController();
    const ctx = context({}, controller.signal);
    ctx.progress.mockImplementation((done) => {
      if (done === 100) controller.abort();
    });

    const error = await renderFailure(await workbook(grid('Rows', 250, 1)), ctx);

    expect(error).toBe(controller.signal.reason);
    expect(ctx.progress.mock.calls).toEqual([[0, null], [100, 250]]);
    expect(ctx.root.childElementCount).toBe(0);
  });

  it('never parses once the signal has aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await renderFailure(fixture('two-sheets.xlsx'), context({}, controller.signal));
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

  it('never calls a sheet empty when its cells all lie past the row cap', async () => {
    const ctx = context({ maxSheetRows: 4 });
    const rows = [[null], [null], [null], [null], [null], ['late']];
    const summary = await renderer.render(await workbook({ name: 'Late', rows }), ctx);
    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 1, truncated: true });
    expect(visiblePanel(ctx).textContent).toBe('This sheet has no cells in the rows shown.');
  });

  it('marks a hidden sheet in its tab', async () => {
    const ctx = context();
    const summary = await renderer.render(await workbook(grid('Shown', 1, 1), { ...grid('Kept', 1, 1), hidden: true }), ctx);
    expect(summary.units).toBe(2);
    expect(tabs(ctx).map((tab) => tab.textContent)).toEqual(['Shown', 'Kept (hidden)']);
  });

  it('fails with parse-failed for text that is not a zip, and never hands it to SheetJS', async () => {
    const error = await renderFailure(new TextEncoder().encode('<table><tr><td>a</td></tr></table>').buffer as ArrayBuffer);
    expect(error.code).toBe('parse-failed');
    expect(read).not.toHaveBeenCalled();
  });

  it('fails with unsupported for an encrypted workbook or an old .xls', async () => {
    const compoundFile = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const error = await renderFailure(compoundFile.buffer);
    expect(error.code).toBe('unsupported');
    expect(read).not.toHaveBeenCalled();
  });

  it('fails with parse-failed for a zip SheetJS cannot read as a workbook', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'not a workbook');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const error = await renderFailure(bytes.buffer as ArrayBuffer);
    expect(error.code).toBe('parse-failed');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('fails with parse-failed for the corrupt fixture, whose workbook lists no sheet', async () => {
    const ctx = context();
    const error = await renderFailure(fixture('corrupt.xlsx'), ctx);
    expect(error.code).toBe('parse-failed');
    expect(ctx.root.childElementCount).toBe(0);
  });
});

/* The past-caps fixture fills the grid at the caps, 400,000 cells. happy-dom
   needs several GB of heap to hold them, while a browser draws them in under a
   second, so only the browser spec runs that fixture. The cap tests above cover
   its logic at small caps. */
const BROWSER_ONLY_FIXTURE = 'past-caps.xlsx';

describe('fixtures.yaml on the renderer alone', () => {
  const fixtures = FIXTURE_LIST.filter(({ file }) => file !== BROWSER_ONLY_FIXTURE);

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
});
