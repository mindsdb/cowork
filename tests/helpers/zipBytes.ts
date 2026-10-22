/* Builds zip archives byte by byte for the document preview tests, so a test
   can make one that is huge once inflated but small on disk, or one whose
   directory lies, without a fixture file. Deflate and CRC-32 come from Node's
   zlib. */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
  /* Stored as is instead of deflated. */
  store?: boolean;
}

export interface ZipOptions {
  /* Bytes put before the archive, whose offsets don't count them. */
  prefix?: Uint8Array;
  /* The entry count the end record states, when it should lie. */
  statedEntries?: number;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const DOS_DATE_1980 = 0x21;

function header(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

export function zipBytes(entries: readonly ZipEntryInput[], { prefix = new Uint8Array(0), statedEntries }: ZipOptions = {}): ArrayBuffer {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const body = entry.store ? entry.data : new Uint8Array(deflateRawSync(entry.data));
    const method = entry.store ? 0 : 8;
    const crc = crc32(entry.data);
    const local = header(30, (view) => {
      view.setUint32(0, LOCAL_HEADER, true);
      view.setUint16(4, 20, true);
      view.setUint16(8, method, true);
      view.setUint16(12, DOS_DATE_1980, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, body.length, true);
      view.setUint32(22, entry.data.length, true);
      view.setUint16(26, name.length, true);
    });
    directory.push(header(46, (view) => {
      view.setUint32(0, CENTRAL_HEADER, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(10, method, true);
      view.setUint16(14, DOS_DATE_1980, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, body.length, true);
      view.setUint32(24, entry.data.length, true);
      view.setUint16(28, name.length, true);
      view.setUint32(42, offset, true);
    }), name);
    parts.push(local, name, body);
    offset += local.length + name.length + body.length;
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const count = statedEntries ?? entries.length;
  const end = header(22, (view) => {
    view.setUint32(0, END_RECORD, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, offset, true);
  });
  const all = [prefix, ...parts, ...directory, end];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}
