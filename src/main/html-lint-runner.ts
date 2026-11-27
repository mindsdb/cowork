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
 *   the page's scripts until the hard timeout ends the run.
 * - A file target loads through LINT_SCHEME, not file://. Without the extra
 *   privileges Electron gives file:// pages (the GrantFileProtocolExtraPrivileges
 *   fuse), a file:// page can load neither a module script nor a `fetch` of a
 *   file beside it, both of which work in Cowork's viewer, which serves
 *   artifacts over http. The scheme gives the same result with that fuse on
 *   or off. It serves the folder under one path segment (LINT_FOLDER_URL), as
 *   the viewer serves it under /api/v1/artifacts/serve/<project>/, so a
 *   root-absolute reference such as /app.js misses the folder in both. It
 *   follows the viewer's file rules too: a name matches in another case or
 *   Unicode form only where the disk itself treats the two as one name, and a
 *   file with a second hard link is refused.
 * - The window runs in an in-memory session of its own (LINT_PARTITION), so
 *   its webRequest listeners and scheme handler sit on a session only it uses.
 * - The hard timeout fits inside anton's budget. An emptiness check that
 *   fails or never answers adds a note to consoleErrors, so neither reads as
 *   a clean page. Every emptiness check has at least SETTLE_MS to answer: a
 *   page that finishes loading just before the limit gets its check at once,
 *   and a check that starts less than SETTLE_MS before the limit moves the
 *   limit to SETTLE_MS after its start. A page that never finishes loading
 *   reports what the run found, and a run that found nothing prints no
 *   result, which html_lint.py reads as "could not check". */

import { app, BrowserWindow, protocol, type RenderProcessGoneDetails } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { contentTypeFor } from './content-types';

export const SETTLE_MS = 500;
/* anton's html_lint.py kills the run at TIMEOUT_SECONDS = 8 and then reads it
 * as "could not check". This timeout starts once the app is ready, so it
 * leaves about 2 s of that budget for the app's start-up and exit. An
 * emptiness check that starts less than SETTLE_MS before this limit, or at
 * it, has SETTLE_MS from its start to answer, so the longest run lasts
 * HARD_TIMEOUT_MS + SETTLE_MS. */
export const HARD_TIMEOUT_MS = 6000;

export const LINT_SCHEME = 'cowork-lint';
export const LINT_PARTITION = 'cowork-html-lint';
const LINT_HOST = 'artifact';
const LINT_ORIGIN = `${LINT_SCHEME}://${LINT_HOST}/`;
/* The one path segment the target's folder is served under. Anything else on
 * the origin answers 404, as the viewer's server root does for a page. */
const LINT_FOLDER_PATH = '/page/';
const LINT_FOLDER_URL = `${LINT_SCHEME}://${LINT_HOST}${LINT_FOLDER_PATH}`;

/* Windows has no O_NOFOLLOW. There the device and inode check after the open
 * refuses a file that a link swapped in. */
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;

