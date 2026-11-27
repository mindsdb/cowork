import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type Listener = (...args: unknown[]) => void;
type BeforeRequestCallback = (response: { redirectURL?: string; cancel?: boolean }) => void;
type BeforeRequestListener = (details: { url: string; method: string }, callback: BeforeRequestCallback) => void;
type PermissionRequestHandler = (webContents: unknown, permission: string, callback: (granted: boolean) => void) => void;
type SchemeHandler = (request: Request) => Promise<Response>;
type WindowOpenHandler = (details: { url: string }) => { action: 'allow' | 'deny' };

/* A hidden BrowserWindow whose page events the test fires by hand. */
const electron = vi.hoisted(() => {
  const state = {
    load: Promise.resolve() as Promise<void>,
    emptyPage: false as unknown,
    last: null as null | { options: unknown; webContents: FakeWebContents; loadURL: ReturnType<typeof vi.fn> },
  };
  class FakeEmitter {
    listeners: Record<string, Listener[]> = {};
    on(name: string, listener: Listener) {
      (this.listeners[name] ??= []).push(listener);
      return this;
    }
    emit(name: string, ...args: unknown[]) {
      for (const listener of this.listeners[name] ?? []) listener(...args);
    }
  }
  class FakeWebRequest {
    errorOccurred: Listener | null = null;
    completed: Listener | null = null;
    beforeRequest: BeforeRequestListener | null = null;
    onErrorOccurred(listener: Listener) { this.errorOccurred = listener; }
    onCompleted(listener: Listener) { this.completed = listener; }
    onBeforeRequest(listener: BeforeRequestListener) { this.beforeRequest = listener; }
  }
  class FakeSession extends FakeEmitter {
    webRequest = new FakeWebRequest();
    schemes = new Map<string, SchemeHandler>();
    protocol = { handle: (scheme: string, handler: SchemeHandler) => { this.schemes.set(scheme, handler); } };
    permissionRequest: PermissionRequestHandler | null = null;
    permissionCheck: ((...args: unknown[]) => boolean) | null = null;
    setPermissionRequestHandler(handler: PermissionRequestHandler) { this.permissionRequest = handler; }
    setPermissionCheckHandler(handler: (...args: unknown[]) => boolean) { this.permissionCheck = handler; }
  }
  class FakeWebContents extends FakeEmitter {
    session = new FakeSession();
    windowOpen: WindowOpenHandler | null = null;
    executeJavaScript = vi.fn(async () => state.emptyPage);
    setWindowOpenHandler(handler: WindowOpenHandler) { this.windowOpen = handler; }
  }
  class BrowserWindow {
    options: unknown;
    webContents = new FakeWebContents();
    loadURL = vi.fn(() => state.load);
    constructor(options: unknown) {
      this.options = options;
      state.last = this;
    }
  }
  const app = {
    disableHardwareAcceleration: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    exit: vi.fn(),
  };
  const protocol = { registerSchemesAsPrivileged: vi.fn() };
  return { app, BrowserWindow, protocol, state };
});
vi.mock('electron', () => ({ app: electron.app, BrowserWindow: electron.BrowserWindow, protocol: electron.protocol }));

import {
  HARD_TIMEOUT_MS,
  LINT_PARTITION,
  LINT_SCHEME,
  SETTLE_MS,
  lookUpLintFile,
  serveLintFile,
  startHtmlLintRunner,
  type LintFile,
} from './html-lint-runner';

/* What reads this output: anton/core/artifacts/html_lint.py, which is Python
 * in another repository, so this mirrors its `_extract_result` and
 * `_findings_from_result` rather than importing them (`scrub_output` left
 * out: these test messages hold nothing it redacts). */
interface AntonFinding {
  kind: 'console_error' | 'failed_request' | 'crashed' | 'empty_page';
  detail: string;
}
type JsonObject = Record<string, unknown>;

