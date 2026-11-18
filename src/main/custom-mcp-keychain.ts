/*
 * Keychain entries of custom MCP connections: settings, allowed tools,
 * refresh token and client secret, keyed by store root and connection ID.
 * Only the real OS keychain: agent code can write `keychain-fallback.json`,
 * so a keychain that does not work stops custom MCP instead of falling back.
 *
 * Each value's UTF-8 bytes are split into pieces stored as base64, each
 * under the Windows 2560-byte limit whatever the text, written under a fresh
 * generation tag, and named by a count entry written last. A missing piece
 * or a piece of another generation reads as unusable, never as a shorter value.
 */

import * as crypto from 'crypto';
import { buildKind } from './cowork-home';
import { storeScope } from './keychain-service';

const SERVICE_NAME = buildKind() === 'prod' ? 'cowork-custom-mcp' : `cowork-custom-mcp-${buildKind()}`;
// 1800 bytes are 2400 base64 characters, all ASCII, so 2400 bytes in any encoding.
const PIECE_BYTES = 1800;
const COUNT_PATTERN = /^([0-9a-f]{16}):([1-9][0-9]{0,3})$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export type CustomMcpPart = 'settings' | 'tools' | 'refresh' | 'secret';

export class CustomMcpKeychainError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'CustomMcpKeychainError';
  }
}

async function keytar() {
  return (await import('keytar')).default;
}

function connectionPrefix(storeRoot: string, id: string): string {
  return `${storeScope(storeRoot)}|${id}|`;
}

function partAccount(storeRoot: string, id: string, part: CustomMcpPart): string {
  return `${connectionPrefix(storeRoot, id)}${part}`;
}

function pieceAccount(base: string, generation: string, index: number): string {
  return `${base}#${generation}#${index}`;
}

async function call<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw new CustomMcpKeychainError(`the keychain could not ${what}`, err);
  }
}

/** Throws a `CustomMcpKeychainError` unless the OS keychain answers. */
export async function checkKeychain(): Promise<void> {
  await call('be read', async () => { await (await keytar()).findCredentials(SERVICE_NAME); });
}

/** Writes `value` as `part` of a connection, replacing any earlier value. */
export async function writePart(storeRoot: string, id: string, part: CustomMcpPart, value: string): Promise<void> {
  const base = partAccount(storeRoot, id, part);
  const kt = await keytar();
  const previous = await call('be read', () => kt.getPassword(SERVICE_NAME, base));
  const generation = crypto.randomBytes(8).toString('hex');
  const bytes = Buffer.from(value, 'utf8');
  const pieces = bytes.length === 0
    ? ['']
    : Array.from({ length: Math.ceil(bytes.length / PIECE_BYTES) }, (_, i) => bytes.subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES).toString('base64'));
  for (const [index, piece] of pieces.entries()) {
    await call('be written', () => kt.setPassword(SERVICE_NAME, pieceAccount(base, generation, index), piece));
  }
  await call('be written', () => kt.setPassword(SERVICE_NAME, base, `${generation}:${pieces.length}`));
  const old = previous?.match(COUNT_PATTERN);
  if (old && old[1] !== generation) {
    for (let index = 0; index < Number(old[2]); index += 1) {
      await call('delete an old entry', () => kt.deletePassword(SERVICE_NAME, pieceAccount(base, old[1], index)));
    }
  }
}

/** `part` of a connection; null when it is absent or its pieces are not all there. */
export async function readPart(storeRoot: string, id: string, part: CustomMcpPart): Promise<string | null> {
  const base = partAccount(storeRoot, id, part);
  const kt = await keytar();
  const count = (await call('be read', () => kt.getPassword(SERVICE_NAME, base)))?.match(COUNT_PATTERN);
  if (!count) return null;
  const pieces: Buffer[] = [];
  for (let index = 0; index < Number(count[2]); index += 1) {
    const piece = await call('be read', () => kt.getPassword(SERVICE_NAME, pieceAccount(base, count[1], index)));
    if (piece === null || !BASE64_PATTERN.test(piece)) return null;
    pieces.push(Buffer.from(piece, 'base64'));
  }
  return Buffer.concat(pieces).toString('utf8');
}

/** Deletes every entry of a connection. Throws on the first delete that
 *  fails, so a caller never reports a removal that did not happen. */
export async function deleteConnection(storeRoot: string, id: string): Promise<void> {
  const prefix = connectionPrefix(storeRoot, id);
  const kt = await keytar();
  const entries = await call('be listed', () => kt.findCredentials(SERVICE_NAME));
  // Count entries last, so a delete that stops part-way leaves a set that reads as unusable.
  const accounts = entries.map((entry) => entry.account).filter((account) => account.startsWith(prefix));
  const ordered = [...accounts.filter((a) => a.includes('#')), ...accounts.filter((a) => !a.includes('#'))];
  for (const account of ordered) {
    const deleted = await call('delete an entry', () => kt.deletePassword(SERVICE_NAME, account));
    if (!deleted) throw new CustomMcpKeychainError('the keychain did not delete an entry');
  }
}

/** The IDs of every connection with an entry under `storeRoot`. */
export async function listConnectionIds(storeRoot: string): Promise<string[]> {
  const prefix = `${storeScope(storeRoot)}|`;
  const entries = await call('be listed', async () => (await keytar()).findCredentials(SERVICE_NAME));
  const ids = new Set<string>();
  for (const { account } of entries) {
    if (!account.startsWith(prefix)) continue;
    const id = account.slice(prefix.length).split('|')[0];
    if (id) ids.add(id);
  }
  return [...ids];
}
