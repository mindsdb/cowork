/*
 * The archive guard the runtime runs before render(), as contract.ts says:
 * on every file that starts with PK\x03\x04, and on every other file JSZip
 * opens as an archive.
 *
 * It refuses with parse-failed an archive that two zip readers could read
 * differently: a central directory that doesn't end where the end record
 * starts (bytes prepended or moved, which JSZip skips and a reader that trusts
 * the stated offsets doesn't), an end record that counts a different number of
 * entries than the directory holds, and a name listed twice. A renderer
 * library with its own zip reader then reads the same entries JSZip reads, so
 * every entry it can inflate is one this guard counted.
 *
 * It never trusts the sizes an archive declares. It inflates every entry
 * through JSZip's streaming reader, counts the bytes that come out, and stops
 * with zip-limit as soon as a count passes a cap. An end record whose 16-bit
 * entry count is past maxZipEntries, which includes the ZIP64 marker 0xFFFF,
 * ends in zip-limit before JSZip reads the directory.
 */
import JSZip from 'jszip';

import type { GuardedZip, PreviewLimits } from '../contract';
import { previewError } from './errors';

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

export function startsWithZipHeader(bytes: ArrayBuffer): boolean {
  return bytes.byteLength >= 4 && new DataView(bytes).getUint32(0, true) === LOCAL_FILE_HEADER;
}

/* The offset of the last end-of-central-directory record, which is the one
   JSZip and SheetJS both read, or -1 when there is none. */
function endRecordOffset(bytes: Uint8Array): number {
  for (let offset = bytes.length - END_RECORD_SIZE; offset >= 0; offset -= 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) {
      return offset;
    }
  }
  return -1;
}

/* Walks the central directory headers from `offset` to `end`, the way JSZip
   reads them, and returns how many it found, or -1 when a header is missing or
   runs past `end`. It stops once the count passes `stopAfter`. */
function countDirectoryEntries(view: DataView, offset: number, end: number, stopAfter: number): number {
  let count = 0;
  let next = offset;
  while (next < end && count <= stopAfter) {
    if (next + CENTRAL_HEADER_SIZE > end || view.getUint32(next, true) !== CENTRAL_FILE_HEADER) return -1;
    count += 1;
    next += CENTRAL_HEADER_SIZE
      + view.getUint16(next + 28, true)
      + view.getUint16(next + 30, true)
      + view.getUint16(next + 32, true);
  }
  return next === end || count > stopAfter ? count : -1;
}

/*
 * Reads the archive's end record and central directory and returns how many
 * entries it lists. It throws zip-limit past maxZipEntries, and parse-failed
 * when the directory doesn't run from its stated offset to the end record or
 * holds a different number of entries than the end record counts.
 */
function checkedEntryCount(bytes: ArrayBuffer, limits: ArchiveLimits): number {
  const view = new DataView(bytes);
  const end = endRecordOffset(new Uint8Array(bytes));
  if (end < 0) throw previewError('parse-failed', 'The archive has no end record.');
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (Math.max(entriesOnDisk, entries) > limits.maxZipEntries) {
    throw previewError('zip-limit', `The archive lists more than ${limits.maxZipEntries} entries.`);
  }
  if (directoryOffset + directorySize !== end) {
    throw previewError('parse-failed', "The archive's directory isn't where its end record says.");
  }
  const found = countDirectoryEntries(view, directoryOffset, end, limits.maxZipEntries);
  if (found > limits.maxZipEntries) {
    throw previewError('zip-limit', `The archive lists more than ${limits.maxZipEntries} entries.`);
  }
  if (found !== entries || found !== entriesOnDisk) {
    throw previewError('parse-failed', "The archive's end record miscounts its entries.");
  }
  return found;
}

/* JSZip documents ZipObject#internalStream, but its typings leave it out. */
interface StreamingZipObject extends JSZip.JSZipObject {
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
}

function entryStream(entry: JSZip.JSZipObject): JSZip.JSZipStreamHelper<Uint8Array> {
  return (entry as StreamingZipObject).internalStream('uint8array');
}

/* Inflates one entry and returns how many bytes came out. It rejects with
   zip-limit, carrying `limitMessage`, once the count passes `cap`, without
   inflating the rest. */
function inflatedSize(entry: JSZip.JSZipObject, cap: number, limitMessage: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const stream = entryStream(entry);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };
    stream
      .on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > cap) fail(previewError('zip-limit', limitMessage));
        else if (signal.aborted) fail(previewError('internal', 'The preview was stopped.'));
      })
      .on('error', () => fail(previewError('parse-failed', 'An archive entry does not inflate.')))
      .on('end', () => {
        if (settled) return;
        settled = true;
        resolve(size);
      })
      .resume();
  });
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
  const zipHeader = startsWithZipHeader(bytes);
  /* A file that starts like an archive has its directory checked before JSZip
     reads it, so a huge entry count fails before JSZip builds every entry. */
  let entryCount = zipHeader ? checkedEntryCount(bytes, limits) : null;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    if (zipHeader) {
      throw previewError('parse-failed', 'The file starts like an archive but does not open as one.');
    }
    return null;
  }
  entryCount ??= checkedEntryCount(bytes, limits);
  const entries = Object.values(zip.files);
  if (entries.length !== entryCount) {
    throw previewError('parse-failed', 'The archive lists an entry name twice.');
  }
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    if (!entry.dir) {
      const remaining = limits.maxInflatedBytes - total;
      total += limits.maxZipEntryInflatedBytes <= remaining
        ? await inflatedSize(entry, limits.maxZipEntryInflatedBytes, `An entry inflates past ${limits.maxZipEntryInflatedBytes} bytes.`, signal)
        : await inflatedSize(entry, remaining, `The archive inflates past ${limits.maxInflatedBytes} bytes.`, signal);
    }
    onEntry?.(index + 1, entries.length);
  }
  return guardedZip(zip);
}