export interface LintConsoleError {
  message: string;
  /** The source line. A note the runner adds itself (see RUN_NOTES) has 0. */
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

/** A file the lookup found inside the folder: its real path, and the device
 *  and inode that the scheme's open must find again. */
export interface LintFile {
  file: string;
  dev: bigint;
  ino: bigint;
}

/** Why a LINT_SCHEME URL names no file: a 404 or a 403. */
export type LintRefusal = 'not-found' | 'outside-folder';

/** What a LINT_SCHEME URL names: a file inside the target's folder, or why it names none. */
export type LintFileLookup = LintFile | { refused: LintRefusal };

/* Where a run stands: loading the page, waiting SETTLE_MS after the load,
 * waiting on the emptiness check, or ended. */
type RunPhase = 'loading' | 'settling' | 'checking' | 'ended';

/* The notes the runner adds to consoleErrors when the emptiness check gives
 * no answer. html_lint.py reads only the result's fields, so a note there
 * reaches the agent as a finding instead of the run reading as a clean page. */
const RUN_NOTES = {
  checkTimedOut: 'html lint: the page did not answer the emptiness check in time; a script may be blocking the page',
  checkFailed: (error: unknown) => `html lint: the emptiness check failed: ${error instanceof Error ? error.message : String(error)}`,
} as const;

function runNote(message: string): LintConsoleError {
  return { message, line: 0 };
}

function emitAndExit(result: HtmlLintResult): void {
  process.stdout.write('RESULT_JSON_START\n');
  process.stdout.write(JSON.stringify(result) + '\n');
  process.stdout.write('RESULT_JSON_END\n');
  app.exit(0);
}

/* Ends the run with nothing between the markers, which html_lint.py reads as
 * "could not check". The reason goes to stderr for a person reading the run. */
function exitWithoutResult(reason: string): void {
  process.stderr.write(`html lint: ${reason}\n`);
  app.exit(1);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}

function foldName(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/* The listed name in `dir` that `segment` stands for, or undefined. An exact
 * match comes first. Otherwise it is the one listed name equal to `segment`
 * under NFC and lower case, taken only when the disk resolves the requested
 * spelling to that same entry: a case-insensitive or normalization-insensitive
 * volume does, and a case-sensitive one finds nothing. The viewer's route
 * opens the requested spelling and so follows the same rule. The requested
 * spelling only probes the disk with lstat; the name returned, and so every
 * path the lookup builds, comes from the listing. */
async function diskName(dir: string, names: readonly string[], segment: string): Promise<string | undefined> {
  if (names.includes(segment)) return segment;
  const folded = foldName(segment);
  const matches = names.filter((name) => foldName(name) === folded);
  if (matches.length !== 1) return undefined;
  const [match] = matches;
  try {
    const requested = await fs.promises.lstat(path.join(dir, segment), { bigint: true });
    const listed = await fs.promises.lstat(path.join(dir, match), { bigint: true });
    return requested.dev === listed.dev && requested.ino === listed.ino ? match : undefined;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/* The file `requestUrl` names inside `root`, the real path of the target's
 * folder, which LINT_FOLDER_URL serves. A path outside that segment names
 * nothing. The lookup walks the folder one listing at a time and matches each
 * request segment against the names the disk lists (see diskName), so every
 * path it builds comes from those names and never from the request: a `..`
 * segment matches no listed name and is refused outright. Each entry on the
 * way is resolved before the walk goes on, and one that resolves outside the
 * folder is refused, so the walk never lists a linked folder outside it. The
 * file at the end must be a regular file with one name, as the viewer
 * requires. Only a missing path reads as not found; any other failure to read
 * the disk is thrown. */
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
  let real = root;
  for (const segment of segments) {
    let names: string[];
    try {
      names = await fs.promises.readdir(real);
    } catch (error) {
      if (isMissing(error)) return { refused: 'not-found' };
      throw error;
    }
    const name = await diskName(real, names, segment);
    if (name === undefined) return { refused: 'not-found' };
    try {
      real = await fs.promises.realpath(path.join(real, name));
    } catch (error) {
      if (isMissing(error)) return { refused: 'not-found' };
      throw error;
    }
    if (!isInside(root, real)) return { refused: 'outside-folder' };
  }
  let stats: fs.BigIntStats;
  try {
    stats = await fs.promises.lstat(real, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return { refused: 'not-found' };
    throw error;
  }
  if (!stats.isFile() || stats.nlink !== 1n) return { refused: 'not-found' };
  return { file: real, dev: stats.dev, ino: stats.ino };
}

/* Whether the open file is still the entry the lookup checked, and still a
 * regular file with one name. A different file is refused as outside the
 * folder, since nothing says where it came from. */
function openedFileRefusal(checked: LintFile, opened: fs.BigIntStats): LintRefusal | null {
  if (opened.dev !== checked.dev || opened.ino !== checked.ino) return 'outside-folder';
  if (!opened.isFile() || opened.nlink !== 1n) return 'not-found';
  return null;
}

/* The LINT_SCHEME handler: the file with its content type, 404 for a missing
 * one, 403 for one outside the folder. It opens the file the lookup checked
 * without following a final link, checks that the open file is that same
 * entry, and reads the answer from that descriptor, so a link swapped in after
 * the check is never read. The descriptor is closed before the handler
 * answers, so no file stays open while the run exits. */
export async function serveLintFile(root: string, request: Request): Promise<Response> {
  const lookup = await lookUpLintFile(root, request.url);
  if ('refused' in lookup) return refusalResponse(lookup.refused);
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(lookup.file, fs.constants.O_RDONLY | NO_FOLLOW);
  } catch (error) {
    if (isMissing(error)) return refusalResponse('not-found');
    throw error;
  }
  try {
    const refusal = openedFileRefusal(lookup, await handle.stat({ bigint: true }));
    if (refusal !== null) return refusalResponse(refusal);
    const bytes = await handle.readFile();
    return new Response(bytes, { headers: { 'content-type': contentTypeFor(lookup.file) } });
  } finally {
    await handle.close();
  }
}

function refusalResponse(refusal: LintRefusal): Response {
  return new Response(null, { status: refusal === 'not-found' ? 404 : 403 });
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
    let phase: RunPhase = 'loading';

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

    /* The hard timeout, and the moment it fires on the monotonic clock. The
     * emptiness check reads that moment to learn how long it has left. */
    let hardTimeout: NodeJS.Timeout | undefined;
    let hardDeadline = 0;
    function scheduleHardTimeout(delayMs: number): void {
      clearTimeout(hardTimeout);
      hardDeadline = performance.now() + delayMs;
      hardTimeout = setTimeout(onHardTimeout, delayMs);
    }
    scheduleHardTimeout(HARD_TIMEOUT_MS);

    /* What the hard timeout does depends on where the run stands. A page
     * still loading ends the run with what it found and no note, since a slow
     * page is no finding of its own. If the run found nothing, it prints no
     * result, so html_lint.py reads "could not check", as it does for a run it
     * kills. A page that loaded during the settle wait gets its emptiness
     * check at once, and the check has SETTLE_MS to answer. A check that never
     * answers ends the run with a note. */
    function onHardTimeout(): void {
      switch (phase) {
        case 'loading':
          if (result.consoleErrors.length > 0 || result.failedRequests.length > 0) {
            finish();
          } else {
            phase = 'ended';
            exitWithoutResult(`the page did not finish loading within the ${HARD_TIMEOUT_MS} ms limit`);
          }
          return;
        case 'settling':
          void checkEmptiness();
          return;
        case 'checking':
          result.consoleErrors.push(runNote(RUN_NOTES.checkTimedOut));
          finish();
          return;
        case 'ended':
          return;
      }
    }

    /* Ends the run once, with the result. Only this clears the hard timeout
     * for good (the emptiness check can only move it later), so it still fires
     * while the check waits on a page that never answers. */
    function finish(): void {
      if (phase === 'ended') return;
      phase = 'ended';
      clearTimeout(hardTimeout);
      emitAndExit(result);
    }

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
      finish();
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

    /* The emptiness check runs once: SETTLE_MS after the load, or at once when
     * the hard timeout comes first. A check that starts with less than
     * SETTLE_MS left before the hard timeout, or after it fired, moves the
     * hard timeout to SETTLE_MS from its start, so a page that answers within
     * SETTLE_MS never gets the note that a script may be blocking it. A failed
     * check adds a note rather than reading as a page with content. */
    async function checkEmptiness(): Promise<void> {
      if (phase !== 'settling') return;
      phase = 'checking';
      if (hardDeadline - performance.now() < SETTLE_MS) scheduleHardTimeout(SETTLE_MS);
      try {
        result.emptyPage = (await win.webContents.executeJavaScript(EMPTY_PAGE_CHECK)) === true;
      } catch (error) {
        result.consoleErrors.push(runNote(RUN_NOTES.checkFailed(error)));
      }
      finish();
    }

    /* A failed load needs nothing here: its request is already recorded
     * above, and the result goes out once the page settles either way. A load
     * that settles after the run ended changes nothing. */
    void win.loadURL(pageUrl)
      .catch(() => {})
      .finally(() => {
        if (phase !== 'loading') return;
        phase = 'settling';
        setTimeout(() => void checkEmptiness(), SETTLE_MS);
      });
  });
}
