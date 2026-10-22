import { readFileSync } from 'node:fs';

import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import {
  DATA_FILE, documentPreviewData, parseDocumentPreviewData, type ArchiveCaseData,
} from '../../../../../tests/helpers/documentPreviewData';
import { zipBytes, type ZipEntryInput } from '../../../../../tests/helpers/zipBytes';
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
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;

function archiveFrom({ entries, archive = {} }: ArchiveCaseData): ArrayBuffer {
  const { lead, prefix, ...options } = archive;
  return zipBytes(
    entries.map(({ size, ...entry }) => ({ ...entry, data: zeros(size) })),
    { ...options, lead: lead === undefined ? undefined : text(lead), prefix: prefix === undefined ? undefined : text(prefix) },
  );
}

/* An entry's local record and directory record, cut from an archive of that
   entry alone, with the directory record's local offset set to
   `localOffset`. A test hides them where only JSZip finds them. */
function hiddenEntry(entry: ZipEntryInput, localOffset: number): { local: Uint8Array; central: Uint8Array } {
  const bytes = new Uint8Array(zipBytes([entry]));
  const directoryOffset = new DataView(bytes.buffer).getUint32(bytes.length - END_RECORD_SIZE + 16, true);
  const central = bytes.slice(directoryOffset, bytes.length - END_RECORD_SIZE);
  new DataView(central.buffer).setUint32(42, localOffset, true);
  return { local: bytes.subarray(0, directoryOffset), central };
}

/* A ZIP64 end record for a directory of one record, and the ZIP64 locator
   that points at the end record from `at`. JSZip looks for the locator just
   before the 32-bit end record. */
function zip64EndAndLocator(directoryOffset: number, directorySize: number, at: number): Uint8Array {
  const bytes = new Uint8Array(56 + 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06064b50, true);
  view.setBigUint64(4, BigInt(44), true);
  view.setUint16(12, 45, true);
  view.setUint16(14, 45, true);
  view.setBigUint64(24, BigInt(1), true);
  view.setBigUint64(32, BigInt(1), true);
  view.setBigUint64(40, BigInt(directorySize), true);
  view.setBigUint64(48, BigInt(directoryOffset), true);
  view.setUint32(56, 0x07064b50, true);
  view.setBigUint64(64, BigInt(at), true);
  view.setUint32(72, 1, true);
  return bytes;
}

async function jszipNames(bytes: ArrayBuffer): Promise<string[]> {
  return Object.keys((await JSZip.loadAsync(bytes)).files);
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

  it.each(ARCHIVES.pastEntryCap)(`ends in zip-limit past ${LIMITS.maxZipEntries} entries for $case, before JSZip reads the directory`, async ({ case: name, archive }) => {
    const load = vi.spyOn(JSZip, 'loadAsync');
    const entries = Array.from({ length: LIMITS.maxZipEntries + 1 }, (_, index) => ({ name: `f${index}`, size: 0, store: true }));
    expect(await failure(guard(archiveFrom({ case: name, entries, archive })))).toMatchObject({ code: 'zip-limit' });
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

  it('ends in zip-limit when a stored entry passes a cap', async () => {
    const limits = { maxInflatedBytes: 10, maxZipEntryInflatedBytes: 6, maxZipEntries: 3 };
    const pastTotal = zipBytes([{ name: 'a', data: zeros(6) }, { name: 'b', data: zeros(5), store: true }]);
    expect(await failure(guard(pastTotal, limits))).toMatchObject({ code: 'zip-limit', message: expect.stringContaining('The archive') });
    const pastEntry = zipBytes([{ name: 'a', data: zeros(7), store: true }]);
    expect(await failure(guard(pastEntry, limits))).toMatchObject({ code: 'zip-limit', message: expect.stringContaining('An entry') });
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

  it('ends in parse-failed for an end record that understates the directory size, so JSZip reads a record hidden in a comment', async () => {
    /* JSZip starts the directory as many bytes late as the stated size falls
       short of the end record, here at the first record's comment, and reads
       every local offset that much later too. So the hidden record's offset 0
       leads JSZip to its local record, which the first entry's data holds at
       that many bytes from the start. */
    const name = 'a.xml';
    const hidden = hiddenEntry({ name: 'xl/hidden.xml', data: zeros(1024) }, 0);
    const data = new Uint8Array(CENTRAL_HEADER_SIZE - LOCAL_HEADER_SIZE + hidden.local.length);
    data.set(hidden.local, CENTRAL_HEADER_SIZE - LOCAL_HEADER_SIZE);
    const bytes = zipBytes([{ name, data, store: true, centralComment: hidden.central }], { statedDirectorySize: hidden.central.length });
    expect(await jszipNames(bytes)).toEqual(['xl/hidden.xml']);
    expect(await failure(guard(bytes))).toMatchObject({ code: 'parse-failed' });
  });

  it.each([
    { field: 'the disk it is on', disks: { statedDiskNumber: 0xffff } },
    { field: 'the disk its directory starts on', disks: { statedDirectoryDisk: 0xffff } },
  ])('ends in parse-failed for an end record that states 0xFFFF for $field, so JSZip reads a ZIP64 directory hidden in a comment', async ({ disks }) => {
    /* The hidden entry's local record leads the file. The guard's directory
       lists one entry, `a`, whose comment holds the hidden directory record,
       a ZIP64 end record that points at it, and the ZIP64 locator. */
    const name = 'a';
    const data = text('a');
    const hidden = hiddenEntry({ name: 'xl/hidden.xml', data: zeros(1024) }, 0);
    const hiddenOffset = hidden.local.length + LOCAL_HEADER_SIZE + name.length + data.length + CENTRAL_HEADER_SIZE + name.length;
    const zip64 = zip64EndAndLocator(hiddenOffset, hidden.central.length, hiddenOffset + hidden.central.length);
    const comment = new Uint8Array(hidden.central.length + zip64.length);
    comment.set(hidden.central);
    comment.set(zip64, hidden.central.length);
    const bytes = zipBytes([{ name, data, store: true, centralComment: comment }], { lead: hidden.local, ...disks });
    expect(await jszipNames(bytes)).toEqual(['xl/hidden.xml']);
    expect(await failure(guard(bytes))).toMatchObject({ code: 'parse-failed' });
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

/* The rows above spread their optional keys into zipBytes, so the loader
   refuses a key their model doesn't list rather than let a misspelt one drop
   out and its row check nothing. */
describe('documentPreviewData', () => {
  const data = readFileSync(DATA_FILE, 'utf8');

  it.each([
    { row: 'an archive entry', key: 'dataDescriptor', typo: 'dataDescripter' },
    { row: 'archive options', key: 'statedEntries', typo: 'statedEntrys' },
    { row: 'an archive case', key: 'archive: { lead: "PK', typo: 'archve' },
    { row: 'a harness directive', key: `body: '<p>`, typo: 'bdy' },
    { row: "an entry's sizes", key: 'uncompressed: 1024 }', typo: 'uncompresed' },
    { row: 'a written file', key: 'text: "<Types/>"', typo: 'txt' },
    { row: "a written archive's JSZip options", key: 'streamFiles: true }', typo: 'streamFile' },
  ])('refuses a misspelt key in $row and names it', ({ key, typo }) => {
    expect(data).toContain(key);
    const misspelt = data.replace(key, key.replace(/^\w+/, typo));
    expect(() => parseDocumentPreviewData(misspelt)).toThrow(`unknown keys ${typo}`);
  });
});
