/* Hand-written declarations for make-fixtures.mjs, so TypeScript tests can
   import it under `npm run typecheck:test`. */

/* A cell: text goes to the shared string table, a number is stored as is, a
   formula is stored with its cached value, and null leaves the cell out. */
export type FixtureCell = string | number | null | { formula: string; cached: string };

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
}

/* An externalLink part pointing at another workbook, with one cached cell. */
export interface FixtureExternalLink { target: string; sheetName: string; cachedValue: string }

export interface FixtureWorkbook { sheets: readonly FixtureSheet[]; externalLink?: FixtureExternalLink }

export interface FixtureFile { file: string; bytes: Uint8Array }

export declare function buildWorkbook(workbook: FixtureWorkbook): Promise<Uint8Array>;

export declare function xlsxFixtureFiles(): Promise<FixtureFile[]>;
