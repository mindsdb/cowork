import { parse, parseFragment, serialize } from 'parse5';
import {
  createHtmlVisualEditorRuntime,
  HTML_VISUAL_EDITOR_ATTRIBUTE,
} from './htmlVisualEditorRuntime';

const PRIMARY_TEXT_TAGS = new Set([
  'address', 'blockquote', 'button', 'caption', 'dd', 'dt', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'legend', 'li', 'p', 'pre',
  'summary', 'td', 'th',
]);

const FALLBACK_TEXT_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'div', 'em', 'i', 'kbd',
  'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u',
]);

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'em', 'i', 'kbd',
  'mark', 'q', 'rp', 'rt', 'ruby', 's', 'small', 'span', 'strong', 'sub',
  'sup', 'time', 'u', 'wbr',
]);

const DROP_FRAGMENT_TAGS = new Set(['base', 'embed', 'iframe', 'object', 'script', 'style']);
const HTML_COMPARISON_ATTRIBUTE = 'data-cowork-comparison-change';
const EDITOR_STYLE = `
[${HTML_VISUAL_EDITOR_ATTRIBUTE}] { cursor: text !important; }
[${HTML_VISUAL_EDITOR_ATTRIBUTE}]:hover {
  outline: 1px dashed rgba(52, 195, 222, .92) !important;
  outline-offset: 4px !important;
}
[${HTML_VISUAL_EDITOR_ATTRIBUTE}][data-cowork-editor-selected] {
  outline: 2px solid rgb(52, 195, 222) !important;
  outline-offset: 4px !important;
  box-shadow: 0 0 0 5px rgba(52, 195, 222, .16) !important;
}
[${HTML_VISUAL_EDITOR_ATTRIBUTE}][contenteditable="true"] { caret-color: rgb(52, 195, 222) !important; }
[${HTML_VISUAL_EDITOR_ATTRIBUTE}]::selection { background: rgba(52, 195, 222, .28) !important; }
`;
const COMPARISON_STYLE = `
[${HTML_COMPARISON_ATTRIBUTE}] {
  outline: 2px solid rgb(38, 181, 207) !important;
  outline-offset: 5px !important;
  box-shadow: 0 0 0 5px rgba(38, 181, 207, .16) !important;
}
`;

function isElement(node) {
  return !!node?.tagName;
}

function getAttribute(node, name) {
  return node.attrs?.find((attribute) => attribute.name === name)?.value;
}

function meaningfulText(node) {
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(meaningfulText).join('');
}

function hasOnlyInlineContent(node) {
  return (node.childNodes || []).every((child) => {
    if (!isElement(child)) return child.nodeName !== '#documentType';
    return INLINE_TAGS.has(child.tagName) && hasOnlyInlineContent(child);
  });
}

function canEdit(node) {
  if (!node.sourceCodeLocation?.startTag || !node.sourceCodeLocation?.endTag) return false;
  if (getAttribute(node, 'contenteditable') === 'false') return false;
  if (getAttribute(node, 'aria-hidden') === 'true' || getAttribute(node, 'hidden') != null) return false;
  if (!meaningfulText(node).trim()) return false;
  return hasOnlyInlineContent(node);
}

function collectEditableNodes(root) {
  const candidates = [];
  const visit = (node) => {
    if (
      isElement(node)
      && (PRIMARY_TEXT_TAGS.has(node.tagName) || FALLBACK_TEXT_TAGS.has(node.tagName))
      && canEdit(node)
    ) {
      candidates.push(node);
      return;
    }
    for (const child of node.childNodes || []) {
      visit(child);
    }
  };
  visit(root);
  return candidates;
}

function nodePath(node) {
  const parts = [];
  let current = node;
  while (current?.parentNode) {
    if (isElement(current)) {
      const siblings = (current.parentNode.childNodes || [])
        .filter((sibling) => isElement(sibling) && sibling.tagName === current.tagName);
      parts.push(`${current.tagName}:${siblings.indexOf(current)}`);
    }
    current = current.parentNode;
  }
  return parts.reverse().join('/');
}

