/* The HTML lint runner a packaged build runs: a port of anton's checked-in
 * anton/core/artifacts/_html_lint_runner.js, kept line for line where
 * TypeScript allows so the two stay easy to diff. A packaged build runs this
 * copy instead of a script the environment names, which would run as this
 * signed binary's main process. anton/core/artifacts/html_lint.py reads its
 * output.
 *
 * Target: a file path, served from its own folder (see LINT_SCHEME below), or
 * an http(s) URL (the fullstack page served by its own running backend, where
 * the relative /api/* fetches resolve). html-lint-host.ts reads it from
 * ANTON_HTML_LINT_TARGET and checks it before this runs.
 *
 * Loads the page in a hidden, sandboxed BrowserWindow and reports one JSON
 * blob between RESULT_JSON_START/RESULT_JSON_END on stdout: console errors
 * scoped to the page's own origin (excludes Electron's own internal
 * diagnostics, e.g. its CSP warning, filtered by source, not content),
 * failed local asset requests, and whether the renderer crashed.
 *
 * Network policy (onBeforeRequest below): runs automatically per cell,
 * unlike a human opening the artifact, so it's tighter than normal runtime.
 * Not fully closed: an external GET can still leak a little via query
 * params; same order of risk the product already accepts on preview.
 *
 * Additions over anton's copy:
 * - The page gets no permission (microphone, camera, notifications and the
 *   rest). Electron grants every permission a session has no handler for, so
 *   a page that asked for the microphone here would record under this app's
 *   own system grant.
 * - The page opens no window, shows no alert or confirm dialog, and starts no
 *   download. Each would put a window, a message box or a Save dialog on the
 *   user's desktop during an automatic check. A message box would also stop
 *   the page's scripts until the run times out.
 * - A file target loads through LINT_SCHEME, not file://. Without the extra
 *   privileges Electron gives file:// pages (the GrantFileProtocolExtraPrivileges
 *   fuse), a file:// page can load neither a module script nor a `fetch` of a
 *   file beside it, both of which work in Cowork's viewer, which serves
 *   artifacts over http. The scheme gives the same result with that fuse on
 *   or off. It serves the folder under one path segment (LINT_FOLDER_URL), as
 *   the viewer serves it under /api/v1/artifacts/serve/<project>/, so a
 *   root-absolute reference such as /app.js misses the folder in both.
 * - The window runs in an in-memory session of its own (LINT_PARTITION), so
 *   its webRequest listeners and scheme handler sit on a session only it uses. */

import { app, BrowserWindow, protocol, type RenderProcessGoneDetails } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { contentTypeFor } from './content-types';

export const SETTLE_MS = 500;
export const HARD_TIMEOUT_MS = 15000; // safety net; the real enforcement is the caller's subprocess timeout

export const LINT_SCHEME = 'cowork-lint';
export const LINT_PARTITION = 'cowork-html-lint';
const LINT_HOST = 'artifact';
const LINT_ORIGIN = `${LINT_SCHEME}://${LINT_HOST}/`;
/* The one path segment the target's folder is served under. Anything else on
 * the origin answers 404, as the viewer's server root does for a page. */
const LINT_FOLDER_PATH = '/page/';
const LINT_FOLDER_URL = `${LINT_SCHEME}://${LINT_HOST}${LINT_FOLDER_PATH}`;

export interface LintConsoleError {
  message: string;
  line: number;
}

export interface LintFailedRequest {
  url: string;
  error: string;
}

/** The JSON blob between the markers. Key order matches anton's runner. */
export interface HtmlLintResult {
  consoleErrors: LintConsoleError[];
  failedRequests: LintFailedRequest[];
  crashed: boolean;
  crashDetails: RenderProcessGoneDetails | null;
  emptyPage: boolean;
}

/** What a LINT_SCHEME URL names: a file inside the target's folder, or why it names none. */
export type LintFileLookup = { file: string } | { refused: 'not-found' | 'outside-folder' };