const RESULT_START = 'RESULT_JSON_START';
const RESULT_END = 'RESULT_JSON_END';
const EMPTY_PAGE_DETAIL = 'page rendered with no visible text or elements — could be intentional (content added later) or a sign the markup/script is broken; worth opening to confirm';
/* html_lint.py's TIMEOUT_SECONDS: it kills the run then and reads it as "could not check". */
const ANTON_TIMEOUT_MS = 8000;

function extractResult(stdout: string): JsonObject | null {
  const start = stdout.indexOf(RESULT_START);
  const end = stdout.indexOf(RESULT_END);
  if (start === -1 || end === -1 || end <= start) return null;
  const blob = stdout.slice(start + RESULT_START.length, end).trim();
  let data: unknown;
  try {
    data = JSON.parse(blob);
  } catch {
    return null;
  }
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as JsonObject) : null;
}

function findingsFromResult(result: JsonObject): AntonFinding[] {
  const findings: AntonFinding[] = [];
  for (const err of (result.consoleErrors as JsonObject[] | null) ?? []) {
    const message = (err.message as string | undefined) ?? '';
    const line = err.line;
    findings.push({ kind: 'console_error', detail: line ? `${message} (line ${String(line)})` : message });
  }
  for (const req of (result.failedRequests as JsonObject[] | null) ?? []) {
    /* html_lint.py joins the two with an em dash. */
    findings.push({ kind: 'failed_request', detail: `${String(req.url ?? '?')} — ${String(req.error ?? 'unknown error')}` });
  }
  if (result.crashed) findings.push({ kind: 'crashed', detail: 'renderer process crashed while loading the page' });
  if (result.emptyPage) findings.push({ kind: 'empty_page', detail: EMPTY_PAGE_DETAIL });
  return findings;
}

/* The scheme's origin, and the one path segment it serves a file target's folder under. */
const LINT_ORIGIN_URL = `${LINT_SCHEME}://artifact/`;
const PAGE_DIR_URL = `${LINT_ORIGIN_URL}page/`;

let folder: string;
let page: string;
let stdout: string[];
let finishLoad: () => void;
let failLoad: (error: Error) => void;

function printed(): string {
  return stdout.join('');
}

function window() {
  const win = electron.state.last;
  if (!win) throw new Error('no BrowserWindow was created');
  return win;
}

async function settle(): Promise<void> {
  finishLoad();
  await vi.advanceTimersByTimeAsync(SETTLE_MS);
}

/* What the lookup answers for a file it serves: its path and its device and inode. */
function found(file: string): LintFile {
  const stats = fs.statSync(file, { bigint: true });
  return { file, dev: stats.dev, ino: stats.ino };
}

beforeEach(() => {
  folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'html-lint-runner-test-')));
  page = path.join(folder, 'page.html');
  fs.writeFileSync(page, '<!DOCTYPE html><html><body><h1>ok</h1></body></html>');
  vi.useFakeTimers();
  vi.clearAllMocks();
  electron.state.last = null;
  electron.state.emptyPage = false;
  electron.state.load = new Promise<void>((resolve, reject) => {
    finishLoad = resolve;
    failLoad = reject;
  });
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(folder, { recursive: true, force: true });
});

