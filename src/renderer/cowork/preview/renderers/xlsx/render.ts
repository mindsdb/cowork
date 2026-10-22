/*
 * The .xlsx preview: a read-only grid for each sheet, with one tab per sheet.
 *
 * SheetJS parses the workbook with HTML and styles off and stops each sheet at
 * maxSheetRows. It reads the first sheet alone and the other sheets in a few
 * runs, reporting progress and checking the abort signal between reads, and
 * each sheet keeps only the rows and columns within the caps. The grid starts
 * at A1 and shows at most maxSheetRows rows and maxSheetColumns columns. Every
 * cell goes in through textContent, so markup in a cell shows as text and no
 * cell becomes a link. The grid reads each cell's value and formatted text
 * only, never its formula, hyperlink, comment or rich-text runs.
 *
 * The first sheet's grid is built before render() resolves, in batches that
 * report progress and check the abort signal. Every other sheet's grid is
 * built when its tab is opened and removed when its tab is left.
 */
import { read, type CellObject, type WorkBook, type WorkSheet } from 'xlsx';

import type { PreviewLimits, RenderSummary, RendererContext } from '../../contract';
import { previewError } from '../../errors';
import type { RendererModule } from '../../hooks';

const ROWS_PER_BATCH = 100;
/* Each SheetJS read inflates the whole archive and parses its shared strings
   again, so a workbook takes at most this many reads: the first sheet alone,
   then the other sheets in runs of equal length. */
const MAX_WORKBOOK_READS = 8;
const ROW_HEADER_WIDTH_PX = 48;
const COLUMN_WIDTH_PX = 96;

/* A zip archive's local file header, and an OLE compound file's header, which
   is how an encrypted .xlsx or an old .xls renamed to .xlsx starts. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

/* The preview fills the frame's viewport whatever height its root has, so the
   grid scrolls inside it and the sheet tabs stay in view below the grid. */
const STYLES = `
.xlsx-preview { position: fixed; inset: 0; display: flex; flex-direction: column; color-scheme: light dark;
  font: 13px/1.4 system-ui, sans-serif; color: CanvasText; background: Canvas; }
.xlsx-panels { flex: 1; min-height: 0; overflow: auto; }
.xlsx-grid { border-collapse: separate; border-spacing: 0; table-layout: fixed; }
.xlsx-grid th, .xlsx-grid td { box-sizing: border-box; height: 22px; padding: 0 6px; overflow: hidden;
  white-space: nowrap; text-overflow: ellipsis; text-align: left; font-weight: normal;
  border-right: 1px solid color-mix(in srgb, CanvasText 12%, Canvas);
  border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
.xlsx-grid th { background: color-mix(in srgb, CanvasText 6%, Canvas); color: color-mix(in srgb, CanvasText 65%, Canvas); }
.xlsx-grid thead th { position: sticky; top: 0; z-index: 1; text-align: center; }
.xlsx-grid tbody th { position: sticky; left: 0; text-align: right; }
.xlsx-grid thead th:first-child { left: 0; z-index: 2; }
.xlsx-grid td.xlsx-number { text-align: right; }
.xlsx-empty { margin: 16px; color: color-mix(in srgb, CanvasText 65%, Canvas); }
.xlsx-tabs { flex: none; display: flex; gap: 2px; overflow-x: auto; padding: 4px;
  border-top: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
.xlsx-tab { flex: none; font: inherit; padding: 4px 12px; border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: inherit; white-space: nowrap; cursor: pointer; }
.xlsx-tab[aria-selected="true"] { font-weight: 600; background: color-mix(in srgb, CanvasText 8%, Canvas);
  border-color: color-mix(in srgb, CanvasText 20%, Canvas); }
.xlsx-hidden-mark { color: color-mix(in srgb, CanvasText 65%, Canvas); }
`;

type SheetRow = readonly (CellObject | undefined)[] | undefined;

/* One sheet as the grid shows it. rows, rowCount and columnCount are already
   cut to the caps; truncated says the file may hold more than that (see
   sheetView). */
interface SheetView {
  name: string;
  hidden: boolean;
  rows: readonly SheetRow[];
  rowCount: number;
  columnCount: number;
  truncated: boolean;
}