function emitAndExit(result: HtmlLintResult): void {
  process.stdout.write('RESULT_JSON_START\n');
  process.stdout.write(JSON.stringify(result) + '\n');
  process.stdout.write('RESULT_JSON_END\n');
  app.exit(0);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}

/* The file `requestUrl` names inside `root`, the real path of the target's
 * folder, which LINT_FOLDER_URL serves. A path outside that segment names
 * nothing. The lookup walks the folder one listing at a time and matches each
 * request segment against the names the disk lists, so every path it builds
 * comes from those names and never from the request: a `..` segment matches
 * no listed name and is refused outright, and a link that resolves outside
 * the folder is refused. Only a missing path reads as not found; any other
 * failure to read the disk is thrown. */
export async function lookUpLintFile(root: string, requestUrl: string): Promise<LintFileLookup> {
  const url = new URL(requestUrl);
  if (url.host !== LINT_HOST) return { refused: 'outside-folder' };
  if (!url.pathname.startsWith(LINT_FOLDER_PATH)) return { refused: 'not-found' };
  let segments: string[];
  try {
    segments = decodeURIComponent(url.pathname.slice(LINT_FOLDER_PATH.length)).split('/').filter((segment) => segment !== '');
  } catch {
    return { refused: 'not-found' };
  }
  if (segments.some((segment) => segment === '..' || segment === '.')) return { refused: 'outside-folder' };
  if (segments.length === 0) return { refused: 'not-found' };
  let listed = root;
  for (const segment of segments) {
    let names: string[];
    try {
      names = await fs.promises.readdir(listed);
    } catch (error) {
      if (isMissing(error)) return { refused: 'not-found' };
      throw error;
    }
    const name = names.find((candidate) => candidate === segment);
    if (name === undefined) return { refused: 'not-found' };
    listed = path.join(listed, name);
  }
  let real: string;
  try {
    real = await fs.promises.realpath(listed);
  } catch (error) {
    if (isMissing(error)) return { refused: 'not-found' };
    throw error;
  }
  if (!isInside(root, real)) return { refused: 'outside-folder' };
  if (!(await fs.promises.stat(real)).isFile()) return { refused: 'not-found' };
  return { file: real };
}

/* The LINT_SCHEME handler: the file with its content type, 404 for a missing
 * one, 403 for one outside the folder. */
export async function serveLintFile(root: string, request: Request): Promise<Response> {
  const lookup = await lookUpLintFile(root, request.url);
  if ('refused' in lookup) return new Response(null, { status: lookup.refused === 'not-found' ? 404 : 403 });
  const body = await fs.promises.readFile(lookup.file);
  return new Response(new Uint8Array(body), { headers: { 'content-type': contentTypeFor(lookup.file) } });
}

/* Heuristic, not authoritative: true only when the body has neither visible
 * text nor a non-script/style/meta child element. Catches "nothing rendered
 * at all" (e.g. a page whose entire markup got swallowed as text by an
 * unclosed <title>/<script>/<style>, a real case found in testing) without
 * flagging a legitimately content-free page that fills in later (async data,
 * a splash screen). False negatives are expected (e.g. a blank <canvas>). */
const EMPTY_PAGE_CHECK = `(() => {
  if (!document.body) return true;
  const NON_VISUAL = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT', 'TITLE']);
  const visibleChildren = Array.from(document.body.children).filter((el) => !NON_VISUAL.has(el.tagName));
  const hasText = document.body.innerText.trim().length > 0;
  return visibleChildren.length === 0 && !hasText;
})()`;

/* Starts the lint of `targetPath`. Call it before `ready`: it turns off
 * hardware acceleration and registers LINT_SCHEME as a privileged scheme, and
 * Electron accepts both only before `ready`. This is the only scheme the
 * process registers; the app itself (app.ts) registers none. The promise
 * settles once the window and its listeners are in place; the run ends with
 * `app.exit`. */
