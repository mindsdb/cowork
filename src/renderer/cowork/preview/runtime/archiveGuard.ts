/*
 * The archive guard the runtime runs before render(). contract.ts has it run
 * on every file that starts with PK\x03\x04 and on every other file JSZip
 * opens as an archive. It runs on every file that starts with PK, because
 * SheetJS unzips any file that starts with PK and two bytes below 9, whether
 * JSZip opens it or not.
 *
 * The guard reads the end record, the central directory and each entry's local
 * header itself, so it checks what JSZip and SheetJS each read, not only the
 * entries JSZip shows. It refuses with parse-failed an archive that two zip
 * readers could read differently:
 * - an end record cut short at the end of the file, a central directory that
 *   doesn't end where the end record starts (bytes prepended or moved, which
 *   JSZip skips and a reader that trusts the stated offsets doesn't), or an end
 *   record that counts a different number of entries than the directory holds;
 * - a name listed twice;
 * - a local header that is missing, or that states another name, method or
 *   sizes than its directory record. Its sizes may both be 0 when its flags
 *   say a data descriptor follows the data;
 * - a ZIP64 extra field, which JSZip and SheetJS apply differently;
 * - an entry JSZip reads as a directory, and so drops, that holds data;
 * - an entry whose data runs into the central directory, whose deflate stream
 *   runs past its stated compressed size (SheetJS inflates until the stream
 *   ends, not until that size), or that inflates to another size than it
 *   states.
 *
 * It never trusts the sizes an archive declares. It inflates the data of every
 * directory record, directories and empty entries included, counts the bytes
 * that come out, and stops with zip-limit as soon as a count passes a cap. So a
 * renderer library that unzips the file itself, such as SheetJS, inflates only
 * bytes this guard counted.
 *
 * Nor does it trust the entry count an end record states. JSZip reads central
 * records for as long as their signature follows, and shifts its start when
 * the offsets skip bytes before the archive. So a file with an end record and
 * more than maxZipEntries central directory signatures anywhere in it ends in
 * zip-limit before JSZip reads the directory, whatever the file starts with.
 * In a file that starts with PK, an end record whose 16-bit entry count is
 * past maxZipEntries, which includes the ZIP64 marker 0xFFFF, also ends in
 * zip-limit before JSZip reads it. JSZip refuses any other file whose end
 * record states 0xFFFF without a ZIP64 record, so the guard returns null.
 */
import JSZip from 'jszip';

import type { GuardedZip, PreviewError, PreviewLimits } from '../contract';
import { isPreviewError, previewError } from '../errors';

export type ArchiveLimits = Pick<PreviewLimits, 'maxInflatedBytes' | 'maxZipEntryInflatedBytes' | 'maxZipEntries'>;

export interface ArchiveGuardOptions {
  limits: ArchiveLimits;
  signal: AbortSignal;
  /* Called after each entry, so the parent's progress watchdog sees a large
     archive still moving. */
  onEntry?: (done: number, total: number) => void;
}

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_RECORD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const STORED = 0;
const DEFLATED = 8;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP64_EXTRA_FIELD = 0x0001;
const DOS_DIRECTORY_ATTRIBUTE = 0x10;
const MADE_BY_UNIX = 3;
const UNIX_DIRECTORY_MODE = 0x4000;
const SLASH = 0x2f;
/* Deflated data goes to DecompressionStream in pieces this size, so one piece
   inflates to at most about 16 MiB before the guard counts it. */
const INFLATE_INPUT_CHUNK = 16 * 1024;

/* One central directory record, as the guard reads it. */
interface CentralRecord {
  versionMadeBy: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttributes: number;
  localOffset: number;
  name: Uint8Array;
  extra: Uint8Array;
}

/* A directory record whose local header agrees with it, and the data its
   local header leads to, which is where JSZip and SheetJS both read it. */
interface CheckedEntry {
  record: CentralRecord;
  data: Uint8Array<ArrayBuffer>;
}

function startsLikeArchive(bytes: ArrayBuffer): boolean {
  const start = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  return start[0] === 0x50 && start[1] === 0x4b;
}

/* The offset of the last end-of-central-directory signature, which is the one
   JSZip and SheetJS both read, or -1 when there is none. Both look for it up
   to four bytes from the end of the file. */
function endRecordOffset(bytes: Uint8Array): number {
  for (let offset = bytes.length - 4; offset >= 0; offset -= 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) {
      return offset;
    }
  }
  return -1;
}

/* How many central directory signatures the file holds anywhere, counting no
   further than one past `stopAfter`. Each record JSZip reads starts with this
   signature at its own offset, so the count bounds how many entries JSZip
   builds, wherever it starts reading. */
function centralSignatureCount(bytes: Uint8Array, stopAfter: number): number {
  let count = 0;
  for (let offset = 0; offset + 4 <= bytes.length && count <= stopAfter; offset += 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x01 && bytes[offset + 3] === 0x02) {
      count += 1;
    }
  }
  return count;
}

