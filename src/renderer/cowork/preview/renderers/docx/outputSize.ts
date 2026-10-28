/*
 * How many nodes docx-preview would build for a parsed document, counted
 * before renderDocument builds any. Output can grow far past the file:
 * docx-preview renders the header and footer again on every page, a footnote
 * or endnote again for every reference to it, and the children of a
 * superscript or subscript run twice. So a 2 KB file with 4,000 page breaks
 * and a 1,000-paragraph header asks for about 8 million elements, and no
 * archive cap sees it, because the XML stays small.
 */

/* One element of docx-preview's parsed tree, by the fields renderDocument
   reads to lay out pages and notes and to decide how many nodes an element
   builds. docx-preview types its parsed document as any, so these
   interfaces name only what this file reads. A value the file doesn't give
   is null or missing. */
export interface ParsedElement {
  type: string;
  children?: ParsedElement[];
  /* A footnote or endnote, or a reference to one: the note's id. */
  id?: string | null;
  /* A break: page, column, textWrapping or lastRenderedPageBreak. */
  break?: string | null;
  /* A paragraph's own pageBreakBefore, style id and section end. */
  pageBreakBefore?: boolean;
  styleName?: string | null;
  sectionProps?: ParsedSection | null;
  /* A run's w:vertAlign as a tag name, sup or sub, or null for neither. */
  verticalAlign?: string | null;
  /* A table's w:gridCol entries. */
  columns?: readonly unknown[] | null;
  /* A row's w:gridBefore and w:gridAfter cell counts. */
  gridBefore?: number | null;
  gridAfter?: number | null;
}

export interface HeaderFooterReference { id: string | null; type: string | null }

export interface ParsedSection { headerRefs?: HeaderFooterReference[]; footerRefs?: HeaderFooterReference[] }

export interface ParsedStyle { id?: string | null; basedOn?: string | null; paragraphProps?: { pageBreakBefore?: boolean } }

export interface ParsedWordDocument {
  /* parseAsync can resolve without one, when the package names a document
     part the zip doesn't hold. render() fails such a file with parse-failed
     before it estimates. */
  documentPart: { body: ParsedElement & { children: ParsedElement[]; props?: ParsedSection | null } };
  stylesPart?: { styles?: ParsedStyle[] } | null;
  footnotesPart?: { notes?: ParsedElement[] } | null;
  endnotesPart?: { notes?: ParsedElement[] } | null;
  /* The part a relationship id of basePart names. A header or footer part
     holds its tree in rootElement. */
  findPartByRelId(id: string | null, basePart: unknown): { rootElement?: ParsedElement } | null | undefined;
}

/*
 * The most nodes a Word preview may build is ctx.limits.maxDocxNodes,
 * 2,097,152, which render() checks this file's count against. It was measured
 * against docx-preview in Chrome: a 3,000-page document of 25 paragraphs a
 * page, each of four runs, with a header and a footer, counts about 735,000,
 * and docx-preview's 411,000 elements for it took 1.5 GB. With eight runs a
 * paragraph it counts about 1,335,000, for 711,000 elements and 2.6 GB. A
 * 196 KB file of 1.97 million one-line paragraphs, which passes every archive
 * cap, counts about 5.9 million, and docx-preview's 3.9 million elements for
 * it took 7 to 8 GB. Scaled from these, a document right at the cap takes
 * about 4 GB, and touch devices get the same cap.
 */

/*
 * The nodes docx-preview's HtmlRenderer builds for one element, its children
 * aside. Most elements build one. The rest, by the render method that builds
 * them:
 * - renderTab, renderSymbol and the note references build a <span> or <sup>
 *   and the text in it, and renderVmlElement an <svg> around the shape;
 * - renderRun builds a <span> and, for superscript or subscript, a <sup> or
 *   <sub> inside it;
 * - renderTable builds a <table> and a <colgroup> of one <col> for each
 *   w:gridCol, and renderTableRow a <tr> and a placeholder <td> each for
 *   w:gridBefore and w:gridAfter;
 * - the math methods build an <mrow> or <mtable> and the <mo> operators,
 *   with their text, around the children: a group character's one, a
 *   delimiter's two, a pre-sub-superscript's <msubsup> and three, an n-ary's
 *   <munderover> and three, and an equation array's <mtr> and <mtd> for
 *   each child.
 */
function ownNodes(element: ParsedElement): number {
  switch (element.type) {
    case 'tab':
    case 'symbol':
    case 'footnoteReference':
    case 'endnoteReference':
    case 'vmlElement':
      return 2;
    case 'run':
      return element.verticalAlign ? 2 : 1;
    case 'table':
      return 1 + (element.columns ? 1 + element.columns.length : 0);
    case 'row':
      return 1 + (element.gridBefore ? 1 : 0) + (element.gridAfter ? 1 : 0);
    case 'mmlGroupChar':
      return 3;
    case 'mmlDelimiter':
    case 'mmlPreSubSuper':
      return 5;
    case 'mmlNary':
      return 6;
    case 'mmlEquationArray':
      return 1 + 2 * (element.children?.length ?? 0);
    default:
      return 1;
  }
}

/*
 * Counts the nodes root and everything under it build. A reference to a note
 * adds what noteSize says that note renders. renderRun renders a superscript
 * or subscript run's children twice and keeps the second copy, and the first
 * copy's note references still list their notes, so everything under such a
 * run counts twice, and four times under two of them: a VML text box can
 * hold another such run. A stack rather than recursion, so deeply nested
 * tables can't overflow the call stack.
 */
