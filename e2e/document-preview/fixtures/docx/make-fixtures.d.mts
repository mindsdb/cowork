/* Hand-written declarations for make-fixtures.mjs, so TypeScript tests can
   import it under `npm run typecheck:test`. */

export interface FixtureFile { file: string; bytes: Uint8Array }

/* The .docx files fixtures.yaml lists, in its order, but for
   python-docx-report.docx. */
export declare function docxFixtureFiles(): Promise<FixtureFile[]>;
