/*
 * The PDF asset provider the parent answers the frame's asset requests from.
 * Its names are exactly the CMaps and standard fonts pdfjs-dist ships, and
 * each loads as that file's bytes. The names and URLs come from
 * assets.test.yaml.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import loadAssets, { dataUrlBytes } from './assets';

/* A file pdfjs-dist ships: its folder under node_modules/pdfjs-dist and its name. */
interface ShippedFile { folder: string; name: string }
interface AssetCases { loaded: ShippedFile[]; notHeld: string[]; refusedUrls: string[] }

const CASES = load(readFileSync(join(__dirname, 'assets.test.yaml'), 'utf8')) as AssetCases;
const PDFJS = join(__dirname, '../../../../../../node_modules/pdfjs-dist');

function shippedFiles(folder: string, extension: RegExp): string[] {
  return readdirSync(join(PDFJS, folder)).filter((name) => extension.test(name));
}

describe('the pdf asset provider', () => {
  it('names every CMap and standard font pdfjs-dist ships, and nothing else', async () => {
    const provider = await loadAssets();
    const shipped = [...shippedFiles('cmaps', /\.bcmap$/), ...shippedFiles('standard_fonts', /\.(?:pfb|ttf)$/)];
    expect([...provider.names].sort()).toEqual(shipped.sort());
  });

  it.each(CASES.loaded)('loads $folder/$name as the file bytes', async ({ folder, name }) => {
    const provider = await loadAssets();
    const bytes = await provider.load(name);
    expect(bytes && new Uint8Array(bytes)).toEqual(new Uint8Array(readFileSync(join(PDFJS, folder, name))));
  });

  it.each(CASES.notHeld)('loads nothing for %s, a name it does not hold', async (name) => {
    const provider = await loadAssets();
    await expect(provider.load(name)).resolves.toBeNull();
  });
});

describe('dataUrlBytes', () => {
  it('decodes a base64 data: URL', () => {
    expect(new Uint8Array(dataUrlBytes('data:application/octet-stream;base64,AQID'))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each(CASES.refusedUrls)('refuses %s', (url) => {
    expect(() => dataUrlBytes(url)).toThrow();
  });
});