function normalizedText(node) {
  return meaningfulText(node).replace(/\s+/g, ' ').trim();
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function editorId(index) {
  return `cowork-edit-${index}`;
}

function setAttribute(node, name, value) {
  const current = node.attrs?.find((attribute) => attribute.name === name);
  if (current) current.value = value;
  else node.attrs = [...(node.attrs || []), { name, value }];
}

function headMarkup(baseUrl, markup) {
  const canResolveRelativeAssets = baseUrl && !/^(?:blob|data):/i.test(baseUrl);
  const base = canResolveRelativeAssets ? `<base href="${escapeAttribute(baseUrl)}">` : '';
  return `${base}${markup}`;
}

function insertIntoHead(html, markup) {
  return html.replace(/<head([^>]*)>/i, `<head$1>${markup}`);
}

function insertEditorRuntime(html, { baseUrl, token }) {
  const runtime = createHtmlVisualEditorRuntime(token);
  return insertIntoHead(
    html,
    headMarkup(baseUrl, `<script>${runtime}</script><style>${EDITOR_STYLE}</style>`),
  );
}

export function createHtmlVisualEditorDocument(content, { baseUrl = '', token }) {
  const document = parse(String(content || ''), { sourceCodeLocationInfo: true });
  const candidates = collectEditableNodes(document);
  candidates.forEach((node, index) => {
    setAttribute(node, HTML_VISUAL_EDITOR_ATTRIBUTE, editorId(index));
    if (getAttribute(node, 'tabindex') == null) setAttribute(node, 'tabindex', '0');
  });

  return {
    content: insertEditorRuntime(serialize(document), { baseUrl, token }),
    editableCount: candidates.length,
    elements: candidates.map((node, index) => ({
      id: editorId(index),
      start: node.sourceCodeLocation.startTag.endOffset,
      end: node.sourceCodeLocation.endTag.startOffset,
    })),
  };
}

export function createHtmlVisualComparisonDocuments(
  beforeContent,
  afterContent,
  { baseUrl = '' } = {},
) {
  const beforeDocument = parse(String(beforeContent || ''), { sourceCodeLocationInfo: true });
  const afterDocument = parse(String(afterContent || ''), { sourceCodeLocationInfo: true });
  const beforeNodes = collectEditableNodes(beforeDocument);
  const afterNodes = collectEditableNodes(afterDocument);
  const afterById = new Map(
    afterNodes.flatMap((node) => {
      const id = getAttribute(node, 'id');
      return id ? [[id, node]] : [];
    }),
  );
  const afterByPath = new Map(afterNodes.map((node) => [nodePath(node), node]));
  const matchedAfter = new Set();
  const changes = [];

  const recordChange = (beforeNode, afterNode) => {
    const before = beforeNode ? normalizedText(beforeNode) : '';
    const after = afterNode ? normalizedText(afterNode) : '';
    if (before === after) return;
    if (beforeNode) setAttribute(beforeNode, HTML_COMPARISON_ATTRIBUTE, '');
    if (afterNode) setAttribute(afterNode, HTML_COMPARISON_ATTRIBUTE, '');
    changes.push({ before, after });
  };

  for (const beforeNode of beforeNodes) {
    const beforeId = getAttribute(beforeNode, 'id');
    let afterNode = beforeId ? afterById.get(beforeId) : null;
    if (!afterNode) {
      const pathCandidate = afterByPath.get(nodePath(beforeNode));
      const afterId = pathCandidate ? getAttribute(pathCandidate, 'id') : '';
      // A newly-added id should not turn one text replacement into a
      // misleading removal plus addition. Two different explicit ids still
      // represent different authored elements, even at the same position.
      if (pathCandidate && (!beforeId || !afterId || beforeId === afterId)) {
        afterNode = pathCandidate;
      }
    }
    if (afterNode && matchedAfter.has(afterNode)) afterNode = null;
    if (afterNode) matchedAfter.add(afterNode);
    recordChange(beforeNode, afterNode);
  }

  for (const afterNode of afterNodes) {
    if (!matchedAfter.has(afterNode)) recordChange(null, afterNode);
  }

  const decorate = (document) => insertIntoHead(
    serialize(document),
    headMarkup(baseUrl, `<style>${COMPARISON_STYLE}</style>`),
  );

  return {
    before: decorate(beforeDocument),
    after: decorate(afterDocument),
    changes,
  };
}

function safeUrl(value) {
  return !/^\s*(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value || '');
}

function safeStyle(value) {
  return !/(?:expression\s*\(|url\s*\(\s*['"]?\s*(?:javascript|data\s*:\s*text\/html)|-moz-binding|behavior\s*:)/i.test(value || '');
}

function sanitizeAttributes(node) {
  node.attrs = (node.attrs || []).filter(({ name, value }) => {
    const lowerName = name.toLowerCase();
    if (lowerName === HTML_VISUAL_EDITOR_ATTRIBUTE || lowerName.startsWith('data-cowork-editor-')) return false;
    if (lowerName === 'contenteditable' || lowerName === 'spellcheck' || lowerName === 'srcdoc') return false;
    if (lowerName.startsWith('on')) return false;
    if (['href', 'src', 'xlink:href', 'formaction'].includes(lowerName) && !safeUrl(value)) return false;
    if (lowerName === 'style' && !safeStyle(value)) return false;
    return true;
  });
}

function sanitizeChildren(parent) {
  const nextChildren = [];
  for (const child of parent.childNodes || []) {
    if (!isElement(child)) {
      if (child.nodeName === '#text' || child.nodeName === '#comment') nextChildren.push(child);
      continue;
    }
    if (DROP_FRAGMENT_TAGS.has(child.tagName)) continue;
    sanitizeChildren(child);
    if (INLINE_TAGS.has(child.tagName)) {
      sanitizeAttributes(child);
      nextChildren.push(child);
    } else {
      nextChildren.push(...(child.childNodes || []));
    }
  }
  parent.childNodes = nextChildren;
  nextChildren.forEach((child) => { child.parentNode = parent; });
}

export function sanitizeHtmlVisualEdit(html) {
  const fragment = parseFragment(String(html || ''));
  sanitizeChildren(fragment);
  return serialize(fragment);
}

export function applyHtmlVisualEditAtRanges(content, elements, elementId, html) {
  const range = elements?.find((element) => element.id === elementId);
  const start = range?.start;
  const end = range?.end;
  if (
    !range
    || !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || start > end
    || end > content.length
  ) {
    throw new Error('The selected text block is no longer available.');
  }

  const nextHtml = sanitizeHtmlVisualEdit(html);
  const delta = nextHtml.length - (end - start);
  return {
    content: `${content.slice(0, start)}${nextHtml}${content.slice(end)}`,
    elements: elements.map((element) => {
      if (element.id === elementId) return { ...element, end: start + nextHtml.length };
      if (element.start >= end) {
        return { ...element, start: element.start + delta, end: element.end + delta };
      }
      return element;
    }),
  };
}

export function applyHtmlVisualEdit(content, elementId, html) {
  const document = parse(String(content || ''), { sourceCodeLocationInfo: true });
  const candidates = collectEditableNodes(document);
  const elements = candidates.map((node, index) => ({
    id: editorId(index),
    start: node.sourceCodeLocation.startTag.endOffset,
    end: node.sourceCodeLocation.endTag.startOffset,
  }));
  return applyHtmlVisualEditAtRanges(content, elements, elementId, html).content;
}
