// Caret and selection helpers for contentEditable blocks.
import { htmlToInline } from './docModel';

function selectionIn(el) {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  return { sel, range };
}

/** Plain-text offset of the caret within `el` (selection start). */
export function caretOffset(el) {
  const hit = selectionIn(el);
  if (!hit) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(hit.range.startContainer, hit.range.startOffset);
  return pre.toString().length;
}

export function caretState(el) {
  const hit = selectionIn(el);
  if (!hit) return { has: false, collapsed: true, atStart: false, atEnd: false };
  const len = (el.textContent || '').length;
  const start = caretOffset(el);
  const endRange = document.createRange();
  endRange.selectNodeContents(el);
  endRange.setEnd(hit.range.endContainer, hit.range.endOffset);
  const end = endRange.toString().length;
  return { has: true, collapsed: hit.range.collapsed, atStart: start === 0 && hit.range.collapsed, atEnd: end === len && hit.range.collapsed, start, end, len };
}

/** Is the caret on the first / last visual line of `el`? (for ArrowUp/Down hops) */
export function caretOnEdgeLine(el, edge) {
  const hit = selectionIn(el);
  if (!hit || !hit.range.collapsed) return false;
  const rects = hit.range.getClientRects();
  const box = el.getBoundingClientRect();
  const rect = rects.length ? rects[0] : null;
  if (!rect || (rect.top === 0 && rect.bottom === 0)) {
    const s = caretState(el);
    return edge === 'top' ? s.atStart : s.atEnd;
  }
  const lineH = parseFloat(getComputedStyle(el).lineHeight) || 22;
  return edge === 'top' ? rect.top - box.top < lineH * 0.8 : box.bottom - rect.bottom < lineH * 0.8;
}

/** Inline Markdown before and after the caret (selection is deleted first). */
export function splitAtCaret(el) {
  const hit = selectionIn(el);
  if (!hit) return { before: htmlToInline(el), after: '' };
  if (!hit.range.collapsed) hit.range.deleteContents();
  const head = document.createRange();
  head.selectNodeContents(el);
  head.setEnd(hit.range.startContainer, hit.range.startOffset);
  const tail = document.createRange();
  tail.selectNodeContents(el);
  tail.setStart(hit.range.startContainer, hit.range.startOffset);
  const wrapA = document.createElement('div');
  wrapA.appendChild(head.cloneContents());
  const wrapB = document.createElement('div');
  wrapB.appendChild(tail.cloneContents());
  return { before: htmlToInline(wrapA), after: htmlToInline(wrapB) };
}

/** Place the caret at 'start' | 'end' | a plain-text offset, or select it 'all'. */
export function placeCaret(el, where = 'end') {
  if (!el) return;
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (where === 'all') {
    range.selectNodeContents(el);
  } else if (where === 'start' || where === 0) {
    range.selectNodeContents(el);
    range.collapse(true);
  } else if (where === 'end' || typeof where !== 'number') {
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    let remaining = where;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let placed = false;
    while (node) {
      const len = node.nodeValue.length;
      if (remaining <= len) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
        break;
      }
      remaining -= len;
      node = walker.nextNode();
    }
    if (!placed) {
      range.selectNodeContents(el);
      range.collapse(false);
    }
  }
  sel.removeAllRanges();
  sel.addRange(range);
  const rect = el.getBoundingClientRect();
  const scroller = el.closest('.doc-scroll');
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) el.scrollIntoView({ block: 'nearest' });
  }
}

/** Wrap the current selection (inside `el`) in an inline element. */
export function wrapSelection(el, tag, attrs = {}) {
  const hit = selectionIn(el);
  if (!hit || hit.range.collapsed) return false;
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  try {
    node.appendChild(hit.range.extractContents());
    hit.range.insertNode(node);
    hit.sel.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(node);
    hit.sel.addRange(after);
    return true;
  } catch {
    return false;
  }
}

const COMMANDS = { bold: 'bold', italic: 'italic', strike: 'strikeThrough' };

/** Bold, italic, strike or code on the selection inside `el`, as an edit the editable commits. */
export function applyInlineFormat(kind, el) {
  if (kind !== 'code') {
    document.execCommand(COMMANDS[kind]);
    return;
  }
  // No browser command for code: wrap by hand and say the text changed.
  if (wrapSelection(el, 'code')) el.dispatchEvent(new Event('input', { bubbles: true }));
}