function tooManyEntries(limits: ArchiveLimits): PreviewError {
  return previewError('zip-limit', `The archive lists more than ${limits.maxZipEntries} entries.`);
}

/* Reads the central directory records from `offset` to `end`, the way JSZip
   reads them, or returns null when a header is missing or runs past `end`. It
   stops once the count passes `stopAfter`. */
function readDirectory(bytes: Uint8Array, offset: number, end: number, stopAfter: number): CentralRecord[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: CentralRecord[] = [];
  let next = offset;
  while (next < end && records.length <= stopAfter) {
    if (next + CENTRAL_HEADER_SIZE > end || view.getUint32(next, true) !== CENTRAL_FILE_HEADER) return null;
    const nameStart = next + CENTRAL_HEADER_SIZE;
    const extraStart = nameStart + view.getUint16(next + 28, true);
    const commentStart = extraStart + view.getUint16(next + 30, true);
    records.push({
      versionMadeBy: view.getUint16(next + 4, true),
      method: view.getUint16(next + 10, true),
      compressedSize: view.getUint32(next + 20, true),
      uncompressedSize: view.getUint32(next + 24, true),
      externalAttributes: view.getUint32(next + 38, true),
      localOffset: view.getUint32(next + 42, true),
      name: bytes.subarray(nameStart, extraStart),
      extra: bytes.subarray(extraStart, commentStart),
    });
    next = commentStart + view.getUint16(next + 32, true);
  }
  return next === end || records.length > stopAfter ? records : null;
}

/* Whether extra field bytes hold a ZIP64 field. It walks the fields the way
   SheetJS does, reading a field header wherever four bytes remain, so it sees
   every field JSZip sees too. */
function hasZip64Field(extra: Uint8Array): boolean {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let at = 0; at + 4 <= extra.length; at += 4 + view.getUint16(at + 2, true)) {
    if (view.getUint16(at, true) === ZIP64_EXTRA_FIELD) return true;
  }
  return false;
}

/* Whether JSZip reads the record as a directory, and so drops its data: the
   DOS directory attribute, a Unix directory mode, or a name ending in '/'. */
function readsAsDirectory(record: CentralRecord): boolean {
  const unixMode = record.versionMadeBy >> 8 === MADE_BY_UNIX ? record.externalAttributes >>> 16 : 0;
  return (record.externalAttributes & DOS_DIRECTORY_ATTRIBUTE) !== 0
    || (unixMode & UNIX_DIRECTORY_MODE) !== 0
    || record.name[record.name.length - 1] === SLASH;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/* Reads the local header a directory record points to and returns the entry's
   data. It throws parse-failed for each local header and directory rule in
   the header comment. */
function checkedEntry(bytes: Uint8Array<ArrayBuffer>, record: CentralRecord, directoryOffset: number): CheckedEntry {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = record.localOffset;
  if (at + LOCAL_HEADER_SIZE > directoryOffset || view.getUint32(at, true) !== LOCAL_FILE_HEADER) {
    throw previewError('parse-failed', 'An archive entry has no local header.');
  }
  const flags = view.getUint16(at + 6, true);
  const compressedSize = view.getUint32(at + 18, true);
  const uncompressedSize = view.getUint32(at + 22, true);
  const nameStart = at + LOCAL_HEADER_SIZE;
  const extraStart = nameStart + view.getUint16(at + 26, true);
  const dataStart = extraStart + view.getUint16(at + 28, true);
  const sameSizes = compressedSize === record.compressedSize && uncompressedSize === record.uncompressedSize;
  const sizesInDescriptor = (flags & DATA_DESCRIPTOR_FLAG) !== 0 && compressedSize === 0 && uncompressedSize === 0;
  if (view.getUint16(at + 8, true) !== record.method
    || !sameBytes(bytes.subarray(nameStart, extraStart), record.name)
    || !(sameSizes || sizesInDescriptor)) {
    throw previewError('parse-failed', "An archive entry's local header differs from its directory record.");
  }
  if (hasZip64Field(record.extra) || hasZip64Field(bytes.subarray(extraStart, dataStart))) {
    throw previewError('parse-failed', 'An archive entry carries a ZIP64 extra field.');
  }
  if (readsAsDirectory(record) && record.uncompressedSize !== 0) {
    throw previewError('parse-failed', 'An archive directory entry holds data.');
  }
  if (dataStart + record.compressedSize > directoryOffset) {
    throw previewError('parse-failed', "An archive entry's data runs into the central directory.");
  }
  return { record, data: bytes.subarray(dataStart, dataStart + record.compressedSize) };
}

/*
 * Reads the archive's end record, central directory and local headers, and
 * returns each entry. It throws zip-limit past maxZipEntries, and parse-failed
 * when the end record is cut short, when the directory doesn't run from its
 * stated offset to the end record or holds a different number of entries than
 * the end record counts, or when checkedEntry refuses an entry.
 */
function checkedEntries(buffer: ArrayBuffer, limits: ArchiveLimits): CheckedEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const end = endRecordOffset(bytes);
  if (end < 0) throw previewError('parse-failed', 'The archive has no end record.');
  if (end + END_RECORD_SIZE > bytes.length) throw previewError('parse-failed', "The archive's end record is cut short.");
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (Math.max(entriesOnDisk, entries) > limits.maxZipEntries) throw tooManyEntries(limits);
  if (directoryOffset + directorySize !== end) {
    throw previewError('parse-failed', "The archive's directory isn't where its end record says.");
  }
  const records = readDirectory(bytes, directoryOffset, end, limits.maxZipEntries);
  if (records && records.length > limits.maxZipEntries) throw tooManyEntries(limits);
  if (!records || records.length !== entries || records.length !== entriesOnDisk) {
    throw previewError('parse-failed', "The archive's end record miscounts its entries.");
  }
  return records.map((record) => checkedEntry(bytes, record, directoryOffset));
}

