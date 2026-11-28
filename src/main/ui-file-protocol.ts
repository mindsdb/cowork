/* The main window's file:// loads from the UI cache, answered through the per-file reader.
 *
 * The folder check before each load (resolveRendererLoad in ui-updater.ts) covers the files the
 * page loads at that moment. The page imports some chunks only on first use, such as the
 * terminal and the diagram renderer, and Chromium reads those from the cache folder long after
 * the check. This handler takes over the file:// scheme of the session the main window uses, so
 * every load of a file inside the UI cache goes through readServedUiFile, which returns a file
 * only when its bytes match the manifest the folder check verified before the load.
 *
 * - A GET of a file in the slot the window loaded gets the file's bytes, with the content type
 *   its extension names (content-types.ts).
 * - Every other request inside the cache gets 404: a file the manifest does not list, a path that
 *   is not safe, a file that could not be read, any other method, and every path outside the
 *   served slot (`staging`, `previous`, or `current` while the bundled renderer is loaded).
 * - A read that finds a file of the served slot changed on disk also refuses the slot
 *   (refuseServedUiSlot), which deletes it, so the next load serves the bundled renderer.
 * - Every file:// request outside the cache goes to Electron's own file handler unchanged, the
 *   bundled renderer inside app.asar among them.
 *
 * In Electron 45 a dedicated or shared worker's script does not go through this handler, so a
 * worker script in the cache is checked only by the folder check before the load.
 *
 * The path of a request is its URL's path as fileURLToPath reads it, which drops the query and
 * the fragment. A URL fileURLToPath refuses, such as one with an encoded slash, gets 404, because
 * its path cannot be shown to lie outside the cache. */

import type { Session } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { contentTypeFor } from './content-types';
import {
  getCacheDir,
  readServedUiFile,
  refuseServedUiSlot,
  servedUiRoot,
  type ServedSlotChange,
  type ServedUiFileRead,
} from './ui-updater';

/** What the handler needs to know about the UI cache when a request arrives. */
export interface UiCacheView {
  /** The UI cache folder (ui-updater's getCacheDir). */
  cacheDir: string;
  /** The folder of the slot the window loaded, or null while it runs the bundled renderer. */
  servedRoot: string | null;
}

/** How the handler answers one file:// request. */
export type FileRoute =
  | { kind: 'pass-through' }
  | { kind: 'not-found' }
  | { kind: 'served-file'; relativePath: string };

/** The fields of a request the routing reads. */
export interface FileRequest {
  method: string;
  url: string;
}

/** The `path` functions the routing uses. A test passes `path.win32` to stand for Windows. */
export type PathApi = Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'>;

/** Why readServedUiFile refused a file. */
export type ServedUiFileRefusal = Extract<ServedUiFileRead, { ok: false }>['reason'];

/** What the handler reads from the UI updater, and the refusal it asks of it. */
export interface UiCacheAccess {
  view(): UiCacheView;
  readServedFile(relativePath: string): ServedUiFileRead;
  refuseServedSlot(reason: ServedSlotChange): void;
}

/** `target` as a `/`-separated path relative to `root`, the empty string for `root` itself, or
 *  null when `target` lies outside `root`. */
export function relativeInside(root: string, target: string, pathApi: PathApi = path): string | null {
  const relative = pathApi.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) return null;
  return relative.split(pathApi.sep).join('/');
}

/* A macOS volume ignores case and Unicode normalization by default, so a URL spelled differently
   from the cache folder still opens a file inside it. The cache test compares folded spellings
   there, so such a URL counts as inside the cache, and the served-slot lookup below, which keeps
   the exact spelling, answers it 404. path.win32.relative already ignores case. */
function foldSpelling(p: string, fold: boolean): string {
  return fold ? p.normalize('NFC').toLowerCase() : p;
}

/** How to answer a file:// request: pass a path outside the UI cache through, serve a GET of a
 *  file in the served slot, and refuse everything else inside the cache. */
export function routeFileRequest(
  request: FileRequest,
  view: UiCacheView,
  pathApi: PathApi = path,
  toPath: (url: string) => string = fileURLToPath,
  foldCase: boolean = process.platform === 'darwin',
): FileRoute {
  let filePath: string;
  try {
    filePath = toPath(request.url);
  } catch {
    return { kind: 'not-found' };
  }
  if (relativeInside(foldSpelling(view.cacheDir, foldCase), foldSpelling(filePath, foldCase), pathApi) === null) {
    return { kind: 'pass-through' };
  }
  if (request.method !== 'GET' || view.servedRoot === null) return { kind: 'not-found' };
  const relativePath = relativeInside(view.servedRoot, filePath, pathApi);
  return relativePath === null ? { kind: 'not-found' } : { kind: 'served-file', relativePath };
}

/** Whether a refusal means a file of the served slot changed on disk after the folder check, as
 *  opposed to a request for a file the bundle does not have or that could not be read. */
export function slotChangedOnDisk(reason: ServedUiFileRefusal): reason is ServedSlotChange {
  return reason === 'hash-mismatch' || reason === 'non-regular-entry' || reason === 'missing-file';
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

/** The handler's answer to one file:// request. The routing, the read and a refusal run without
 *  an await between them, so they all see the same served slot. */
export async function answerFileRequest(
  request: Request,
  access: UiCacheAccess,
  passThrough: (request: Request) => Promise<Response>,
): Promise<Response> {
  const route = routeFileRequest(request, access.view());
  if (route.kind === 'pass-through') return passThrough(request);
  if (route.kind === 'not-found') return notFound();
  const read = access.readServedFile(route.relativePath);
  if (read.ok) {
    return new Response(new Uint8Array(read.bytes), { headers: { 'content-type': contentTypeFor(route.relativePath) } });
  }
  if (slotChangedOnDisk(read.reason)) access.refuseServedSlot(read.reason);
  return notFound();
}

const uiUpdaterAccess: UiCacheAccess = {
  view: () => ({ cacheDir: getCacheDir(), servedRoot: servedUiRoot() }),
  readServedFile: readServedUiFile,
  refuseServedSlot: refuseServedUiSlot,
};

/** Takes over the file:// scheme of the session the main window uses. Call it after `ready` and
 *  before the window loads anything. A request outside the UI cache goes on to Electron's own
 *  file handler through the same session's fetch with `bypassCustomProtocolHandlers`, the way
 *  Electron's protocol.handle documentation passes on a request to a built-in scheme. */
export function registerUiFileProtocol(ses: Pick<Session, 'protocol' | 'fetch'>): void {
  const electronFileHandler = (request: Request) => ses.fetch(request, { bypassCustomProtocolHandlers: true });
  ses.protocol.handle('file', (request) => answerFileRequest(request, uiUpdaterAccess, electronFileHandler));
}
