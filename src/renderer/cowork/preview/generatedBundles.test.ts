/*
 * Checks each generated preview bundle, the script the frame runs, against
 * bundleChecks.yaml. Vitest's global setup runs the bundle generator first,
 * so generated/ holds every type a renderer folder builds. The renderer
 * tests build stand-ins of render.ts alone; only this test sees a renderer's
 * libraries, the frame runtime and JSZip as they ship.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

interface BundleCheck {
  name: string;
  pattern: string;
  flags?: string;
  /* The types this check leaves out. */
  except?: string[];
  matches?: string[];
  skips?: string[];
}

type BundleChecks = { shared: BundleCheck[] } & Record<string, BundleCheck[]>;

const GENERATED_DIR = join(__dirname, 'generated');
const CHECKS = load(readFileSync(join(__dirname, 'bundleChecks.yaml'), 'utf8')) as BundleChecks;
const SHIPPED_TYPES = Object.keys(JSON.parse(readFileSync(join(GENERATED_DIR, 'preview-hashes.gen.json'), 'utf8'))).sort();
const ALL_CHECKS = Object.values(CHECKS).flat();

/* The checks a type's bundle must pass: the shared ones it isn't left out of,
   then its own. */
function checksFor(type: string): BundleCheck[] {
  return [...CHECKS.shared.filter(({ except }) => !except?.includes(type)), ...(CHECKS[type] ?? [])];
}

describe('bundleChecks.yaml', () => {
  it('covers the four document types the generator ships', () => {
    expect(SHIPPED_TYPES).toEqual(['docx', 'pdf', 'pptx', 'xlsx']);
  });

  it('names only shipped types, in its sections and its exceptions', () => {
    const named = [...Object.keys(CHECKS).filter((key) => key !== 'shared'), ...ALL_CHECKS.flatMap(({ except }) => except ?? [])];
    expect(named.filter((type) => !SHIPPED_TYPES.includes(type))).toEqual([]);
  });

  it.each(ALL_CHECKS.filter(({ matches, skips }) => matches || skips))('$name matches its examples and skips its non-examples', ({ pattern, flags, matches, skips }) => {
    const check = new RegExp(pattern, flags);
    expect((matches ?? []).filter((text) => !check.test(text))).toEqual([]);
    expect((skips ?? []).filter((text) => check.test(text))).toEqual([]);
  });
});

describe.each(SHIPPED_TYPES)('the generated %s bundle', (type) => {
  const script = readFileSync(join(GENERATED_DIR, `${type}.iife.txt`), 'utf8');

  it.each(checksFor(type))('holds no $name', ({ pattern, flags }) => {
    expect(script).not.toMatch(new RegExp(pattern, flags));
  });
});
