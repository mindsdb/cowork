/*
 * The Word output estimate, on parsed documents built here in the shape
 * docx-preview's parseAsync returns. Each case counts what renderDocument
 * would build: the body, each page's own nodes, a header and a footer per
 * page, a note per reference, and the extra nodes some elements build.
 * render.test.ts runs the same estimate on real fixtures.
 */
import { describe, expect, it } from 'vitest';

import { previewLimits } from '../../limits';
import {
  estimateOutputNodes,
  outputNodeBudget,
  type ParsedElement,
  type ParsedSection,
  type ParsedStyle,
  type ParsedWordDocument,
} from './outputSize';

/* The nodes each page builds besides its header, footer and content. */
const PAGE = 6;

/* A paragraph of one run of text: 3 nodes. */
function line(props: Partial<ParsedElement> = {}): ParsedElement {
  return { type: 'paragraph', children: [{ type: 'run', children: [{ type: 'text' }] }], ...props };
}

/* A paragraph whose run holds a page break: 3 nodes. */
function pageBreak(): ParsedElement {
  return { type: 'paragraph', children: [{ type: 'run', children: [{ type: 'break', break: 'page' }] }] };
}

/* A run that holds one reference to a note: 3 nodes, the reference's text
   included, and the note. */
function reference(type: 'footnoteReference' | 'endnoteReference', id: string): ParsedElement {
  return { type: 'run', children: [{ type, id }] };
}

/* A header or footer part's tree: its root and `lines` paragraphs. */
function part(type: 'header' | 'footer', lines: number): ParsedElement {
  return { type, children: Array.from({ length: lines }, () => line()) };
}

interface DocumentParts {
  body: ParsedElement[];
  props?: ParsedSection;
  styles?: ParsedStyle[];
  footnotes?: ParsedElement[];
  endnotes?: ParsedElement[];
  parts?: Record<string, ParsedElement>;
}

function parsedDocument({ body, props, styles, footnotes, endnotes, parts = {} }: DocumentParts): ParsedWordDocument {
  return {
    documentPart: { body: { type: 'document', children: body, props } },
    stylesPart: { styles },
    footnotesPart: { notes: footnotes },
    endnotesPart: { notes: endnotes },
    findPartByRelId: (id) => (id !== null && id in parts ? { rootElement: parts[id] } : null),
  };
}

