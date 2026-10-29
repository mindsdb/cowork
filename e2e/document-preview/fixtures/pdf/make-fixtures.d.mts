/* Hand-written declarations for make-fixtures.mjs, so TypeScript tests can
   import it under `npm run typecheck:test`. */

export interface FixtureFile { file: string; bytes: Uint8Array }

/* The .pdf files fixtures.yaml lists, in its order. */
export declare function pdfFixtureFiles(): FixtureFile[];
