/*
 * The xlsx renderer against real SheetJS and a real DOM: the committed preview
 * fixtures, plus small workbooks built here with the same generator. Each entry
 * in fixtures.yaml is checked here against the renderer alone, so a wrong
 * expectation shows up before the browser spec runs it in the preview frame.
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

/* A mock keeps every call's `this`, which for ctx.progress is the context and
   its whole grid, so each test's mocks are cleared to let that grid go. */
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
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(expect.any(Uint8Array), {
      type: 'array', dense: true, cellHTML: false, cellStyles: false, sheetRows: 1234,
    });
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
    expect(ctx.root.querySelectorAll('[role="tabpanel"]')).toHaveLength(2);
  });

  it('opens no archive of its own and asks for no asset', async () => {
    const ctx = context();
    await renderer.render(fixture('two-sheets.xlsx'), ctx);
    expect(ctx.openZip).not.toHaveBeenCalled();
    expect(ctx.requestAsset).not.toHaveBeenCalled();
  });

  it('puts every cell in as text: markup shows as written and no cell becomes a link', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ctx = context();
    const summary = await renderer.render(fixture('hostile.xlsx'), ctx);

    expect(summary).toEqual<RenderSummary>({ type: 'xlsx', units: 2, truncated: false });
    const values = cellTexts(ctx).map(([, value]) => value);
    expect(values).toContain('<img src="https://example.com/xlsx-img.png" onerror="parent.postMessage(1,\'*\')">');
    expect(values).toContain('<a href="https://example.com/xlsx-anchor">anchor markup</a>');
    expect(values).toContain('example.com link');
    expect(values).toContain('script link');
    expect(ctx.root.querySelectorAll('a, area, img, iframe, object, embed, script, link, form')).toHaveLength(0);
    expect(ctx.root.querySelectorAll('[href], [src], [action], [formaction], [background]')).toHaveLength(0);
    for (const node of ctx.root.querySelectorAll('*')) {
      for (const { name, value } of node.attributes) {
        expect(`${name}=${value}`).not.toMatch(/:\/\/|javascript:|example\.com/i);
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('shows cached values, never a formula or an external reference', async () => {
    const ctx = context();
    await renderer.render(fixture('hostile.xlsx'), ctx);
    const values = cellTexts(ctx).map(([, value]) => value);
    expect(values).toEqual(expect.arrayContaining(['formula link', 'web service value', 'external value']));
    expect(ctx.root.textContent).not.toMatch(/HYPERLINK\(|WEBSERVICE\(|\[1\]|xlsx-external/);
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

/* At the real caps, so the past-caps fixture also shows the renderer never goes
   a progress watchdog's length without a report. */
describe('fixtures.yaml on the renderer alone', () => {
  it.each(FIXTURE_LIST)('$kind: $name ends as its entry expects', async ({ file, expect: want }) => {
    const ctx = context();
    const reportedAt: number[] = [];
    ctx.progress.mockImplementation(() => { reportedAt.push(performance.now()); });
    const startedAt = performance.now();
    const ending = await renderEnding(fixture(file), ctx);
    const endedAt = performance.now();
    const gaps = [...reportedAt, endedAt].map((at, i) => at - (i === 0 ? startedAt : reportedAt[i - 1]));
    const text = shownText(ctx.root);

    expect(Math.max(...gaps)).toBeLessThan(ctx.limits.progressTimeoutMs);
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
  }, 60_000);
});

describe('render.ts source', () => {
  const source = readFileSync(join(__dirname, 'render.ts'), 'utf8');

  it.each(SOURCE_CHECKS)('holds no $name', ({ pattern, flags }) => {
    expect(source).not.toMatch(new RegExp(pattern, flags));
  });
});
