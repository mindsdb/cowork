/*
 * Reads the parts of a .pptx package (Open Packaging Conventions) out of the
 * checked archive the runtime hands over. Every read goes to a part inside
 * the archive: a relationship marked External, or a target that names a URL
 * or climbs above the package root, resolves to no part and is never read.
 */
import type { GuardedZip } from '../../contract';
import { children, parseXml } from './xml';

export interface Relationship {
  id: string;
  /* The last segment of the relationship type URI, such as 'image' or 'slideLayout'. */
  kind: string;
  target: string;
  external: boolean;
}

export type Relationships = ReadonlyMap<string, Relationship>;

export interface PartReader {
  /* The archive's own spelling of a part name, or null when the archive has no
     such entry. Part names compare without regard to case, so this is the one
     key a cache of parts uses. */
  entryName(name: string): string | null;
  xml(name: string): Promise<Document | null>;
  bytes(name: string): Promise<Uint8Array | null>;
  relationships(sourcePart: string): Promise<Relationships>;
}

/* The part a relative target names from sourcePart, or null when the target
   is a URL or leaves the package. Part names carry no leading slash, as in the
   archive's entry names. */
export function resolvePartName(sourcePart: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.includes('\\')) return null;
  const segments = target.startsWith('/') ? [] : sourcePart.split('/').slice(0, -1);
  for (const raw of target.split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment.includes('/') || segment.includes('\\')) return null;
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}

/* The internal part a relationship points at, or null for an External one. */
export function relationshipPart(sourcePart: string, rel: Relationship | undefined): string | null {
  if (!rel || rel.external) return null;
  return resolvePartName(sourcePart, rel.target);
}

/* The first internal part of one relationship kind, such as a slide's layout. */
export function firstPartOfKind(sourcePart: string, rels: Relationships, kind: string): string | null {
  for (const rel of rels.values()) {
    if (rel.kind === kind && !rel.external) return relationshipPart(sourcePart, rel);
  }
  return null;
}

function relationshipsPartName(sourcePart: string): string {
  const slash = sourcePart.lastIndexOf('/');
  return `${sourcePart.slice(0, slash + 1)}_rels/${sourcePart.slice(slash + 1)}.rels`;
}

function readRelationships(doc: Document | null): Relationships {
  const rels = new Map<string, Relationship>();
  for (const el of children(doc?.documentElement, 'Relationship')) {
    const id = el.getAttribute('Id');
    const type = el.getAttribute('Type');
    const target = el.getAttribute('Target');
    if (!id || !type || target === null || rels.has(id)) continue;
    rels.set(id, {
      id,
      kind: type.slice(type.lastIndexOf('/') + 1),
      target,
      external: el.getAttribute('TargetMode') === 'External',
    });
  }
  return rels;
}

const NO_RELATIONSHIPS: Relationships = new Map();

/*
 * Part names in a package compare without regard to case, so each read looks
 * the name up among the archive's entries first and only ever reads an entry
 * the archive holds. Parsed parts and relationship lists are cached by the
 * entry's own name, since every slide reads its layout, master and theme: a
 * part named in several spellings is still read and parsed once. Bytes are
 * not cached: imageUrl in slide.ts caches the data: URL it builds from them.
 */
export function partReader(zip: GuardedZip): PartReader {
  const entries = new Map(zip.names().map((name) => [name.toLowerCase(), name]));
  const xmlCache = new Map<string, Promise<Document | null>>();
  const relsCache = new Map<string, Promise<Relationships>>();

  function entryName(name: string): string | null {
    return entries.get(name.toLowerCase()) ?? null;
  }

  function xml(name: string): Promise<Document | null> {
    const found = entryName(name);
    if (!found) return Promise.resolve(null);
    let doc = xmlCache.get(found);
    if (!doc) {
      doc = zip.text(found).then((text) => (text === null ? null : parseXml(text)));
      xmlCache.set(found, doc);
    }
    return doc;
  }

  return {
    entryName,
    xml,
    bytes(name) {
      const found = entryName(name);
      return found ? zip.bytes(found) : Promise.resolve(null);
    },
    /* The cached list holds each relationship's raw Target, which every caller
       resolves against its own sourcePart, so spellings can share it. */
    relationships(sourcePart) {
      const found = entryName(relationshipsPartName(sourcePart));
      if (!found) return Promise.resolve(NO_RELATIONSHIPS);
      let rels = relsCache.get(found);
      if (!rels) {
        rels = xml(found).then(readRelationships);
        relsCache.set(found, rels);
      }
      return rels;
    },
  };
}

/* The main part's name from the package's root relationships. */
export async function presentationPartName(parts: PartReader): Promise<string> {
  const rels = await parts.relationships('');
  return firstPartOfKind('', rels, 'officeDocument') ?? 'ppt/presentation.xml';
}

/* The part's root element when it has the expected local name, else null. */
export function documentRoot(doc: Document | null, localName: string): Element | null {
  const root = doc?.documentElement ?? null;
  return root && root.localName === localName ? root : null;
}