export function startHtmlLintRunner(targetPath: string): Promise<void> {
  app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([
    { scheme: LINT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
  app.on('window-all-closed', () => {});

  return app.whenReady().then(() => {
    const result: HtmlLintResult = { consoleErrors: [], failedRequests: [], crashed: false, crashDetails: null, emptyPage: false };

    /* "Own" scope for console errors and failed requests: the scheme's whole
     * origin for a file, so a root-absolute reference that misses the page's
     * folder counts as well; the origin for a URL (the backend serves both the
     * page and its /api/*, so a failing route counts as the page's own
     * problem). */
    const isUrl = /^https?:\/\//i.test(targetPath);
    let targetDirUrl = isUrl ? new URL(targetPath).origin : LINT_ORIGIN;
    if (!targetDirUrl.endsWith('/')) targetDirUrl += '/';

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        disableDialogs: true,
        partition: LINT_PARTITION,
      },
    });

    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.on('will-download', (event) => event.preventDefault());

    const hardTimeout = setTimeout(() => emitAndExit(result), HARD_TIMEOUT_MS);

    win.webContents.on('console-message', (event) => {
      /* Single-event-object form (the older (event, level, message, line,
       * sourceId) callback is deprecated and warns on stderr as of this
       * Electron). `event.level` is the string "error"/"warning"/"info" here,
       * not the old numeric level. */
      if (event.level !== 'error') return;
      if (!event.sourceId || !event.sourceId.startsWith(targetDirUrl)) return;
      result.consoleErrors.push({ message: event.message, line: event.lineNumber });
    });

    win.webContents.on('render-process-gone', (_event, details) => {
      result.crashed = true;
      result.crashDetails = details;
      clearTimeout(hardTimeout);
      emitAndExit(result);
    });

    win.webContents.session.webRequest.onErrorOccurred((details) => {
      if (details.url.startsWith(targetDirUrl)) {
        result.failedRequests.push({ url: details.url, error: details.error });
      }
    });

    /* Over http a missing asset or an unserved route is not a network error
     * but a completed response with a 4xx/5xx status: report it the same way
     * file:// reports ERR_FILE_NOT_FOUND. Own-scope only, like the above.
     * LINT_SCHEME answers a missing file with a 404 the same way. */
    win.webContents.session.webRequest.onCompleted((details) => {
      if (details.url.startsWith(targetDirUrl) && details.statusCode >= 400) {
        result.failedRequests.push({ url: details.url, error: 'HTTP ' + details.statusCode });
      }
    });

    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      let url: URL;
      try {
        url = new URL(details.url);
      } catch {
        callback({});
        return;
      }
      const isLocal = url.protocol === 'file:' || url.protocol === `${LINT_SCHEME}:`;
      /* A WHATWG URL keeps the brackets on an IPv6 host. */
      const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
      if (isLocal || isLoopback || details.method === 'GET') {
        callback({});
        return;
      }
      /* External, state-changing request: neutralize as an empty SUCCESS
       * rather than a cancel, so a correctly-written artifact's own
       * `.catch(...)` doesn't fire and log a spurious console error that
       * would be an artifact of our interception, not a real bug. */
      callback({ redirectURL: 'data:text/plain,' });
    });

    let pageUrl = targetPath;
    if (!isUrl) {
      /* The native realpath returns the disk's own spelling, as the lookup's
       * realpath does, so a target spelled in another case or Unicode form
       * still sits inside the root it is served from. */
      const page = fs.realpathSync.native(path.resolve(targetPath));
      const root = path.dirname(page);
      win.webContents.session.protocol.handle(LINT_SCHEME, (request) => serveLintFile(root, request));
      pageUrl = LINT_FOLDER_URL + encodeURIComponent(path.basename(page));
    }

    /* A failed load needs nothing here: its request is already recorded
     * above, and the result goes out once the page settles either way. */
    void win.loadURL(pageUrl)
      .catch(() => {})
      .finally(() => {
        setTimeout(async () => {
          clearTimeout(hardTimeout);
          if (!result.crashed) {
            result.emptyPage = (await win.webContents.executeJavaScript(EMPTY_PAGE_CHECK).catch(() => false)) === true;
          }
          emitAndExit(result);
        }, SETTLE_MS);
      });
  });
}