interface Grid {
  table: HTMLTableElement;
  body: HTMLTableSectionElement;
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

function checkFormat(bytes: Uint8Array): void {
  if (startsWith(bytes, COMPOUND_FILE_MAGIC)) {
    throw previewError('unsupported', 'The workbook is encrypted or in the older .xls format.');
  }
  /* SheetJS also reads CSV, HTML and other text formats. A real .xlsx is a zip,
     and the runtime's archive guard has checked every zip before render(), so
     SheetJS gets only a zip. */
  if (!startsWith(bytes, ZIP_MAGIC)) {
    throw previewError('parse-failed', 'The file is not an .xlsx workbook.');
  }
}

/* A sheet counts as cut in three cases. SheetJS sets !fullref, which it does
   when the sheet's <dimension> reaches past sheetRows. A cell sits in the last
   row the cap shows. Or a row runs past the column cap, a row's length being
   one past its last cell.

   The last-row rule is there because SheetJS drops the rows past sheetRows
   without a trace when the file's <dimension> is missing, has no range (such
   as "A1") or is shorter than the data. Such a sheet whose row at the cap
   holds no cell, while later rows do, reports truncated: false. That is a
   known limit: telling it apart would mean reading the sheet part again.

   The view keeps only the rows and columns within the caps, so the parsed
   workbook can be dropped. */
function sheetView(name: string, sheet: WorkSheet | undefined, hidden: boolean, limits: PreviewLimits): SheetView {
  const parsed: readonly SheetRow[] = sheet?.['!data'] ?? [];
  const widest = parsed.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  const rowCount = Math.min(parsed.length, limits.maxSheetRows);
  const columnCount = Math.min(widest, limits.maxSheetColumns);
  return {
    name,
    hidden,
    rows: parsed.slice(0, rowCount).map((row) => row?.slice(0, columnCount)),
    rowCount,
    columnCount,
    truncated: typeof sheet?.['!fullref'] === 'string' || parsed.length >= limits.maxSheetRows || widest > limits.maxSheetColumns,
  };
}

/* What one read gives: every sheet's name, and a view of each sheet it parsed. */
interface SheetRun {
  names: readonly string[];
  views: SheetView[];
}

/* Reads the workbook with SheetJS, parsing only the sheets at the given
   indexes. */
function readRun(bytes: Uint8Array, sheets: number[], limits: PreviewLimits): SheetRun {
  let workbook: WorkBook;
  try {
    workbook = read(bytes, { type: 'array', dense: true, cellHTML: false, cellStyles: false, sheetRows: limits.maxSheetRows, sheets });
  } catch {
    throw previewError('parse-failed', "SheetJS couldn't read the workbook.");
  }
  const names = workbook.SheetNames;
  if (names.length === 0) throw previewError('parse-failed', 'The workbook has no sheets.');
  return {
    names,
    views: sheets.map((i) => sheetView(names[i], workbook.Sheets[names[i]], !!workbook.Workbook?.Sheets?.[i]?.Hidden, limits)),
  };
}

/* Column letters for a 0-based index: 0 is A, 25 is Z, 26 is AA. SheetJS's
   utils.encode_col does the same, but importing utils bundles its HTML writer. */
function columnLabel(index: number): string {
  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}

function cellText(cell: CellObject | undefined): string {
  if (!cell) return '';
  if (cell.w !== undefined) return cell.w;
  return cell.v === undefined ? '' : String(cell.v);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function gridShell(view: SheetView): Grid {
  const table = element('table', 'xlsx-grid');
  table.style.width = `${ROW_HEADER_WIDTH_PX + view.columnCount * COLUMN_WIDTH_PX}px`;
  const columns = element('colgroup');
  const headerRow = element('tr');
  const corner = element('col');
  corner.style.width = `${ROW_HEADER_WIDTH_PX}px`;
  columns.append(corner);
  headerRow.append(element('th'));
  for (let c = 0; c < view.columnCount; c += 1) {
    const col = element('col');
    col.style.width = `${COLUMN_WIDTH_PX}px`;
    columns.append(col);
    const label = element('th');
    label.scope = 'col';
    label.textContent = columnLabel(c);
    headerRow.append(label);
  }
  const head = element('thead');
  head.append(headerRow);
  const body = element('tbody');
  table.append(columns, head, body);
  return { table, body };
}

function appendRows(grid: Grid, view: SheetView, from: number, to: number): void {
  const batch = document.createDocumentFragment();
  for (let r = from; r < to; r += 1) {
    const row = element('tr');
    const label = element('th');
    label.scope = 'row';
    label.textContent = String(r + 1);
    row.append(label);
    const cells = view.rows[r];
    for (let c = 0; c < view.columnCount; c += 1) {
      const cell = cells?.[c];
      const td = element('td', cell?.t === 'n' ? 'xlsx-number' : undefined);
      td.textContent = cellText(cell);
      row.append(td);
    }
    batch.append(row);
  }
  grid.body.append(batch);
}

/* A sheet with no rows to show. When it is cut, its cells lie past the row cap. */
function emptySheet(view: SheetView): HTMLElement {
  const note = element('p', 'xlsx-empty');
  note.textContent = view.truncated ? 'This sheet has no cells in the rows shown.' : 'This sheet is empty.';
  return note;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* Reads every sheet into a view: the first sheet alone, since that read also
   gives every sheet's name, then the others in at most MAX_WORKBOOK_READS - 1
   runs. Before each later read it reports the sheets read so far and stops
   once the signal aborts. */
async function readViews(bytes: Uint8Array, ctx: RendererContext): Promise<SheetView[]> {
  const { names, views } = readRun(bytes, [0], ctx.limits);
  const runLength = Math.ceil((names.length - 1) / (MAX_WORKBOOK_READS - 1));
  for (let from = 1; from < names.length; from += runLength) {
    ctx.progress(from, names.length);
    await nextTask();
    ctx.signal.throwIfAborted();
    const run = Array.from({ length: Math.min(runLength, names.length - from) }, (_, k) => from + k);
    views.push(...readRun(bytes, run, ctx.limits).views);
  }
  return views;
}

/* Builds the first sheet's grid in batches of rows, reporting rows done and
   stopping at the next batch once the signal aborts. */
async function buildFirstGrid(view: SheetView, ctx: RendererContext): Promise<HTMLElement> {
  if (view.rowCount === 0) return emptySheet(view);
  const grid = gridShell(view);
  for (let from = 0; from < view.rowCount; from += ROWS_PER_BATCH) {
    if (from > 0) await nextTask();
    ctx.signal.throwIfAborted();
    const to = Math.min(from + ROWS_PER_BATCH, view.rowCount);
    appendRows(grid, view, from, to);
    ctx.progress(to, view.rowCount);
  }
  return grid.table;
}

function buildGrid(view: SheetView): HTMLElement {
  if (view.rowCount === 0) return emptySheet(view);
  const grid = gridShell(view);
  appendRows(grid, view, 0, view.rowCount);
  return grid.table;
}

function sheetTabs(views: readonly SheetView[], firstGrid: HTMLElement): HTMLElement {
  const preview = element('div', 'xlsx-preview');
  const style = element('style');
  style.textContent = STYLES;
  const panels = element('div', 'xlsx-panels');
  const tabList = element('div', 'xlsx-tabs');
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', 'Sheets');

  const tabs = views.map((view, i) => {
    const tab = element('button', 'xlsx-tab');
    tab.type = 'button';
    tab.id = `xlsx-tab-${i}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `xlsx-panel-${i}`);
    tab.textContent = view.name;
    if (view.hidden) {
      const mark = element('span', 'xlsx-hidden-mark');
      mark.textContent = ' (hidden)';
      tab.append(mark);
    }
    tab.addEventListener('click', () => select(i));
    return tab;
  });
  const builtPanels = new Map<number, HTMLElement>();

  function panel(i: number): HTMLElement {
    let node = builtPanels.get(i);
    if (!node) {
      node = element('div', 'xlsx-panel');
      node.id = `xlsx-panel-${i}`;
      node.setAttribute('role', 'tabpanel');
      node.setAttribute('aria-labelledby', `xlsx-tab-${i}`);
      node.append(i === 0 ? firstGrid : buildGrid(views[i]));
      builtPanels.set(i, node);
      panels.append(node);
    }
    return node;
  }

  /* The first panel stays in the document, hidden while another tab is open.
     Any other panel is removed when its tab is left and built again if the tab
     is opened again, so at most two grids are alive at once. */
  function select(selected: number): void {
    const shown = panel(selected);
    tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String(i === selected)));
    for (const [i, node] of builtPanels) {
      if (i === 0 || i === selected) {
        node.hidden = node !== shown;
      } else {
        node.remove();
        builtPanels.delete(i);
      }
    }
  }

  tabList.append(...tabs);
  preview.append(style, panels, tabList);
  select(0);
  return preview;
}

async function render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary> {
  ctx.progress(0, null);
  ctx.signal.throwIfAborted();
  const data = new Uint8Array(bytes);
  checkFormat(data);
  const views = await readViews(data, ctx);
  ctx.signal.throwIfAborted();
  const firstGrid = await buildFirstGrid(views[0], ctx);
  ctx.root.append(sheetTabs(views, firstGrid));
  return { type: 'xlsx', units: views.length, truncated: views.some((view) => view.truncated) };
}

export default { type: 'xlsx', render } satisfies RendererModule;
