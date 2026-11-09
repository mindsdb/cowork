/*
 * DOM helpers for reading the XML parts of a .pptx file. Elements match on
 * their local name only, so the transitional and strict OOXML namespaces read
 * alike.
 */

const RELATIONSHIP_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]);

/* The parsed part, or null when the text isn't well-formed XML. A package part
   never declares a DOCTYPE, so text that does is refused unparsed, and no
   entity it defines is ever expanded. */
export function parseXml(text: string): Document | null {
  if (/<!DOCTYPE/i.test(text)) return null;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
}

export function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (const node of Array.from(el.children)) {
    if (node.localName === name) return node;
  }
  return null;
}

export function children(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.children).filter((node) => node.localName === name);
}

/* Follows a chain of child names, such as descend(sp, 'spPr', 'xfrm'). */
export function descend(el: Element | null | undefined, ...names: string[]): Element | null {
  let node: Element | null = el ?? null;
  for (const name of names) node = child(node, name);
  return node;
}

/* An integer attribute, or null when it's missing or not a plain integer. */
export function intAttr(el: Element | null | undefined, name: string): number | null {
  const value = el?.getAttribute(name);
  if (value == null || !/^-?\d{1,15}$/.test(value)) return null;
  return Number(value);
}

/* An OOXML boolean attribute: "1" and "true" are true. */
export function boolAttr(el: Element | null | undefined, name: string): boolean | null {
  const value = el?.getAttribute(name);
  if (value == null) return null;
  return value === '1' || value === 'true';
}

/*
 * A relationship attribute such as r:embed, under whatever prefix the part
 * binds to the relationships namespace. It reads the qualified attribute name
 * and the xmlns declarations directly, which works in every DOM.
 */
export function relationshipAttr(el: Element, local: string): string | null {
  for (const attr of Array.from(el.attributes)) {
    const colon = attr.name.indexOf(':');
    if (colon <= 0 || attr.name.slice(colon + 1) !== local) continue;
    const namespace = namespaceForPrefix(el, attr.name.slice(0, colon));
    if (namespace && RELATIONSHIP_NAMESPACES.has(namespace)) return attr.value;
  }
  return null;
}

function namespaceForPrefix(el: Element, prefix: string): string | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const value = node.getAttribute(`xmlns:${prefix}`);
    if (value !== null) return value;
  }
  return null;
}
