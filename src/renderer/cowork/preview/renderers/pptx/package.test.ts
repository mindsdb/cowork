/*
 * The package reader: which part a relationship names, and what reads reach the
 * archive. Cases and the small package live in package.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import type { GuardedZip } from '../../contract';
import { partReader, presentationPartName, relationshipPart, resolvePartName, type Relationship, type Relationships } from './package';

interface ExpectedRelationship extends Relationship {
  part: string | null;
}

interface PackageCases {
  partNames: Array<[string, string, string | null]>;
  archive: Record<string, string>;
  slideSpellings: string[];
  slideRelationships: ExpectedRelationship[];
}

const DATA = load(readFileSync(join(__dirname, 'package.test.yaml'), 'utf8')) as PackageCases;
const SLIDE = 'ppt/slides/slide1.xml';

/* The YAML archive as a GuardedZip that records each entry read. */
function archive(): { zip: GuardedZip; reads: string[] } {
  const entries = new Map(Object.entries(DATA.archive));
  const reads: string[] = [];
  const read = (name: string): string | null => {
    reads.push(name);
    return entries.get(name) ?? null;
  };
  return {
    reads,
    zip: {
      names: () => [...entries.keys()],
      bytes: async (name) => {
        const text = read(name);
        return text === null ? null : new TextEncoder().encode(text);
      },
      text: async (name) => read(name),
    },
  };
}

describe('resolvePartName', () => {
  it.each(DATA.partNames)('from %s, %s names %s', (source, target, part) => {
    expect(resolvePartName(source, target)).toBe(part);
  });
});

describe('partReader', () => {
  it('finds the main part through the root relationships, ignoring case', async () => {
    const parts = partReader(archive().zip);
    const name = await presentationPartName(parts);
    expect(name).toBe('PPT/Presentation.xml');
    expect((await parts.xml(name))?.documentElement.localName).toBe('presentation');
  });

  it('reads relationships, marks External ones and keeps the first of a repeated Id', async () => {
    const rels = await partReader(archive().zip).relationships(SLIDE);
    const read = [...rels.values()].map((rel) => ({ ...rel, part: relationshipPart(SLIDE, rel) }));
    expect(read).toEqual(DATA.slideRelationships);
  });

  it('reads only entries the archive holds, under their own names', async () => {
    const { zip, reads } = archive();
    const parts = partReader(zip);
    expect((await parts.xml('PPT/SLIDES/SLIDE1.XML'))?.documentElement.localName).toBe('sld');
    expect(await parts.bytes('ppt/media/missing.png')).toBeNull();
    expect(await parts.xml('ppt/slides/slide2.xml')).toBeNull();
    expect(reads).toEqual(['ppt/slides/Slide1.xml']);
  });

  it('parses each part once', async () => {
    const { zip, reads } = archive();
    const parts = partReader(zip);
    await parts.xml(SLIDE);
    await parts.xml(SLIDE);
    await parts.relationships(SLIDE);
    await parts.relationships(SLIDE);
    expect(reads).toEqual(['ppt/slides/Slide1.xml', 'ppt/slides/_rels/slide1.xml.rels']);
  });

  it('reads and parses a part named in several spellings once', async () => {
    const { zip, reads } = archive();
    const parts = partReader(zip);
    const docs = new Set<Document | null>();
    const relationshipLists = new Set<Relationships>();
    for (const name of DATA.slideSpellings) {
      expect(parts.entryName(name)).toBe('ppt/slides/Slide1.xml');
      docs.add(await parts.xml(name));
      relationshipLists.add(await parts.relationships(name));
    }
    expect(parts.entryName('ppt/slides/slide2.xml')).toBeNull();
    expect(docs.size).toBe(1);
    expect(relationshipLists.size).toBe(1);
    expect(reads).toEqual(['ppt/slides/Slide1.xml', 'ppt/slides/_rels/slide1.xml.rels']);
  });

  it('gives null for a part that is not well-formed XML', async () => {
    expect(await partReader(archive().zip).xml('ppt/broken.xml')).toBeNull();
  });

  it('gives null for a part that declares a DOCTYPE, without parsing it', async () => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const doc = await partReader(archive().zip).xml('ppt/doctype.xml');
    const parses = parse.mock.calls.length;
    parse.mockRestore();
    expect(doc).toBeNull();
    expect(parses).toBe(0);
  });
});
