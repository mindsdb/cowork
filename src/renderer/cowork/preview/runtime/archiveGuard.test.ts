import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { documentPreviewData, type ArchiveCaseData } from '../../../../../tests/helpers/documentPreviewData';
import { zipBytes } from '../../../../../tests/helpers/zipBytes';
import { previewLimits } from '../limits';
import { guardArchive, type ArchiveLimits } from './archiveGuard';

const MIB = 1024 * 1024;
/* The cap cases inflate 64 MiB and 256 MiB. Under coverage, as CI runs them,
   the larger takes about 4 s alone, so both get more than Vitest's 5 s default. */
const INFLATE_CASE_TIMEOUT_MS = 30_000;
const LIMITS = previewLimits({ touch: false });
const ARCHIVES = documentPreviewData().archiveGuard;
const text = (value: string) => new TextEncoder().encode(value);
const zeros = (size: number) => new Uint8Array(size);

function archiveFrom({ entries, archive = {} }: ArchiveCaseData): ArrayBuffer {
  return zipBytes(
    entries.map(({ size, ...entry }) => ({ ...entry, data: zeros(size) })),
    { ...archive, lead: archive.lead === undefined ? undefined : text(archive.lead) },
  );
}

function guard(bytes: ArrayBuffer, limits: ArchiveLimits = LIMITS, signal = new AbortController().signal) {
  return guardArchive(bytes, { limits, signal });
}

