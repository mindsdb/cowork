/*
 * Build settings for the xlsx preview bundle: one plugin that makes three
 * edits to SheetJS's module. The build fails unless each edit's text appears
 * exactly once in that module, so a SheetJS change that moves one can't slip
 * through. render.test.ts runs the renderer on SheetJS with these edits made.
 *
 * - SheetJS checks whether it runs in Node by reading `process.versions`. In
 *   the preview frame it never does, so the check becomes `false`, which is
 *   what it evaluates to in a browser, and the bundle keeps no `process.`
 *   reference.
 * - The preview reads with cell text off and formats each cell it shows
 *   itself (render.ts cellText). With cell text off, SheetJS keeps no number
 *   format for a cell whose built-in format id the file doesn't write out,
 *   such as currency (5 to 8), accounting (41 to 44) and East Asian dates (27
 *   to 36, 50 to 58), the way openpyxl and XlsxWriter save them, because it
 *   loads those formats only while it makes cell text. The edit loads the
 *   format before SheetJS keeps it, as SheetJS does with cell text on.
 * - With cell text off, SheetJS also drops an error cell's text, and it
 *   keeps no code for an error it doesn't know, such as #SPILL!. The edit
 *   keeps the text, as SheetJS does with cell text on.
 */
const SHEETJS_MODULE = '/node_modules/xlsx/xlsx.mjs';

const EDITS = [
  {
    name: "SheetJS's Node check",
    from: "typeof Buffer !== 'undefined' && typeof process !== 'undefined' && typeof process.versions !== 'undefined' && !!process.versions.node",
    to: 'false',
  },
  {
    name: "SheetJS's number format for a cell",
    from: 'if(opts.cellNF) p.z = table_fmt[fmtid];',
    to: 'if(table_fmt[fmtid] == null) SSF__load(SSFImplicit[fmtid] || "General", fmtid); if(opts.cellNF) p.z = table_fmt[fmtid];',
  },
  {
    name: "SheetJS's text for an error cell",
    from: 'if(!opts || opts.cellText !== false) p.w = p.v;',
    to: 'p.w = p.v;',
  },
];

const editSheetjs = {
  name: 'xlsx-preview-edit-sheetjs',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith(SHEETJS_MODULE)) return null;
    let edited = code;
    for (const { name, from, to } of EDITS) {
      const parts = edited.split(from);
      if (parts.length !== 2) {
        throw new Error(`Expected ${name} once in ${id}, found it ${parts.length - 1} times`);
      }
      edited = parts.join(to);
    }
    return { code: edited, map: null };
  },
};

export default { plugins: [editSheetjs] };
