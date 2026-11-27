import { describe, expect, it } from 'vitest';
import {
  DOC_ANCHOR, commentedBlocks, docAnchorStates, docCommentSelector, locateComment, pageBlockId, parseDocAnchor, threadLocations,
} from './docComments';

const doc = {
  tabs: [
    { id: 't_1', title: 'Plan', blocks: [{ id: 'b_1' }, { id: 'b_2' }] },
    { id: 't_2', title: 'Risks', blocks: [{ id: 'b_3' }] },
  ],
};

describe('docCommentSelector', () => {
  it('names the tab, the blocks and the words, and reads back', () => {
    const selector = docCommentSelector({ tab: 't_1', blockIds: ['b_1', 'b_2'], quote: '  Acme   is\nthe pick ' });
    expect(parseDocAnchor(selector)).toEqual({ tab: 't_1', blocks: ['b_1', 'b_2'], quote: 'Acme is the pick' });
    expect(JSON.parse(selector).type).toBe(DOC_ANCHOR);
  });

  it('stays within what the comments services keep, cutting the quote', () => {
    const selector = docCommentSelector({ tab: 't_1', blockIds: ['b_1'], quote: '"'.repeat(5000) });
    expect(selector.length).toBeLessThanOrEqual(2000);
    const { quote, blocks } = parseDocAnchor(selector);
    expect(blocks).toEqual(['b_1']);
    expect(quote.endsWith('…')).toBe(true);
  });

  it('keeps a comment with no words picked', () => {
    expect(parseDocAnchor(docCommentSelector({ tab: 't_2', blockIds: ['b_3'] }))).toEqual({ tab: 't_2', blocks: ['b_3'], quote: '' });
  });

  it('carries the CSS the shared page finds the blocks by', () => {
    const selector = docCommentSelector({ tab: 't_1', blockIds: ['b_1', 'b_2'], quote: 'x' });
    expect(JSON.parse(selector).css).toBe('#blk-b_1, #blk-b_2');
  });

  it('leaves out of the CSS a block the page gives no id to', () => {
    expect(JSON.parse(docCommentSelector({ tab: 't_1', blockIds: ['b 1', 'b_2'] })).css).toBe('#blk-b_2');
    expect(JSON.parse(docCommentSelector({ tab: 't_1', blockIds: ['b 1'] })).css).toBeUndefined();
  });

  it('keeps every block when the ids are long, cutting the CSS and the words to fit', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `b_${String(i).padStart(2, '0')}${'a'.repeat(60)}`);
    const selector = docCommentSelector({ tab: 't_1', blockIds: ids, quote: 'word '.repeat(400) });
    expect(selector.length).toBeLessThanOrEqual(2000);
    const value = JSON.parse(selector);
    expect(value.blocks).toEqual(ids);
    const css = value.css.split(', ');
    expect(css.length).toBeGreaterThan(0);
    expect(css.length).toBeLessThan(20);
    expect(css).toEqual(ids.slice(0, css.length).map((id) => `#blk-${id}`));
  });

  it('drops blocks from the end when even their ids do not fit', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `${i}${'y'.repeat(199)}`);
    const selector = docCommentSelector({ tab: 't_1', blockIds: ids });
    expect(selector.length).toBeLessThanOrEqual(2000);
    const value = JSON.parse(selector);
    expect(value.blocks.length).toBeGreaterThan(0);
    expect(value.blocks).toEqual(ids.slice(0, value.blocks.length));
    expect(value.css).toBeUndefined();
  });
});

describe('parseDocAnchor', () => {
  it('is null for an artifact selector: a CSS path or a page text range', () => {
    expect(parseDocAnchor('#chart')).toBeNull();
    expect(parseDocAnchor(JSON.stringify({ type: 'text-range', quote: 'Acme' }))).toBeNull();
    expect(parseDocAnchor(null)).toBeNull();
  });
});

describe('locateComment', () => {
  it('finds the tab the blocks are in now, and only those still there', () => {
    const selector = docCommentSelector({ tab: 't_1', blockIds: ['b_3', 'b_gone'], quote: 'Late' });
    expect(locateComment(doc, selector)).toEqual({ tabId: 't_2', blockIds: ['b_3'], quote: 'Late' });
  });

  it('is null once every block is gone', () => {
    expect(locateComment(doc, docCommentSelector({ tab: 't_1', blockIds: ['b_gone'] }))).toBeNull();
  });
});

describe('a comment made on the shared page', () => {
  it('is on the block its path starts at, wherever inside it was made', () => {
    for (const selector of [
      '#blk-b_3',
      '#blk-b_3 > strong',
      '#blk-b_3 > table > tbody > tr:nth-of-type(2) > td:nth-of-type(3)',
      '#blk-b_3 td',
    ]) {
      expect(locateComment(doc, selector)).toEqual({ tabId: 't_2', blockIds: ['b_3'], quote: '' });
    }
  });

  it('is nowhere once its block is gone, or when it was made on no block', () => {
    expect(locateComment(doc, '#blk-b_gone')).toBeNull();
    expect(locateComment(doc, 'main > h1.page-title')).toBeNull();
    expect(locateComment(doc, '#tab-1 > p:nth-of-type(3)')).toBeNull();
    expect(locateComment(doc, '#blk-b_3.note')).toBeNull();
  });

  it('takes the block id from the first step only', () => {
    expect(pageBlockId('#blk-b_1 > p')).toBe('b_1');
    expect(pageBlockId('main #blk-b_1')).toBeNull();
    expect(pageBlockId(`#blk-${'x'.repeat(65)}`)).toBeNull();
    expect(pageBlockId(null)).toBeNull();
    expect(pageBlockId(docCommentSelector({ tab: 't_1', blockIds: ['b_1'] }))).toBeNull();
  });

  it('reads as not attached once its block is gone, and as not visible here off any block', () => {
    const shared = [
      { id: 'on', selector: '#blk-b_1 > strong', status: 'open' },
      { id: 'gone', selector: '#blk-b_gone', status: 'open' },
      { id: 'title', selector: 'main > h1.page-title', status: 'open' },
    ];
    const where = threadLocations(doc, shared);
    expect(docAnchorStates(shared, where)).toEqual({ gone: 'orphan', title: 'hidden' });
    expect([...commentedBlocks(shared, where)]).toEqual(['b_1']);
  });
});

describe('the inbox and the page', () => {
  const threads = [
    { id: 'general', selector: null, status: 'open' },
    { id: 'here', selector: docCommentSelector({ tab: 't_1', blockIds: ['b_1'] }), status: 'open' },
    { id: 'done', selector: docCommentSelector({ tab: 't_1', blockIds: ['b_2'] }), status: 'resolved' },
    { id: 'gone', selector: docCommentSelector({ tab: 't_1', blockIds: ['b_gone'] }), status: 'open' },
    { id: 'page', selector: '#chart', status: 'open' },
  ];

  const locations = threadLocations(doc, threads);

  it('marks doc comments whose blocks are gone as not attached, and shared-page ones as not visible here', () => {
    expect(docAnchorStates(threads, locations)).toEqual({ gone: 'orphan', page: 'hidden' });
  });

  it('marks the blocks open comments are on', () => {
    expect([...commentedBlocks(threads, locations)]).toEqual(['b_1']);
  });
});
