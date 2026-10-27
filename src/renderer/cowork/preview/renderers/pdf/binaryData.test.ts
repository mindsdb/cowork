/*
 * The data factory pdf.js reads CMaps and standard fonts through. It asks
 * ctx.requestAsset for the exact file name pdf.js names, and refuses wasm and
 * any name that isn't a plain CMap or font file name. The requests come from
 * binaryData.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import { bundledBinaryData, type BinaryDataRequest } from './binaryData';

interface BinaryDataCases { served: BinaryDataRequest[]; refused: BinaryDataRequest[] }

const CASES = load(readFileSync(join(__dirname, 'binaryData.test.yaml'), 'utf8')) as BinaryDataCases;

function factory(bytes: Uint8Array | null = new Uint8Array([1, 2, 3])) {
  const requestAsset = vi.fn(async (_name: string) => bytes);
  const BundledBinaryData = bundledBinaryData(requestAsset);
  return { data: new BundledBinaryData(), requestAsset };
}

describe('bundledBinaryData', () => {
  it.each(CASES.served)('asks for a $kind by its exact name, $filename', async (request) => {
    const { data, requestAsset } = factory();
    await expect(data.fetch(request)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(requestAsset.mock.calls).toEqual([[request.filename]]);
  });

  it.each(CASES.refused)('refuses a $kind named $filename without asking for it', async (request) => {
    const { data, requestAsset } = factory();
    await expect(data.fetch(request)).rejects.toThrow();
    expect(requestAsset).not.toHaveBeenCalled();
  });

  it('fails a name the preview has no file for, so pdf.js skips it', async () => {
    const { data } = factory(null);
    await expect(data.fetch({ kind: 'cMapUrl', filename: 'Missing-H.bcmap' })).rejects.toThrow('Missing-H.bcmap');
  });
});