describe('startHtmlLintRunner: the window', () => {
  it('turns off hardware acceleration and registers its scheme before ready, and opens a hidden, sandboxed, offscreen window with no preload and no alert or confirm dialog', async () => {
    await startHtmlLintRunner(page);

    const ready = electron.app.whenReady.mock.invocationCallOrder[0];
    expect(electron.app.disableHardwareAcceleration.mock.invocationCallOrder[0]).toBeLessThan(ready);
    expect(electron.protocol.registerSchemesAsPrivileged.mock.invocationCallOrder[0]).toBeLessThan(ready);
    expect(electron.protocol.registerSchemesAsPrivileged).toHaveBeenCalledExactlyOnceWith([
      { scheme: LINT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    ]);
    expect(window().options).toEqual({
      show: false,
      webPreferences: {
        offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, disableDialogs: true, partition: LINT_PARTITION,
      },
    });
    expect(electron.app.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
  });

  it("loads a file target through its scheme, from the one path segment that serves the target's folder", async () => {
    fs.writeFileSync(path.join(folder, 'my page.html'), '<p>x</p>');
    await startHtmlLintRunner(path.join(folder, 'my page.html'));

    expect(window().loadURL).toHaveBeenCalledExactlyOnceWith(`${PAGE_DIR_URL}my%20page.html`);
    const handler = window().webContents.session.schemes.get(LINT_SCHEME);
    const response = await handler!(new Request(`${PAGE_DIR_URL}my%20page.html`));
    expect(await response.text()).toBe('<p>x</p>');
  });

  it.runIf(process.platform === 'darwin')('serves a target whose folder the caller spells in another case than the disk', async (context) => {
    fs.mkdirSync(path.join(folder, 'Code', 'Report'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'Code', 'Report', 'index.html'), '<p>report</p>');
    const misspelled = path.join(folder, 'code', 'report', 'index.html');
    if (!fs.existsSync(misspelled)) context.skip('this volume is case-sensitive');

    await startHtmlLintRunner(misspelled);

    expect(window().loadURL).toHaveBeenCalledExactlyOnceWith(`${PAGE_DIR_URL}index.html`);
    const handler = window().webContents.session.schemes.get(LINT_SCHEME);
    const response = await handler!(new Request(`${PAGE_DIR_URL}index.html`));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<p>report</p>');
  });

  it('loads an http(s) target as it is, with no scheme handler', async () => {
    await startHtmlLintRunner('http://127.0.0.1:8123/index.html');

    expect(window().loadURL).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:8123/index.html');
    expect(window().webContents.session.schemes.size).toBe(0);
  });

  it('grants the page no permission', async () => {
    await startHtmlLintRunner(page);
    const session = window().webContents.session;
    const granted = vi.fn();

    session.permissionRequest?.(window().webContents, 'media', granted);

    expect(granted).toHaveBeenCalledExactlyOnceWith(false);
    expect(session.permissionCheck?.(window().webContents, 'media', PAGE_DIR_URL, {})).toBe(false);
  });

  it('denies every window the page opens', async () => {
    await startHtmlLintRunner(page);

    expect(window().webContents.windowOpen?.({ url: 'https://example.test/' })).toEqual({ action: 'deny' });
  });

  it('cancels every download the page starts', async () => {
    await startHtmlLintRunner(page);
    const event = { preventDefault: vi.fn() };

    window().webContents.session.emit('will-download', event, {}, window().webContents);

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

describe('startHtmlLintRunner: the output html_lint.py parses', () => {
  it('reports a clean page as no findings and exits 0', async () => {
    await startHtmlLintRunner(page);
    await settle();

    expect(printed()).toMatch(/^RESULT_JSON_START\n.*\nRESULT_JSON_END\n$/);
    const result = extractResult(printed());
    expect(result).toEqual({ consoleErrors: [], failedRequests: [], crashed: false, crashDetails: null, emptyPage: false });
    expect(findingsFromResult(result!)).toEqual([]);
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("reports the page's own console errors and drops the rest", async () => {
    await startHtmlLintRunner(page);
    const contents = window().webContents;
    contents.emit('console-message', { level: 'error', message: 'boom', lineNumber: 7, sourceId: `${PAGE_DIR_URL}page.html` });
    contents.emit('console-message', { level: 'error', message: 'elsewhere', lineNumber: 1, sourceId: 'https://cdn.example.test/x.js' });
    contents.emit('console-message', { level: 'warning', message: 'just a warning', lineNumber: 2, sourceId: `${PAGE_DIR_URL}page.html` });
    contents.emit('console-message', { level: 'error', message: 'Electron security warning', lineNumber: 0, sourceId: '' });
    await settle();

    expect(findingsFromResult(extractResult(printed())!)).toEqual([
      { kind: 'console_error', detail: 'boom (line 7)' },
    ]);
  });

  it("reports the page's own missing files and failed requests", async () => {
    await startHtmlLintRunner(page);
    const webRequest = window().webContents.session.webRequest;
    webRequest.completed?.({ url: `${PAGE_DIR_URL}missing.js`, statusCode: 404 });
    webRequest.completed?.({ url: `${PAGE_DIR_URL}app.js`, statusCode: 200 });
    webRequest.errorOccurred?.({ url: `${PAGE_DIR_URL}data.json`, error: 'net::ERR_FAILED' });
    webRequest.errorOccurred?.({ url: 'https://cdn.example.test/lib.js', error: 'net::ERR_NAME_NOT_RESOLVED' });
    await settle();

    expect(findingsFromResult(extractResult(printed())!)).toEqual([
      { kind: 'failed_request', detail: `${PAGE_DIR_URL}missing.js — HTTP 404` },
      { kind: 'failed_request', detail: `${PAGE_DIR_URL}data.json — net::ERR_FAILED` },
    ]);
  });

  it("reports a root-absolute reference that misses the page's folder", async () => {
    await startHtmlLintRunner(page);
    window().webContents.session.webRequest.completed?.({ url: `${LINT_ORIGIN_URL}app.js`, statusCode: 404 });
    await settle();

    expect(findingsFromResult(extractResult(printed())!)).toEqual([
      { kind: 'failed_request', detail: `${LINT_ORIGIN_URL}app.js — HTTP 404` },
    ]);
  });

  it("reports a 4xx/5xx response from the page's own origin as a failed request", async () => {
    await startHtmlLintRunner('http://127.0.0.1:8123/index.html');
    const webRequest = window().webContents.session.webRequest;
    webRequest.completed?.({ url: 'http://127.0.0.1:8123/api/items', statusCode: 404 });
    webRequest.completed?.({ url: 'http://127.0.0.1:8123/app.js', statusCode: 200 });
    webRequest.completed?.({ url: 'https://api.example.test/x', statusCode: 500 });
    await settle();

    expect(findingsFromResult(extractResult(printed())!)).toEqual([
      { kind: 'failed_request', detail: 'http://127.0.0.1:8123/api/items — HTTP 404' },
    ]);
  });

  it('reports an empty body', async () => {
    electron.state.emptyPage = true;
    await startHtmlLintRunner(page);
    await settle();

    expect(window().webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(findingsFromResult(extractResult(printed())!)).toEqual([{ kind: 'empty_page', detail: EMPTY_PAGE_DETAIL }]);
  });

  it('reports a failed emptiness check as a finding, not as a page with content', async () => {
    await startHtmlLintRunner(page);
    window().webContents.executeJavaScript.mockRejectedValueOnce(new Error('Script failed to execute'));
    await settle();

    const result = extractResult(printed());
    expect(result).toMatchObject({ emptyPage: false });
    expect(findingsFromResult(result!)).toEqual([
      { kind: 'console_error', detail: expect.stringContaining('the emptiness check failed: Script failed to execute') },
    ]);
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('reports a page that never answers the emptiness check, a page that loops forever after load for one', async () => {
    await startHtmlLintRunner(page);
    window().webContents.executeJavaScript.mockImplementationOnce(() => new Promise<unknown>(() => {}));
    await settle();
    expect(window().webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(printed()).toBe('');

    await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - SETTLE_MS);

    expect(findingsFromResult(extractResult(printed())!)).toEqual([
      { kind: 'console_error', detail: expect.stringContaining('did not answer the emptiness check') },
    ]);
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('reports a renderer crash at once, and only once', async () => {
    await startHtmlLintRunner(page);
    window().webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 });

    const result = extractResult(printed());
    expect(result).toMatchObject({ crashed: true, crashDetails: { reason: 'crashed', exitCode: 133 } });
    expect(findingsFromResult(result!)).toEqual([{ kind: 'crashed', detail: 'renderer process crashed while loading the page' }]);

    await settle();
    await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS);
    expect(printed().split(RESULT_START)).toHaveLength(2);
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('still reports after a failed load', async () => {
    await startHtmlLintRunner(page);
    window().webContents.session.webRequest.completed?.({ url: `${PAGE_DIR_URL}page.html`, statusCode: 404 });
    failLoad(new Error('ERR_HTTP_RESPONSE_CODE_FAILURE'));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(findingsFromResult(extractResult(printed())!)).toEqual([
      { kind: 'failed_request', detail: `${PAGE_DIR_URL}page.html — HTTP 404` },
    ]);
  });

  it('checks a page that finishes loading just before the limit at once, with no note', async () => {
    electron.state.emptyPage = true;
    await startHtmlLintRunner(page);
    await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - 100);
    finishLoad();
    await vi.advanceTimersByTimeAsync(99);
    expect(window().webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(printed()).toBe('');

    await vi.advanceTimersByTimeAsync(1);

    expect(window().webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(extractResult(printed())).toEqual({ consoleErrors: [], failedRequests: [], crashed: false, crashDetails: null, emptyPage: true });
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0);

    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(window().webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(printed().split(RESULT_START)).toHaveLength(2);
  });

  it('gives a check that starts at the limit SETTLE_MS to answer, and reports a page that never does', async () => {
    await startHtmlLintRunner(page);
    window().webContents.executeJavaScript.mockImplementationOnce(() => new Promise<unknown>(() => {}));
    await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - 100);
    finishLoad();
    await vi.advanceTimersByTimeAsync(100 + SETTLE_MS - 1);
    expect(window().webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(printed()).toBe('');

    await vi.advanceTimersByTimeAsync(1);

    expect(findingsFromResult(extractResult(printed())!)).toEqual([
      { kind: 'console_error', detail: expect.stringContaining('did not answer the emptiness check') },
    ]);
    expect(window().webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('gives a check that starts less than SETTLE_MS before the limit SETTLE_MS to answer, with no note for a page that answers in that time', async () => {
    await startHtmlLintRunner(page);
    window().webContents.executeJavaScript.mockImplementationOnce(
      () => new Promise<unknown>((resolve) => { setTimeout(() => resolve(false), 50); }),
    );
    await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - SETTLE_MS - 10);
    finishLoad();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(window().webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(printed()).toBe('');

    await vi.advanceTimersByTimeAsync(50);

    expect(extractResult(printed())).toEqual({ consoleErrors: [], failedRequests: [], crashed: false, crashDetails: null, emptyPage: false });
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0);

    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(printed().split(RESULT_START)).toHaveLength(2);
    expect(electron.app.exit).toHaveBeenCalledOnce();
  });

  it('reports a check that starts less than SETTLE_MS before the limit and never answers, SETTLE_MS after its start', async () => {
    await startHtmlLintRunner(page);
    window().webContents.executeJavaScript.mockImplementationOnce(() => new Promise<unknown>(() => {}));
    await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - SETTLE_MS - 10);
    finishLoad();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + SETTLE_MS - 1);
    expect(window().webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(printed()).toBe('');

    await vi.advanceTimersByTimeAsync(1);

    expect(findingsFromResult(extractResult(printed())!)).toEqual([
      { kind: 'console_error', detail: expect.stringContaining('did not answer the emptiness check') },
    ]);
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('prints no result, which html_lint.py reads as "could not check", when the page never finishes loading and the run found nothing', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await startHtmlLintRunner(page);
    await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS - 1);
    expect(electron.app.exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(printed()).toBe('');
    expect(extractResult(printed())).toBeNull();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('did not finish loading'));
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(1);

    finishLoad();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(window().webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(printed()).toBe('');
    expect(electron.app.exit).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'a console error',
      record: () => window().webContents.emit('console-message', { level: 'error', message: 'boom', lineNumber: 3, sourceId: `${PAGE_DIR_URL}page.html` }),
      expected: { consoleErrors: [{ message: 'boom', line: 3 }], failedRequests: [] },
    },
    {
      name: 'a failed request',
      record: () => window().webContents.session.webRequest.completed?.({ url: `${PAGE_DIR_URL}missing.js`, statusCode: 404 }),
      expected: { consoleErrors: [], failedRequests: [{ url: `${PAGE_DIR_URL}missing.js`, error: 'HTTP 404' }] },
    },
  ])('reports $name it found, with no note, when the page never finishes loading', async ({ record, expected }) => {
    await startHtmlLintRunner(page);
    record();
    await vi.advanceTimersByTimeAsync(HARD_TIMEOUT_MS);

    expect(extractResult(printed())).toEqual({ ...expected, crashed: false, crashDetails: null, emptyPage: false });
    expect(window().webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0);

    finishLoad();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(window().webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(printed().split(RESULT_START)).toHaveLength(2);
  });

  it("ends a run inside anton's budget, with room left for the app's start-up", () => {
    expect(HARD_TIMEOUT_MS).toBeLessThanOrEqual(ANTON_TIMEOUT_MS - 2000);
    /* The longest run: a page that finishes loading just before the limit and never answers its check. */
    expect(HARD_TIMEOUT_MS + SETTLE_MS).toBeLessThanOrEqual(ANTON_TIMEOUT_MS - 1500);
  });
});

describe('startHtmlLintRunner: network policy', () => {
  it.each([
    { name: 'a file of the page, by its scheme', url: `${PAGE_DIR_URL}data.json`, method: 'POST', expected: {} },
    { name: 'a file:// URL', url: 'file:///tmp/data.json', method: 'POST', expected: {} },
    { name: 'a loopback POST', url: 'http://127.0.0.1:8123/api/items', method: 'POST', expected: {} },
    { name: 'a localhost PUT', url: 'http://localhost:8123/api/items/1', method: 'PUT', expected: {} },
    { name: 'an IPv6 loopback POST', url: 'http://[::1]:8123/api/items', method: 'POST', expected: {} },
    { name: 'an external GET', url: 'https://api.example.test/items', method: 'GET', expected: {} },
    { name: 'an external POST, answered as an empty success', url: 'https://api.example.test/items', method: 'POST', expected: { redirectURL: 'data:text/plain,' } },
    { name: 'a URL that does not parse', url: 'not a url', method: 'POST', expected: {} },
  ])('$name', async ({ url, method, expected }) => {
    await startHtmlLintRunner(page);
    const callback = vi.fn();

    window().webContents.session.webRequest.beforeRequest?.({ url, method }, callback);

    expect(callback).toHaveBeenCalledExactlyOnceWith(expected);
  });
});

describe('the lint scheme: files from the target folder only', () => {
  let outside: string;

  beforeEach(() => {
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'html-lint-outside-')));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside the folder');
    fs.mkdirSync(path.join(folder, 'assets'));
    fs.writeFileSync(path.join(folder, 'assets', 'app.js'), 'export const x = 1;');
    fs.writeFileSync(path.join(folder, 'data.json'), '{"name":"lint"}');
    fs.writeFileSync(path.join(folder, 'lib.mjs'), 'export {};');
    fs.writeFileSync(path.join(folder, 'blob.bin'), 'x');
  });

  afterEach(() => {
    fs.rmSync(outside, { recursive: true, force: true });
  });

  async function serve(url: string): Promise<Response> {
    return serveLintFile(folder, new Request(url));
  }

  /* Runs `beforeOpen` when the scheme opens a file, then opens it for real,
   * and counts the closes of the handles it opens. */
  function interceptOpen(beforeOpen: () => void = () => {}): { closes: () => number } {
    const realOpen = fs.promises.open;
    let closes = 0;
    vi.spyOn(fs.promises, 'open').mockImplementation(async (file, flags, mode) => {
      beforeOpen();
      const handle = await realOpen(file, flags, mode);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes += 1;
        await close();
      };
      return handle;
    });
    return { closes: () => closes };
  }

  it.each([
    { file: 'page.html', type: 'text/html' },
    { file: 'assets/app.js', type: 'text/javascript' },
    { file: 'lib.mjs', type: 'text/javascript' },
    { file: 'data.json', type: 'application/json' },
    { file: 'blob.bin', type: 'application/octet-stream' },
  ])('serves $file as $type', async ({ file, type }) => {
    const response = await serve(`${PAGE_DIR_URL}${file}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(type);
    expect(await response.text()).toBe(fs.readFileSync(path.join(folder, file), 'utf-8'));
  });

  it("answers 404 for a root-absolute reference, though the folder holds the file, and serves a sibling's relative one", async () => {
    fs.writeFileSync(path.join(folder, 'app.js'), 'export {};');
    const pageUrl = `${PAGE_DIR_URL}page.html`;

    const rootAbsolute = await serve(new URL('/app.js', pageUrl).href);
    const relative = await serve(new URL('./app.js', pageUrl).href);

    expect(rootAbsolute.status).toBe(404);
    expect(relative.status).toBe(200);
    expect(await relative.text()).toBe('export {};');
  });

  it('serves a link that stays inside the folder', async () => {
    fs.symlinkSync(path.join(folder, 'data.json'), path.join(folder, 'alias.json'));

    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}alias.json`)).toEqual(found(path.join(folder, 'data.json')));
  });

  it("answers 404 for a missing file, for the folder itself and for the origin's root", async () => {
    expect((await serve(`${PAGE_DIR_URL}missing.js`)).status).toBe(404);
    expect((await serve(`${PAGE_DIR_URL}assets`)).status).toBe(404);
    expect((await serve(PAGE_DIR_URL)).status).toBe(404);
    expect((await serve(LINT_ORIGIN_URL)).status).toBe(404);
  });

  it('refuses a link that resolves outside the folder', async () => {
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(folder, 'leak.txt'));
    fs.symlinkSync(outside, path.join(folder, 'linked-dir'));

    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}leak.txt`)).toEqual({ refused: 'outside-folder' });
    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}linked-dir/secret.txt`)).toEqual({ refused: 'outside-folder' });
    expect((await serve(`${PAGE_DIR_URL}leak.txt`)).status).toBe(403);
  });

  it('refuses every name under a linked folder outside, whether it exists there or not, and never lists that folder', async () => {
    fs.symlinkSync(outside, path.join(folder, 'elsewhere'));
    const readdir = vi.spyOn(fs.promises, 'readdir');

    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}elsewhere/secret.txt`)).toEqual({ refused: 'outside-folder' });
    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}elsewhere/missing.txt`)).toEqual({ refused: 'outside-folder' });
    expect(readdir.mock.calls.map(([dir]) => dir)).toEqual([folder, folder]);
  });

  it('refuses a file with a second hard link, as the viewer does', async () => {
    fs.linkSync(path.join(outside, 'secret.txt'), path.join(folder, 'notes.txt'));
    fs.linkSync(path.join(folder, 'data.json'), path.join(folder, 'data-copy.json'));

    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}notes.txt`)).toEqual({ refused: 'not-found' });
    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}data.json`)).toEqual({ refused: 'not-found' });
    const response = await serve(`${PAGE_DIR_URL}notes.txt`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('finds a name in another case or Unicode form only where the disk does, as the viewer does', async () => {
    const decomposed = 'café.json';
    fs.writeFileSync(path.join(folder, decomposed), '{}');
    const diskIgnoresCase = fs.existsSync(path.join(folder, 'ASSETS', 'APP.js'));
    const diskIgnoresForm = fs.existsSync(path.join(folder, 'café.json'));

    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}ASSETS/APP.js`)).toEqual(
      diskIgnoresCase ? found(path.join(folder, 'assets', 'app.js')) : { refused: 'not-found' },
    );
    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}caf%C3%A9.json`)).toEqual(
      diskIgnoresForm ? found(path.join(folder, decomposed)) : { refused: 'not-found' },
    );
  });

  it('refuses an encoded path that climbs out of the folder', async () => {
    const climb = path.relative(folder, path.join(outside, 'secret.txt')).split(path.sep).join('%2F');

    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}${climb}`)).toEqual({ refused: 'outside-folder' });
    expect((await serve(`${PAGE_DIR_URL}${climb}`)).status).toBe(403);
  });

  it('refuses an encoded dot-dot segment even where it would stay inside the folder', async () => {
    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}assets%2F..%2Fdata.json`)).toEqual({ refused: 'outside-folder' });
    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}%2E%2E%2Fdata.json`)).toEqual({ refused: 'outside-folder' });
  });

  it('serves a name that only contains dots, and refuses a name the folder does not list', async () => {
    fs.writeFileSync(path.join(folder, 'a..b.js'), 'x');

    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}a..b.js`)).toEqual(found(path.join(folder, 'a..b.js')));
    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}assets%5C..%5Cdata.json`)).toEqual({ refused: 'not-found' });
  });

  it('builds the path it reads from the folder listing, not from the request', async () => {
    const readdir = vi.spyOn(fs.promises, 'readdir');

    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}assets/app.js`)).toEqual(found(path.join(folder, 'assets', 'app.js')));
    expect(readdir.mock.calls.map(([dir]) => dir)).toEqual([folder, path.join(folder, 'assets')]);
  });

  it("answers 404 for a dot-dot path, which URL parsing clamps out of the page's segment", async () => {
    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}../../data.json`)).toEqual({ refused: 'not-found' });
    expect((await serve(`${PAGE_DIR_URL}../../data.json`)).status).toBe(404);
  });

  it('refuses another host on the scheme', async () => {
    expect(await lookUpLintFile(folder, `${LINT_SCHEME}://elsewhere/data.json`)).toEqual({ refused: 'outside-folder' });
  });

  it('answers 404 for a path that does not decode', async () => {
    expect(await lookUpLintFile(folder, `${PAGE_DIR_URL}%E0%A4%A.json`)).toEqual({ refused: 'not-found' });
  });

  it('throws a disk failure other than a missing path instead of answering 404', async () => {
    const failure = Object.assign(new Error('too many open files'), { code: 'EMFILE' });
    vi.spyOn(fs.promises, 'realpath').mockRejectedValueOnce(failure);

    await expect(lookUpLintFile(folder, `${PAGE_DIR_URL}data.json`)).rejects.toBe(failure);
  });

  it('reads the file from a descriptor opened without following a link, and closes it before it answers', async () => {
    const large = Buffer.alloc(200 * 1024 + 7, 'x');
    fs.writeFileSync(path.join(folder, 'large.bin'), large);
    const readFile = vi.spyOn(fs.promises, 'readFile');
    const opens = interceptOpen();

    const response = await serve(`${PAGE_DIR_URL}large.bin`);
    expect(opens.closes()).toBe(1);
    const body = Buffer.from(await response.arrayBuffer());

    expect(body.equals(large)).toBe(true);
    expect(readFile).not.toHaveBeenCalled();
    expect(fs.promises.open).toHaveBeenCalledExactlyOnceWith(
      path.join(folder, 'large.bin'),
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
  });

  it('refuses a file swapped for a link between its check and its open', async () => {
    const opens = interceptOpen(() => {
      fs.rmSync(path.join(folder, 'data.json'));
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(folder, 'data.json'));
    });

    const response = await serve(`${PAGE_DIR_URL}data.json`);

    /* O_NOFOLLOW refuses the link at the open. Windows has none, so there the
     * open follows it and the device and inode check refuses what it opened. */
    expect(response.status).toBe(process.platform === 'win32' ? 403 : 404);
    expect(await response.text()).toBe('');
    expect(opens.closes()).toBe(process.platform === 'win32' ? 1 : 0);
  });

  it('refuses a file replaced by another between its check and its open, and closes it', async () => {
    fs.writeFileSync(path.join(outside, 'other.json'), 'swapped in');
    const opens = interceptOpen(() => fs.renameSync(path.join(outside, 'other.json'), path.join(folder, 'data.json')));

    const response = await serve(`${PAGE_DIR_URL}data.json`);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('');
    expect(opens.closes()).toBe(1);
  });

  it('refuses a file that gains a second hard link between its check and its open, and closes it', async () => {
    const opens = interceptOpen(() => fs.linkSync(path.join(folder, 'data.json'), path.join(outside, 'data-link.json')));

    const response = await serve(`${PAGE_DIR_URL}data.json`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(opens.closes()).toBe(1);
  });
});