describe('estimateOutputNodes', () => {
  it('counts every node of the body', () => {
    expect(estimateOutputNodes(parsedDocument({ body: [line(), line()] }))).toBe(1 + 3 + 3 + PAGE);
  });

  it('adds the header and the footer once for each page', () => {
    const document = parsedDocument({
      body: [line(), pageBreak(), pageBreak()],
      props: { headerRefs: [{ id: 'rIdHeader', type: 'default' }], footerRefs: [{ id: 'rIdFooter', type: 'default' }] },
      parts: { rIdHeader: part('header', 2), rIdFooter: part('footer', 1) },
    });
    expect(estimateOutputNodes(document)).toBe(10 + 3 * (PAGE + 7 + 4));
  });

  it('gives every page the largest header any section names', () => {
    const document = parsedDocument({
      body: [line({ sectionProps: { headerRefs: [{ id: 'rIdSmall', type: 'default' }] } }), line()],
      props: { headerRefs: [{ id: 'rIdFirst', type: 'first' }, { id: 'rIdMissing', type: 'default' }] },
      parts: { rIdSmall: part('header', 1), rIdFirst: part('header', 5) },
    });
    expect(estimateOutputNodes(document)).toBe(7 + 2 * (PAGE + 16));
  });

  it('starts a page at pageBreakBefore, on the paragraph or through its style and the styles it is based on', () => {
    const styles: ParsedStyle[] = [
      { id: 'Chapter', paragraphProps: { pageBreakBefore: true } },
      { id: 'ChapterTitle', basedOn: 'Chapter' },
      { id: 'Loop', basedOn: 'LoopBack' },
      { id: 'LoopBack', basedOn: 'Loop' },
      { id: 'Normal' },
    ];
    const document = parsedDocument({
      body: [line({ pageBreakBefore: true }), line({ styleName: 'Chapter' }), line({ styleName: 'ChapterTitle' }), line({ styleName: 'Loop' }), line({ styleName: 'Normal' })],
      styles,
      props: { headerRefs: [{ id: 'rIdHeader', type: 'default' }] },
      parts: { rIdHeader: part('header', 0) },
    });
    expect(estimateOutputNodes(document)).toBe(16 + 4 * (PAGE + 1));
  });

  it('starts a page after a section ends, and not at a break docx-preview leaves on the page', () => {
    const inHyperlink: ParsedElement = {
      type: 'paragraph',
      children: [{ type: 'hyperlink', children: [{ type: 'run', children: [{ type: 'break', break: 'page' }] }] }],
    };
    const rendered: ParsedElement = { type: 'paragraph', children: [{ type: 'run', children: [{ type: 'break', break: 'lastRenderedPageBreak' }] }] };
    const document = parsedDocument({
      body: [line({ sectionProps: {} }), inHyperlink, rendered],
      props: { headerRefs: [{ id: 'rIdHeader', type: 'default' }] },
      parts: { rIdHeader: part('header', 0) },
    });
    expect(estimateOutputNodes(document)).toBe(11 + 2 * (PAGE + 1));
  });

  it('adds a footnote or an endnote again for every reference to it', () => {
    const document = parsedDocument({
      body: [{ type: 'paragraph', children: [reference('footnoteReference', '1'), reference('footnoteReference', '1'), reference('endnoteReference', '1')] }],
      footnotes: [{ type: 'footnote', id: '1', children: [line(), line()] }],
      endnotes: [{ type: 'endnote', id: '1', children: [line()] }],
    });
    /* The document, then the paragraph, three runs and three references of 2
       nodes each. */
    expect(estimateOutputNodes(document)).toBe(1 + 10 + 2 * 7 + 4 + PAGE);
  });

  it('adds an endnote again each time a footnote that refers to it renders', () => {
    const document = parsedDocument({
      body: [{ type: 'paragraph', children: [reference('footnoteReference', '1'), reference('footnoteReference', '1'), reference('footnoteReference', '1')] }],
      footnotes: [{ type: 'footnote', id: '1', children: [{ type: 'paragraph', children: [reference('endnoteReference', '1')] }] }],
      endnotes: [{ type: 'endnote', id: '1', children: [line(), line(), line()] }],
    });
    /* Each footnote: itself, a paragraph, a run, a reference, and the endnote. */
    expect(estimateOutputNodes(document)).toBe(1 + 10 + 3 * (5 + 10) + PAGE);
  });

  it('counts a note a header refers to on every page', () => {
    const header: ParsedElement = { type: 'header', children: [reference('footnoteReference', '1')] };
    const document = parsedDocument({
      body: [pageBreak()],
      props: { headerRefs: [{ id: 'rIdHeader', type: 'default' }] },
      footnotes: [{ type: 'footnote', id: '1', children: [line()] }],
      parts: { rIdHeader: header },
    });
    expect(estimateOutputNodes(document)).toBe(4 + 2 * (PAGE + 4 + 4));
  });

  it('counts a superscript or subscript run\'s wrapper, and everything under it twice', () => {
    const superscript = (...children: ParsedElement[]): ParsedElement => ({ type: 'run', verticalAlign: 'sup', children });
    /* A paragraph, at the top or inside a VML text box. */
    const paragraphOf = (inner: ParsedElement): ParsedElement => ({ type: 'paragraph', children: [inner] });
    const document = parsedDocument({
      body: [
        paragraphOf(superscript({ type: 'text' })),
        paragraphOf(superscript(paragraphOf(superscript({ type: 'footnoteReference', id: '1' })))),
      ],
      footnotes: [{ type: 'footnote', id: '1', children: [line()] }],
    });
    /* The first paragraph: itself, the run and its <sup>, and its text twice.
       The second: itself, the run and its <sup>, then twice a paragraph and
       a run with its <sup>, then four times a reference and the footnote. */
    expect(estimateOutputNodes(document)).toBe(1 + (1 + 2 + 2) + (1 + 2 + 2 * (1 + 2) + 4 * (2 + 4)) + PAGE);
  });

  it('counts the extra nodes tables, tabs, symbols, VML shapes and math build', () => {
    const elements: [ParsedElement, number][] = [
      [{ type: 'table', columns: [{}, {}, {}] }, 1 + 1 + 3],
      [{ type: 'table', columns: null }, 1],
      [{ type: 'row', gridBefore: 1, gridAfter: 2 }, 1 + 1 + 1],
      [{ type: 'row', gridBefore: null }, 1],
      [{ type: 'tab' }, 2],
      [{ type: 'symbol' }, 2],
      [{ type: 'vmlElement' }, 2],
      [{ type: 'mmlGroupChar' }, 3],
      [{ type: 'mmlDelimiter' }, 5],
      [{ type: 'mmlPreSubSuper' }, 5],
      [{ type: 'mmlNary' }, 6],
      [{ type: 'mmlEquationArray', children: [{ type: 'mmlRun' }, { type: 'mmlRun' }] }, 1 + 2 * 2 + 2],
    ];
    for (const [element, nodes] of elements) {
      expect(estimateOutputNodes(parsedDocument({ body: [element] })), element.type).toBe(1 + nodes + PAGE);
    }
  });

  it('counts a tree nested far deeper than the call stack reaches', () => {
    let deepest: ParsedElement = { type: 'text' };
    for (let depth = 0; depth < 100_000; depth += 1) deepest = { type: 'run', children: [deepest] };
    expect(estimateOutputNodes(parsedDocument({ body: [deepest] }))).toBe(1 + 100_001 + PAGE);
  });
});

describe('outputNodeBudget', () => {
  it('derives the budget from maxInflatedBytes, 128 bytes a node', () => {
    const limits = previewLimits({ touch: false });
    expect(outputNodeBudget(limits)).toBe(2_097_152);
    expect(outputNodeBudget({ ...limits, maxInflatedBytes: 128 * 1000 })).toBe(1000);
  });
});