function countNodes(root: ParsedElement, noteSize: (element: ParsedElement) => number = () => 0): number {
  let count = 0;
  const pending: [ParsedElement, number][] = [[root, 1]];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [element, renders] = next;
    count += renders * (ownNodes(element) + noteSize(element));
    const childRenders = element.type === 'run' && element.verticalAlign ? 2 * renders : renders;
    for (const child of element.children ?? []) pending.push([child, childRenders]);
  }
  return count;
}

/*
 * The style ids whose paragraphs may start a page: a style that sets
 * pageBreakBefore, or one based on such a style at any depth. docx-preview
 * merges a base style's paragraph properties into the style before it reads
 * them, so this set holds every style it treats as breaking, and maybe more.
 */
function pageBreakStyles(styles: readonly ParsedStyle[]): Set<string> {
  const byId = new Map<string, ParsedStyle>();
  for (const style of styles) if (typeof style.id === 'string') byId.set(style.id, style);
  const settled = new Map<string, boolean>();
  for (const id of byId.keys()) {
    /* Walks up the basedOn chain to a style that answers: one that sets
       pageBreakBefore, one already settled, a missing base or a loop. Every
       style on the way gets that answer, so each style is walked once. */
    const chain = new Set<string>();
    let breaks = false;
    for (let at: string | null | undefined = id; typeof at === 'string' && !chain.has(at); at = byId.get(at)?.basedOn) {
      const known = settled.get(at);
      const style = byId.get(at);
      if (known !== undefined || !style) {
        breaks = known ?? false;
        break;
      }
      chain.add(at);
      if (style.paragraphProps?.pageBreakBefore) {
        breaks = true;
        break;
      }
    }
    for (const step of chain) settled.set(step, breaks);
  }
  return new Set(Array.from(settled).filter(([, breaks]) => breaks).map(([id]) => id));
}

function isPageBreak(element: ParsedElement): boolean {
  return element.type === 'break' && element.break === 'page';
}

/*
 * The pages docx-preview lays out, the way its splitBySection does with
 * breakPages on: a top-level paragraph starts a page before it when it or
 * its style sets pageBreakBefore, and after it when it ends a section or a
 * run directly in it holds a page break. Plus the first page.
 */
function countPages(body: readonly ParsedElement[], styles: readonly ParsedStyle[]): number {
  const breakingStyles = pageBreakStyles(styles);
  let pages = 1;
  for (const element of body) {
    if (element.type !== 'paragraph') continue;
    if (element.pageBreakBefore || breakingStyles.has(element.styleName ?? '')) pages += 1;
    if (element.sectionProps || element.children?.some((child) => child.children?.some(isPageBreak))) pages += 1;
  }
  return pages;
}

/* The nodes renderSections builds for each page besides its header, footer
   and content: the page's <section>, the <article> that holds the content,
   the <ol> its footnotes go in, and the paragraph and the run, with its
   <sup> or <sub>, that splitBySection cuts in two at the page break that
   ends the page. */
const PAGE_NODES = 6;

/*
 * The nodes renderDocument would build: the body, each footnote and endnote
 * again for every time a reference to it renders, and on every page its own
 * nodes, a header and a footer. An upper bound: every page gets the largest
 * header and the largest footer that any section names.
 */
export function estimateOutputNodes(wordDocument: ParsedWordDocument): number {
  /* Every endnote reference that renders anywhere lists its endnote on the
     last page, the one in a footnote too, each time the footnote renders.
     A note's footnote references and an endnote's endnote references list
     nothing more: by the time a note renders, docx-preview has picked the
     notes that page lists. */
  const endnotes = new Map<string | null | undefined, number>();
  for (const note of wordDocument.endnotesPart?.notes ?? []) endnotes.set(note.id, countNodes(note));
  const endnoteSize = (element: ParsedElement) => (element.type === 'endnoteReference' ? endnotes.get(element.id) ?? 0 : 0);
  const footnotes = new Map<string | null | undefined, number>();
  for (const note of wordDocument.footnotesPart?.notes ?? []) footnotes.set(note.id, countNodes(note, endnoteSize));
  const noteSize = (element: ParsedElement) => (element.type === 'footnoteReference' ? footnotes.get(element.id) ?? 0 : endnoteSize(element));

  const { body } = wordDocument.documentPart;
  const sections = [body.props, ...body.children.map((element) => element.sectionProps)];
  const partSizes = new Map<ParsedElement, number>();
  const largestPart = (largest: number, refs: readonly HeaderFooterReference[] = []) => refs.reduce((max, ref) => {
    const root = wordDocument.findPartByRelId(ref.id, wordDocument.documentPart)?.rootElement;
    if (!root) return max;
    if (!partSizes.has(root)) partSizes.set(root, countNodes(root, noteSize));
    return Math.max(max, partSizes.get(root)!);
  }, largest);
  const header = sections.reduce((largest, section) => largestPart(largest, section?.headerRefs), 0);
  const footer = sections.reduce((largest, section) => largestPart(largest, section?.footerRefs), 0);

  return countNodes(body, noteSize) + countPages(body.children, wordDocument.stylesPart?.styles ?? []) * (PAGE_NODES + header + footer);
}
