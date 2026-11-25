import { describe, expect, it } from 'vitest';
import {
  DOC_ANCHOR, commentedBlocks, docAnchorStates, docCommentSelector, locateComment, parseDocAnchor, threadLocations,
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