/* The data as a stream of small pieces, so DecompressionStream inflates one
   piece at a time, as fast as the guard reads what comes out. */
function inputPieces(data: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  let offset = 0;
  return new ReadableStream<BufferSource>({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      controller.enqueue(data.subarray(offset, offset + INFLATE_INPUT_CHUNK));
      offset += INFLATE_INPUT_CHUNK;
    },
  });
}

/*
 * Inflates one entry's data and returns how many bytes came out. It rejects
 * with zip-limit, carrying `limitMessage`, once the count passes `cap`,
 * without inflating the rest. It rejects with parse-failed when the deflate
 * stream is cut short, which is how a stream that runs past the entry's
 * stated compressed size shows.
 */
async function inflatedSize({ record, data }: CheckedEntry, cap: number, limitMessage: string, signal: AbortSignal): Promise<number> {
  if (record.method === STORED) {
    if (data.length > cap) throw previewError('zip-limit', limitMessage);
    return data.length;
  }
  if (record.method !== DEFLATED) throw previewError('parse-failed', 'An archive entry uses an unknown compression method.');
  const reader = inputPieces(data).pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  let size = 0;
  try {
    for (let piece = await reader.read(); !piece.done; piece = await reader.read()) {
      size += piece.value.length;
      if (size > cap) throw previewError('zip-limit', limitMessage);
      if (signal.aborted) throw previewError('internal', 'The preview was stopped.');
    }
  } catch (error) {
    reader.cancel().catch(() => undefined);
    throw isPreviewError(error) ? error : previewError('parse-failed', 'An archive entry does not inflate.');
  }
  return size;
}

function guardedZip(zip: JSZip): GuardedZip {
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const byName = new Map(files.map((entry) => [entry.name, entry]));
  const names = Object.freeze(files.map((entry) => entry.name));
  return {
    names: () => names,
    bytes: async (name) => (await byName.get(name)?.async('uint8array')) ?? null,
    text: async (name) => (await byName.get(name)?.async('string')) ?? null,
  };
}

/*
 * Returns the checked archive, or null when the file is not an archive. Every
 * entry has inflated within the caps by the time it returns, so a later read
 * through the GuardedZip inflates the same bounded bytes again.
 */
export async function guardArchive(bytes: ArrayBuffer, { limits, signal, onEntry }: ArchiveGuardOptions): Promise<GuardedZip | null> {
  /* Both checks run before JSZip reads the directory, so a huge entry count
     fails before JSZip builds every entry. The signature count runs on every
     file with an end record, because JSZip reads the directory of any such
     file, whatever it starts with. A file that starts like an archive also
     has its directory and local headers checked. */
  const view = new Uint8Array(bytes);
  if (endRecordOffset(view) >= 0 && centralSignatureCount(view, limits.maxZipEntries) > limits.maxZipEntries) {
    throw tooManyEntries(limits);
  }
  const archiveStart = startsLikeArchive(bytes);
  let entries = archiveStart ? checkedEntries(bytes, limits) : null;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    if (archiveStart) {
      throw previewError('parse-failed', 'The file starts like an archive but does not open as one.');
    }
    return null;
  }
  entries ??= checkedEntries(bytes, limits);
  if (Object.keys(zip.files).length !== entries.length) {
    throw previewError('parse-failed', 'The archive lists an entry name twice.');
  }
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    const remaining = limits.maxInflatedBytes - total;
    const size = limits.maxZipEntryInflatedBytes <= remaining
      ? await inflatedSize(entry, limits.maxZipEntryInflatedBytes, `An entry inflates past ${limits.maxZipEntryInflatedBytes} bytes.`, signal)
      : await inflatedSize(entry, remaining, `The archive inflates past ${limits.maxInflatedBytes} bytes.`, signal);
    if (size !== entry.record.uncompressedSize) {
      throw previewError('parse-failed', 'An archive entry inflates to another size than it states.');
    }
    total += size;
    onEntry?.(index + 1, entries.length);
  }
  return guardedZip(zip);
}
