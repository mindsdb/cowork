/*
 * The PDF asset provider the parent answers the frame's asset requests from.
 * Its names are exactly the CMaps and standard fonts pdfjs-dist ships, and
 * each loads as that file's bytes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import loadAssets, { dataUrlBytes } from './assets';

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

  it.each([
    ['cmaps', 'UniGB-UCS2-H.bcmap'],
    ['cmaps', 'UniJIS-UCS2-H.bcmap'],
    ['standard_fonts', 'LiberationSans-Regular.ttf'],
  ])('loads %s/%s as the file bytes', async (folder, name) => {
    const provider = await loadAssets();
    const bytes = await provider.load(name);
    expect(bytes && new Uint8Array(bytes)).toEqual(new Uint8Array(readFileSync(join(PDFJS, folder, name))));
  });

  it('loads nothing for a name it does not hold', async () => {
    const provider = await loadAssets();
    await expect(provider.load('LICENSE_FOXIT')).resolves.toBeNull();
    await expect(provider.load('../../api/v1/x.bcmap')).resolves.toBeNull();
  });
});

describe('dataUrlBytes', () => {
  it('decodes a base64 data: URL', () => {
    expect(new Uint8Array(dataUrlBytes('data:application/octet-stream;base64,AQID'))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each(['/node_modules/pdfjs-dist/cmaps/UniGB-UCS2-H.bcmap', 'data:text/plain,abc'])('refuses %s', (url) => {
    expect(() => dataUrlBytes(url)).toThrow();
  });
});
