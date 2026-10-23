/* Builds zip archives byte by byte for the document preview tests, so a test
   can make one that is huge once inflated but small on disk, or one whose
   directory or headers lie, without a fixture file. Deflate and CRC-32 come
   from Node's zlib. */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipSizes {
  compressed: number;
  uncompressed: number;
}

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
  /* Stored as is instead of deflated. */
  store?: boolean;
  /* The DOS and Unix attributes the directory record states. */
  externalAttributes?: number;
  /* Sizes the directory record states instead of the true ones. The local
     header states the same unless `localSizes` or `dataDescriptor` says
     otherwise. */
  centralSizes?: Partial<ZipSizes>;
  /* What the local header states instead of the directory record's name,
     method or sizes. */
  localName?: string;
  localMethod?: number;
  localSizes?: Partial<ZipSizes>;
  /* Sets the data descriptor flag, states 0 for both local sizes, and writes
     a signed data descriptor with the true sizes after the data. */
  dataDescriptor?: boolean;
  /* Adds a ZIP64 extra field holding the true sizes to that header. */
  zip64Extra?: 'central' | 'local';
  /* Bytes the directory record carries as its comment, such as a whole
     record a reader that starts elsewhere finds. */
  centralComment?: Uint8Array;
}

export interface ZipOptions {
  /* Bytes put before the archive, whose offsets don't count them. */
  prefix?: Uint8Array;
  /* Bytes put before the archive, whose offsets count them. */
  lead?: Uint8Array;
  /* The entry count the end record states, when it should lie. */
  statedEntries?: number;
  /* The directory size the end record states, when it should lie. */
  statedDirectorySize?: number;
  /* The disk numbers the end record states instead of 0: the disk it is on,
     and the disk the directory starts on. */
  statedDiskNumber?: number;
  statedDirectoryDisk?: number;
  /* Puts the first `endRecordCopy` bytes of a copy of the end record after
     it. */
  endRecordCopy?: number;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const DATA_DESCRIPTOR = 0x08074b50;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP64_EXTRA_FIELD = 0x0001;
const DOS_DATE_1980 = 0x21;

function header(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

function zip64Field({ compressed, uncompressed }: ZipSizes): Uint8Array {
  return header(20, (view) => {
    view.setUint16(0, ZIP64_EXTRA_FIELD, true);
    view.setUint16(2, 16, true);
    view.setBigUint64(4, BigInt(uncompressed), true);
    view.setBigUint64(12, BigInt(compressed), true);
  });
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function zipBytes(
  entries: readonly ZipEntryInput[],
  {
    prefix = new Uint8Array(0), lead = new Uint8Array(0), statedEntries, statedDirectorySize, statedDiskNumber = 0,
    statedDirectoryDisk = 0, endRecordCopy,
  }: ZipOptions = {},
): ArrayBuffer {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = lead.length;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const localName = new TextEncoder().encode(entry.localName ?? entry.name);
    const body = entry.store ? entry.data : new Uint8Array(deflateRawSync(entry.data));
    const method = entry.store ? 0 : 8;
    const flags = entry.dataDescriptor ? DATA_DESCRIPTOR_FLAG : 0;
    const crc = crc32(entry.data);
    const trueSizes: ZipSizes = { compressed: body.length, uncompressed: entry.data.length };
    const centralSizes: ZipSizes = { ...trueSizes, ...entry.centralSizes };
    const localSizes: ZipSizes = entry.dataDescriptor
      ? { compressed: 0, uncompressed: 0, ...entry.localSizes }
      : { ...centralSizes, ...entry.localSizes };
    const centralExtra = entry.zip64Extra === 'central' ? zip64Field(trueSizes) : new Uint8Array(0);
    const localExtra = entry.zip64Extra === 'local' ? zip64Field(trueSizes) : new Uint8Array(0);
    const centralComment = entry.centralComment ?? new Uint8Array(0);
    const local = header(30, (view) => {
      view.setUint32(0, LOCAL_HEADER, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, flags, true);
      view.setUint16(8, entry.localMethod ?? method, true);
      view.setUint16(12, DOS_DATE_1980, true);
      view.setUint32(14, entry.dataDescriptor ? 0 : crc, true);
      view.setUint32(18, localSizes.compressed, true);
      view.setUint32(22, localSizes.uncompressed, true);
      view.setUint16(26, localName.length, true);
      view.setUint16(28, localExtra.length, true);
    });
    const descriptor = entry.dataDescriptor
      ? header(16, (view) => {
        view.setUint32(0, DATA_DESCRIPTOR, true);
        view.setUint32(4, crc, true);
        view.setUint32(8, trueSizes.compressed, true);
        view.setUint32(12, trueSizes.uncompressed, true);
      })
      : new Uint8Array(0);
    directory.push(header(46, (view) => {
      view.setUint32(0, CENTRAL_HEADER, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, flags, true);
      view.setUint16(10, method, true);
      view.setUint16(14, DOS_DATE_1980, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, centralSizes.compressed, true);
      view.setUint32(24, centralSizes.uncompressed, true);
      view.setUint16(28, name.length, true);
      view.setUint16(30, centralExtra.length, true);
      view.setUint16(32, centralComment.length, true);
      view.setUint32(38, entry.externalAttributes ?? 0, true);
      view.setUint32(42, offset, true);
    }), name, centralExtra, centralComment);
    const record = [local, localName, localExtra, body, descriptor];
    parts.push(...record);
    offset += record.reduce((sum, part) => sum + part.length, 0);
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const count = statedEntries ?? entries.length;
  const end = header(22, (view) => {
    view.setUint32(0, END_RECORD, true);
    view.setUint16(4, statedDiskNumber, true);
    view.setUint16(6, statedDirectoryDisk, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, statedDirectorySize ?? directorySize, true);
    view.setUint32(16, offset, true);
  });
  const endCopy = end.subarray(0, endRecordCopy ?? 0);
  return concat([prefix, lead, ...parts, ...directory, end, endCopy]).buffer as ArrayBuffer;
}
