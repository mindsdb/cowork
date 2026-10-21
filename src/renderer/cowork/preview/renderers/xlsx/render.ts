/*
 * The .xlsx preview: a read-only grid for each sheet, with one tab per sheet.
 *
 * SheetJS parses the workbook with HTML and styles off and stops each sheet at
 * maxSheetRows. The grid starts at A1 and shows at most maxSheetRows rows and
 * maxSheetColumns columns. Every cell goes in through textContent, so markup in
 * a cell shows as text and no cell becomes a link. The grid reads each cell's
 * value and formatted text only, never its formula, hyperlink, comment or
 * rich-text runs.
 *
 * The first sheet's grid is built before render() resolves, in batches that
 * report progress and check the abort signal. Every other sheet's grid is
 * built when its tab is first opened.
 */
import { read, type CellObject, type WorkBook, type WorkSheet } from 'xlsx';

import type { PreviewError, PreviewErrorCode, PreviewLimits, RenderSummary, RendererContext } from '../../contract';
import type { RendererModule } from '../../hooks';

const ROWS_PER_BATCH = 100;
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

/* One sheet as the grid shows it. rowCount and columnCount are already cut to
   the caps; truncated says the file may hold more than that (see sheetView). */
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

function previewError(code: PreviewErrorCode, message: string): PreviewError {
  return Object.assign(new Error(message), { code });
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

function parseWorkbook(bytes: Uint8Array, limits: PreviewLimits): WorkBook {
  if (startsWith(bytes, COMPOUND_FILE_MAGIC)) {
    throw previewError('unsupported', 'The workbook is encrypted or in the older .xls format.');
  }
  /* SheetJS also reads CSV, HTML and other text formats. A real .xlsx is a zip,
     and the runtime's archive guard has checked every zip before render(), so
     SheetJS gets only a zip. */
  if (!startsWith(bytes, ZIP_MAGIC)) {
    throw previewError('parse-failed', 'The file is not an .xlsx workbook.');
  }
  try {
    return read(bytes, { type: 'array', dense: true, cellHTML: false, cellStyles: false, sheetRows: limits.maxSheetRows });
  } catch {
    throw previewError('parse-failed', "SheetJS couldn't read the workbook.");
  }
}

/* A sheet counts as cut when SheetJS sets !fullref, which it does when the
   sheet's <dimension> reaches past sheetRows; when its rows fill the row cap;
   or when a row runs past the column cap, a row's length being one past its
   last cell. SheetJS stops at sheetRows without a word when the file has no
   <dimension> or a short one, so a sheet that ends exactly at the row cap
   counts as cut too. */
function sheetView(name: string, sheet: WorkSheet | undefined, hidden: boolean, limits: PreviewLimits): SheetView {
  const rows: readonly SheetRow[] = sheet?.['!data'] ?? [];
  const widest = rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  return {
    name,
    hidden,
    rows,
    rowCount: Math.min(rows.length, limits.maxSheetRows),
    columnCount: Math.min(widest, limits.maxSheetColumns),
    truncated: typeof sheet?.['!fullref'] === 'string' || rows.length >= limits.maxSheetRows || widest > limits.maxSheetColumns,
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

  function select(selected: number): void {
    const shown = panel(selected);
    tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String(i === selected)));
    for (const node of builtPanels.values()) node.hidden = node !== shown;
  }

  tabList.append(...tabs);
  preview.append(style, panels, tabList);
  select(0);
  return preview;
}

async function render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary> {
  ctx.progress(0, null);
  ctx.signal.throwIfAborted();
  const workbook = parseWorkbook(new Uint8Array(bytes), ctx.limits);
  ctx.signal.throwIfAborted();
  const views = workbook.SheetNames.map((name, i) => (
    sheetView(name, workbook.Sheets[name], !!workbook.Workbook?.Sheets?.[i]?.Hidden, ctx.limits)
  ));
  if (views.length === 0) throw previewError('parse-failed', 'The workbook has no sheets.');
  const firstGrid = await buildFirstGrid(views[0], ctx);
  ctx.root.append(sheetTabs(views, firstGrid));
  return { type: 'xlsx', units: views.length, truncated: views.some((view) => view.truncated) };
}

export default { type: 'xlsx', render } satisfies RendererModule;
