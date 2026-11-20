// Where a comment sits in a doc. A doc has no CSS path to pin to: a comment
// names the blocks it was made on (ids survive edits, moves and other tabs),
// the tab they were in, and the words picked, the same target "Edit with
// agent" sends. It is stored as the thread's selector, a JSON string the
// comments services keep as is (at most 2,000 characters).

export const DOC_ANCHOR = 'doc-block';

const SELECTOR_MAX = 2000;
const MAX_BLOCKS = 20;

/** The selector for a comment on `blockIds` in `tab`, with the picked `quote`. */
export function docCommentSelector({ tab, blockIds, quote = '' }) {
  const anchor = { type: DOC_ANCHOR, tab: tab || null, blocks: (blockIds || []).slice(0, MAX_BLOCKS) };
  // The quote fills what the ids leave, cut shorter while JSON escaping
  // still takes it over the limit.
  const words = String(quote || '').replace(/\s+/g, ' ').trim();
  for (let n = Math.min(words.length, SELECTOR_MAX); ; n = Math.floor(n * 0.8)) {
    const cut = n < words.length ? `${words.slice(0, n)}…` : words;
    const selector = JSON.stringify({ ...anchor, quote: n > 0 ? cut : '' });
    if (selector.length <= SELECTOR_MAX || n === 0) return selector;
  }
}

/** `{ tab, blocks, quote }` for a doc comment's selector; null for anything else. */
export function parseDocAnchor(selector) {
  if (!selector) return null;
  try {
    const value = JSON.parse(selector);
    if (value?.type !== DOC_ANCHOR || !Array.isArray(value.blocks)) return null;
    return {
      tab: typeof value.tab === 'string' ? value.tab : null,
      blocks: value.blocks.filter((id) => typeof id === 'string'),
      quote: typeof value.quote === 'string' ? value.quote : '',
    };
  } catch {
    return null;
  }
}

/**
 * Where the comment's blocks are now: the tab holding the first that is left
 * and those of its blocks still in that tab; null once they are all gone.
 */
export function locateComment(doc, selector) {
  const anchor = parseDocAnchor(selector);
  if (!anchor || !doc?.tabs) return null;
  const wanted = new Set(anchor.blocks);
  // The tab it was made in first: a block id is unique, but look there first anyway.
  const tabs = [...doc.tabs].sort((a, b) => (b.id === anchor.tab) - (a.id === anchor.tab));
  for (const tab of tabs) {
    const blockIds = tab.blocks.filter((b) => wanted.has(b.id)).map((b) => b.id);
    if (blockIds.length) return { tabId: tab.id, blockIds, quote: anchor.quote };
  }
  return null;
}

const isOpen = (thread) => thread.status !== 'resolved' && thread.status !== 'dismissed';

/**
 * The inbox's anchor states (InboxCard `state`): 'orphan' for a comment whose
 * place in the doc is gone, or that was made somewhere a doc can't point to
 * (the shared page's elements). General comments have no selector and no state.
 */
export function docAnchorStates(doc, threads) {
  const states = {};
  for (const thread of threads || []) {
    if (thread.selector && !locateComment(doc, thread.selector)) states[thread.id] = 'orphan';
  }
  return states;
}

/** The blocks open comments are on, to mark in the page. */
export function commentedBlocks(doc, threads) {
  const ids = new Set();
  for (const thread of threads || []) {
    if (!isOpen(thread) || !thread.selector) continue;
    for (const id of locateComment(doc, thread.selector)?.blockIds || []) ids.add(id);
  }
  return ids;
}
