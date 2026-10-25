/* Hand-written declarations for make-fixtures.mjs, so TypeScript tests can
   import it under `npm run typecheck:test`. */

/* A cell: text goes to the shared string table, a number is stored as is, a
   boolean and an error text are stored with their cell types, a number with a
   format gets a cell style that shows it in that format code, a number with a
   formatId gets a cell style that names that built-in format id and no format
   code, the way openpyxl and XlsxWriter save Excel's built-in formats, a
   formula is stored with its cached value or, with none, an empty one, a
   formula with omitValue is stored with no value at all, the way ExcelJS
   saves a formula it was given no result for, a cell of a shared formula is
   stored as below, and null leaves the cell out. */
export type FixtureCell =
  | string
  | number
  | boolean
  | null
  | { error: string }
  | { number: number; format: string }
  | { number: number; formatId: number }
  | { formula: string; cached?: string }
  | { formula: string; omitValue: true }
  | FixtureSharedFormulaCell;

/* One cell of a shared formula, as Excel writes a formula filled down a
   column: every cell names the shared formula's index and holds its own cached
   result, and the first cell also holds the formula and the range it covers,
   such as G2:G2001. */
export interface FixtureSharedFormulaCell {
  shared: number;
  cached: number;
  formula?: string;
  ref?: string;
  format?: string;
}

/* A hyperlink on one cell, written as an External relationship. */
export interface FixtureHyperlink { ref: string; target: string }

export interface FixtureSheet {
  name: string;
  rows: readonly (readonly FixtureCell[])[];
  hyperlinks?: readonly FixtureHyperlink[];
  /* Leave the r attribute off every cell, as ECMA-376 allows. */
  omitCellRefs?: boolean;
  /* Leave out the sheet's <dimension>, which ECMA-376 makes optional. */
  omitDimension?: boolean;
  /* Mark the sheet hidden in the workbook. */
  hidden?: boolean;
  /* Mark the sheet very hidden, which Excel's Unhide list leaves out. */
  veryHidden?: boolean;
  /* Leave the sheet's worksheet part out of the zip, while the workbook still
     lists the sheet. */
  omitPart?: boolean;
  /* Write the sheet as a chart sheet with no drawing; its rows are ignored. */
  chart?: boolean;
  /* Give the worksheet a drawing part, the part a chart or picture placed on
     a worksheet is saved in, holding no shape. Its rows are written as
     usual. */
  drawing?: boolean;
  /* Give the sheet no part of its own: its relationship's Target is this, such
     as another sheet's part. Its rows are ignored. */
  target?: string;
}

/* An externalLink part pointing at another workbook, with one cached cell. */
export interface FixtureExternalLink { target: string; sheetName: string; cachedValue: string }

export interface FixtureWorkbook {
  sheets: readonly FixtureSheet[];
  externalLink?: FixtureExternalLink;
  /* Count dates from 1904, as <workbookPr date1904="1"/> says. */
  date1904?: boolean;
  /* The tab the workbook was saved on, as <workbookView activeTab="n"/>
     says. */
  activeTab?: number;
  /* Ask for every formula to be calculated on open, as <calcPr fullCalcOnLoad="1"/>
     says. Writers that save formulas without their results set it. */
  calcOnLoad?: boolean;
}

export interface FixtureFile { file: string; bytes: Uint8Array }

/* The origin the hostile fixture's harness-origin hyperlink aims at. */
export declare const HARNESS_ORIGIN: string;

export declare function buildWorkbook(workbook: FixtureWorkbook): Promise<Uint8Array>;

/* The zip with a Unicode Path extra field added to the directory record of
   each entry renames names, holding the entry's new name. JSZip lists such an
   entry under the new name, while SheetJS's zip reader still reads the name
   in the entry's local header. The zip must end in its end record with no
   comment, as JSZip writes it. */
export declare function withUnicodePaths(bytes: Uint8Array, renames: Readonly<Record<string, string>>): Uint8Array;

export declare function xlsxFixtureFiles(): Promise<FixtureFile[]>;
