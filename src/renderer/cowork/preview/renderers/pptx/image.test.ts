/*
 * Picture headers: the type each signature names and the size each header
 * declares, which the slide preview checks against its pixel budget before
 * the browser decodes a picture. Cases live in image.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { imageSize, imageType, type ImageType } from './image';

interface HeaderCase {
  name: string;
  hex: string;
  type: ImageType | null;
  size: [number, number] | null;
}

interface HeaderCases {
  cases: HeaderCase[];
}

const DATA = load(readFileSync(join(__dirname, 'image.test.yaml'), 'utf8')) as HeaderCases;

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.replace(/\s+/g, ''), 'hex'));
}

describe('picture headers', () => {
  it.each(DATA.cases)('$name', ({ hex, type, size }) => {
    const header = bytes(hex);
    expect(imageType(header)).toBe(type);
    if (type === null) return;
    const read = imageSize(header, type);
    expect(read && [read.width, read.height]).toEqual(size);
  });
});