async function failure(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message: string };
  }
  throw new Error('expected the guard to fail');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('guardArchive', () => {
  it('returns null for a file that is not an archive', async () => {
    expect(await guard(text('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF').buffer as ArrayBuffer)).toBeNull();
  });

  it('returns the checked archive, which reads its entries', async () => {
    const zip = await guard(zipBytes([
      { name: 'xl/workbook.xml', data: text('<workbook/>') },
      { name: 'docProps/app.xml', data: text('<app/>'), store: true },
    ]));
    expect(zip?.names()).toEqual(['xl/workbook.xml', 'docProps/app.xml']);
    expect(await zip?.text('xl/workbook.xml')).toBe('<workbook/>');
    expect(await zip?.bytes('docProps/app.xml')).toEqual(text('<app/>'));
    expect(await zip?.bytes('missing.xml')).toBeNull();
  });

  it('reports each entry it inflated, so the progress watchdog sees it move', async () => {
    const onEntry = vi.fn();
    await guardArchive(zipBytes([{ name: 'a', data: text('a') }, { name: 'b', data: text('b') }]), {
      limits: LIMITS, signal: new AbortController().signal, onEntry,
    });
    expect(onEntry.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it(`ends in zip-limit past ${LIMITS.maxZipEntries} entries, before JSZip reads the directory`, async () => {
    const load = vi.spyOn(JSZip, 'loadAsync');
    const entries = Array.from({ length: LIMITS.maxZipEntries + 1 }, (_, index) => ({ name: `f${index}`, data: zeros(0), store: true }));
    expect(await failure(guard(zipBytes(entries)))).toMatchObject({ code: 'zip-limit' });
    expect(load).not.toHaveBeenCalled();
  });

  it('ends in zip-limit when the end record states more entries than the cap', async () => {
    const bytes = zipBytes([{ name: 'a', data: text('a') }], { statedEntries: 0xffff });
    expect(await failure(guard(bytes))).toMatchObject({ code: 'zip-limit' });
  });

  it(`ends in zip-limit when one entry inflates past ${LIMITS.maxZipEntryInflatedBytes / MIB} MiB`, async () => {
    const bytes = zipBytes([{ name: 'big.xml', data: zeros(LIMITS.maxZipEntryInflatedBytes + 1) }]);
    expect(bytes.byteLength).toBeLessThan(MIB);
    expect(await failure(guard(bytes))).toMatchObject({ code: 'zip-limit', message: expect.stringContaining('An entry') });
  }, INFLATE_CASE_TIMEOUT_MS);

  it(`ends in zip-limit when the archive inflates past ${LIMITS.maxInflatedBytes / MIB} MiB in total`, async () => {
    const entry = zeros(60 * MIB);
    const bytes = zipBytes(Array.from({ length: 5 }, (_, index) => ({ name: `part${index}.xml`, data: entry })));
    expect(bytes.byteLength).toBeLessThan(2 * MIB);
    expect(await failure(guard(bytes))).toMatchObject({ code: 'zip-limit', message: expect.stringContaining('The archive') });
  }, INFLATE_CASE_TIMEOUT_MS);

  it('lets an archive exactly at each cap through', async () => {
    const limits = { maxInflatedBytes: 10, maxZipEntryInflatedBytes: 6, maxZipEntries: 2 };
    const zip = await guard(zipBytes([{ name: 'a', data: zeros(6) }, { name: 'b', data: zeros(4) }]), limits);
    expect(zip?.names()).toEqual(['a', 'b']);
  });

  it('ends in parse-failed for a file that starts like an archive and does not open', async () => {
    const bytes = new Uint8Array(zipBytes([{ name: 'a', data: text('a') }]));
    expect(await failure(guard(bytes.slice(0, 40).buffer))).toMatchObject({ code: 'parse-failed' });
  });

  it('ends in parse-failed for an archive with bytes prepended, which readers could read differently', async () => {
    const entries = [{ name: 'a', data: text('a') }];
    expect(await failure(guard(zipBytes(entries, { prefix: text('PK\u0007\u0008junk') })))).toMatchObject({ code: 'parse-failed' });
    expect(await failure(guard(zipBytes(entries, { prefix: text('%PDF-1.7\n') })))).toMatchObject({ code: 'parse-failed' });
  });

  it('ends in parse-failed when the end record miscounts the directory', async () => {
    const bytes = zipBytes([{ name: 'a', data: text('a') }, { name: 'b', data: text('b') }], { statedEntries: 1 });
    expect(await failure(guard(bytes))).toMatchObject({ code: 'parse-failed' });
  });

  it('ends in parse-failed for a name listed twice', async () => {
    const bytes = zipBytes([{ name: 'a.xml', data: text('small') }, { name: 'a.xml', data: zeros(1000) }]);
    expect(await failure(guard(bytes))).toMatchObject({ code: 'parse-failed' });
  });

  it('stops when the preview is closed', async () => {
    const controller = new AbortController();
    controller.abort();
    const bytes = zipBytes([{ name: 'a', data: zeros(1000) }]);
    expect(await failure(guard(bytes, LIMITS, controller.signal))).toMatchObject({ code: 'internal' });
  });
});

describe('guardArchive on archives zip readers read differently', () => {
  it.each(ARCHIVES.accepted)('lets through $case', async (archive) => {
    expect((await guard(archiveFrom(archive)))?.names()).toEqual(archive.names);
  });

  it.each(ARCHIVES.refused)('ends in parse-failed for $case', async (archive) => {
    expect(await failure(guard(archiveFrom(archive)))).toMatchObject({ code: 'parse-failed' });
  });
});

describe('guardArchive on archives real zip writers make', () => {
  const { written } = ARCHIVES;

  it.each(written.workbookCompression)('lets through a workbook SheetJS writes, compression %s', async (compression) => {
    const book = XLSX.utils.book_new();
    for (const { sheet, rows } of written.workbook) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
    const bytes: ArrayBuffer = XLSX.write(book, { type: 'array', bookType: 'xlsx', compression });
    const names = (await guard(bytes))?.names();
    expect(names).toContain('xl/workbook.xml');
    expect(names).toEqual(expect.arrayContaining(written.workbook.map((_, index) => `xl/worksheets/sheet${index + 1}.xml`)));
  });

  it.each(written.jszipOptions)('lets through a JSZip archive, $compression with streamFiles $streamFiles', async (options) => {
    const archive = new JSZip();
    for (const { name, text } of written.files) {
      if (text === undefined) archive.folder(name);
      else archive.file(name, text);
    }
    const bytes = await archive.generateAsync({ type: 'arraybuffer', ...options });
    const files = written.files.filter((file) => file.text !== undefined).map((file) => file.name);
    expect((await guard(bytes))?.names()).toEqual(files);
  });
});
