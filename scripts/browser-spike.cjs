/*
 * The in-app browser's input and capture spike, for one machine.
 *
 * Run it with Electron's own launcher, as `npm run dev` starts the app, and
 * never through Playwright, whose launcher adds --remote-debugging-port:
 *
 *   npm run build:main
 *   npx electron scripts/browser-spike.cjs
 *
 * The host runs only on Electron 44 or later (MIN_IN_APP_BROWSER_ELECTRON_MAJOR),
 * so run it from a checkout or build on a supported Electron.
 *
 * It opens one window with the real host from dist/main on a throwaway
 * profile, and a local fixture page that reports every event it sees. For each
 * window state (focused, behind another app, minimized) and each tab state
 * (shown, parked by the host, hidden with setVisible(false), moved wholly off
 * the window, created parked and never shown), it types into a field three
 * times: through the bridge (the debugger's Input.* commands, as the agent
 * does), with the same commands sent one by one and timed, and with
 * webContents.sendInputEvent. It records what the page saw
 * (isTrusted, keydown/keypress/keyup, screenX against clientX, focus and
 * visibility), whether the main process's before-input-event fired, and what
 * capturePage returns for that tab state. It also records whether the
 * isolated world keeps its globals across calls and navigations, the
 * fingerprint a page reads, and what a page read does while alert() is open.
 *
 * The window opens without focus, so the runs behind another app come first
 * and take nothing from the person at the machine; if the window got focus
 * anyway, the app that was in front (macOS) or a small window from a second
 * process (Windows and Linux) goes in front of it. The minimized runs come
 * next, and the focused runs last, which take focus. Every phase of a run is
 * timed and bounded, so a step that never finishes is recorded, not waited
 * on. The report is JSON, written to BROWSER_SPIKE_REPORT or a temporary
 * file, and printed at the end.
 */

const { app, BrowserWindow, ipcMain, nativeImage, session, webContents } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

if (process.argv.includes('--spike-blocker')) {
  // The other app for "behind another app": a window that takes focus.
  app.whenReady().then(() => {
    const blocker = new BrowserWindow({ width: 420, height: 200, title: 'Spike: another app' });
    blocker.loadURL('data:text/html,<title>Another app</title><p>The spike runs behind this window.</p>');
    blocker.once('ready-to-show', () => {
      blocker.show();
      app.focus({ steal: true });
      blocker.focus();
    });
  });
  process.stdin.on('end', () => app.exit(0));
  process.stdin.resume();
  return;
}

const ROOT = path.resolve(__dirname, '..');
const dist = (file) => path.join(ROOT, 'dist', 'main', file);
const { InAppBrowserHost } = require(dist('main/browser-host.js'));
const { mainWindowWebPreferences } = require(dist('main/main-window-preferences.js'));
const { IPC } = require(dist('shared/ipc-channels.js'));
const { PAGE_WORLD_ID } = require(dist('main/browser-page-script.js'));

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-spike-'));
const REPORT = process.env.BROWSER_SPIKE_REPORT || path.join(PROFILE, 'report.json');
app.setPath('userData', path.join(PROFILE, 'user-data'));

const STAGE = { x: 400, y: 0, width: 800, height: 800 };
const TASK = 't-spike-a';
const OTHER = 't-spike-b';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const progress = (line) => process.stderr.write(`[spike] ${line}\n`);

function bounded(work, ms, what) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// ---- The fixture site ----------------------------------------------------------

const PROBE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Spike probe</title></head>
<body style="margin:0;font:16px sans-serif">
  <div id="block" style="position:absolute;left:0;top:0;width:200px;height:120px;background:rgb(255,0,0)"></div>
  <div style="position:absolute;left:240px;top:40px">
    <label>Name <input id="name" autocomplete="off"></label>
    <button id="go" type="button">Go</button>
  </div>
  <script>
    const tag = new URLSearchParams(location.search).get('tag') || '';
    function report(entry) {
      fetch('/log?tag=' + encodeURIComponent(tag), { method: 'POST', body: JSON.stringify(entry), keepalive: true });
    }
    for (const type of ['mousemove', 'mousedown', 'mouseup', 'click', 'keydown', 'keypress', 'keyup', 'input', 'focus']) {
      document.addEventListener(type, (event) => report({
        type,
        isTrusted: event.isTrusted,
        key: event.key || null,
        target: (event.target && event.target.id) || null,
        screenX: event.screenX, screenY: event.screenY,
        clientX: event.clientX, clientY: event.clientY,
        detail: event.detail,
        windowScreen: [window.screenX, window.screenY],
        hasFocus: document.hasFocus(),
        visibility: document.visibilityState,
        webdriver: navigator.webdriver,
      }), true);
    }
  </script>
</body></html>`;

const logs = new Map();
const requestHeaders = new Map();

function startSite() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const tag = url.searchParams.get('tag') || '';
    if (url.pathname === '/log' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (!logs.has(tag)) logs.set(tag, []);
        logs.get(tag).push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        res.writeHead(204).end();
      });
      return;
    }
    if (url.pathname === '/probe') {
      requestHeaders.set(tag, {
        'user-agent': req.headers['user-agent'],
        'sec-ch-ua': req.headers['sec-ch-ua'],
        'sec-ch-ua-mobile': req.headers['sec-ch-ua-mobile'],
        'sec-ch-ua-platform': req.headers['sec-ch-ua-platform'],
      });
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PROBE);
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// ---- The host -------------------------------------------------------------------

ipcMain.on(IPC.ACCOUNT_SIGNED_IN_SYNC, (event) => {
  event.returnValue = { accountId: null, legacyState: 'keep', organizationId: null };
});

const host = new InAppBrowserHost({
  serverPort: () => 9,
  runningServerPort: () => null,
  authHeader: () => ({}),
  accountRoot: () => path.join(PROFILE, 'account'),
  storesRoot: () => null,
  downloadsDir: () => path.join(PROFILE, 'downloads'),
  profileSession: (dir) => session.fromPath(dir),
  fetch: (input, init) => fetch(input, init),
  electronVersion: () => process.versions.electron,
  userDataDir: () => app.getPath('userData'),
});

function bridge(method, route, body) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request(`${host.bridgeUrl()}${route}`, {
      method,
      headers: { authorization: `Bearer ${host.currentToken()}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const json = () => JSON.parse(buffer.toString('utf-8'));
        resolve({ status: res.statusCode, headers: res.headers, body: buffer, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let win;
let origin;
let frontApp = null;
let blocker = null;
const inputEvents = new Map();

/* The pane's show, sent from the window's main frame as the pane sends it. */
function show(sessionId) {
  return win.webContents.executeJavaScript(`window.antontron.browser.show(${JSON.stringify(sessionId)}, ${JSON.stringify(STAGE)})`);
}

function contentsAt(url) {
  return webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL() === url) || null;
}

function viewOf(contents) {
  return win.contentView.children.find((v) => v.webContents && v.webContents.id === contents.id) || null;
}

function countInput(contents) {
  if (inputEvents.has(contents.id)) return;
  const counts = { key: 0, mouse: 0 };
  inputEvents.set(contents.id, counts);
  contents.on('before-input-event', () => { counts.key += 1; });
  contents.on('before-mouse-event', () => { counts.mouse += 1; });
}

async function openProbe(sessionId, tag) {
  const url = `${origin}/probe?tag=${encodeURIComponent(tag)}`;
  const reply = await bridge('POST', `/sessions/${sessionId}/action`, { action: 'navigate', url });
  if (reply.status !== 200) throw new Error(`navigate answered ${reply.status}: ${reply.body}`);
  for (let i = 0; i < 50 && !contentsAt(url); i += 1) await sleep(100);
  const contents = contentsAt(url);
  if (!contents) throw new Error(`no tab shows ${url}`);
  countInput(contents);
  return contents;
}

const pageState = `({
  hasFocus: document.hasFocus(),
  visibility: document.visibilityState,
  inner: [innerWidth, innerHeight],
  outer: [outerWidth, outerHeight],
  windowScreen: [screenX, screenY],
})`;

// ---- Window states ----------------------------------------------------------------

async function windowState(state) {
  if (state === 'background') {
    if (win.isFocused()) {
      if (process.platform === 'darwin' && frontApp) {
        execFileSync('open', ['-b', frontApp]);
      } else {
        blocker = spawn(process.execPath, [__filename, '--spike-blocker'], { stdio: ['pipe', 'ignore', 'ignore'] });
      }
    }
  } else if (state === 'minimized') {
    win.minimize();
  } else if (state === 'focused') {
    if (win.isMinimized()) win.restore();
    win.show();
    app.focus({ steal: true });
    win.focus();
  }
  await sleep(1500);
  return { focused: win.isFocused(), minimized: win.isMinimized(), visible: win.isVisible() };
}

// ---- Tab states -------------------------------------------------------------------

async function placeTab(state, tag) {
  if (state === 'parked-fresh') {
    await show(OTHER);
    const url = `${origin}/probe?tag=${encodeURIComponent(tag)}`;
    const opened = await bridge('POST', '/sessions', { session_id: `t-spike-${tag}`, url });
    if (opened.status !== 201) throw new Error(`open answered ${opened.status}`);
    for (let i = 0; i < 50 && !(contentsAt(url) && !contentsAt(url).isLoading()); i += 1) await sleep(100);
    const contents = contentsAt(url);
    countInput(contents);
    return { sessionId: `t-spike-${tag}`, contents };
  }
  await show(TASK);
  const contents = await openProbe(TASK, tag);
  const view = viewOf(contents);
  if (state === 'parked') await show(OTHER);
  if (state === 'hidden') view.setVisible(false);
  if (state === 'off-window') view.setBounds({ x: -5000, y: -5000, width: STAGE.width, height: STAGE.height });
  return { sessionId: TASK, contents };
}

// ---- Input paths ------------------------------------------------------------------

async function typeThroughBridge(sessionId) {
  const page = await bridge('GET', `/sessions/${sessionId}/page`);
  if (page.status !== 200) return { status: page.status, error: page.body.toString() };
  const field = page.json().elements.find((e) => e.name === 'Name');
  if (!field) return { status: 0, error: 'no Name field in the page read' };
  const started = Date.now();
  const reply = await bridge('POST', `/sessions/${sessionId}/action`, { action: 'type', element: field.id, text: 'Ab' });
  return { status: reply.status, ms: Date.now() - started, error: reply.status === 200 ? null : reply.body.toString() };
}

async function typeWithSendInputEvent(contents) {
  const box = await contents.executeJavaScript('JSON.parse(JSON.stringify(document.getElementById("name").getBoundingClientRect()))');
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  contents.sendInputEvent({ type: 'mouseMove', x, y });
  contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await sleep(100);
  for (const [keyCode, modifiers] of [['A', ['shift']], ['b', []]]) {
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    contents.sendInputEvent({ type: 'char', keyCode, modifiers });
    await sleep(40);
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(60);
  }
  return { status: 'sent' };
}

/* The agent's commands one at a time, each timed and bounded, to show which
   ones a window state holds up. */
async function typeWithTimedCdp(contents) {
  const dbg = contents.debugger;
  if (dbg.isAttached()) return { error: 'the debugger is already attached' };
  const box = await bounded(contents.executeJavaScript('JSON.parse(JSON.stringify(document.getElementById("name").getBoundingClientRect()))'), 10_000, 'reading the box');
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const commands = {};
  const send = async (name, method, params) => {
    const started = Date.now();
    try {
      await bounded(dbg.sendCommand(method, params), 5_000, name);
      commands[name] = Date.now() - started;
    } catch {
      commands[name] = 'no answer in 5 s';
    }
  };
  const key = (type, k, code, keyCode, modifiers, text) => ({ type, key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers, ...(text ? { text, unmodifiedText: text } : {}) });
  dbg.attach('1.3');
  try {
    await send('focusEmulation', 'Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('mouseMoved', 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse' });
    await send('mousePressed', 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    await send('mouseReleased', 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
    await send('shiftDown', 'Input.dispatchKeyEvent', key('rawKeyDown', 'Shift', 'ShiftLeft', 16, 8));
    await send('keyDownA', 'Input.dispatchKeyEvent', key('keyDown', 'A', 'KeyA', 65, 8, 'A'));
    await send('keyUpA', 'Input.dispatchKeyEvent', key('keyUp', 'A', 'KeyA', 65, 8));
    await send('shiftUp', 'Input.dispatchKeyEvent', key('keyUp', 'Shift', 'ShiftLeft', 16, 0));
    await send('keyDownB', 'Input.dispatchKeyEvent', key('keyDown', 'b', 'KeyB', 66, 0, 'b'));
    await send('keyUpB', 'Input.dispatchKeyEvent', key('keyUp', 'b', 'KeyB', 66, 0));
  } finally {
    if (dbg.isAttached()) dbg.detach();
  }
  return { commands };
}

function summarizeEvents(events, contents) {
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  const down = events.find((e) => e.type === 'mousedown');
  const view = viewOf(contents);
  const content = win.getContentBounds();
  const viewBounds = view ? view.getBounds() : null;
  return {
    counts,
    allTrusted: events.length > 0 && events.every((e) => e.isTrusted),
    untrusted: events.filter((e) => !e.isTrusted).map((e) => e.type),
    keys: events.filter((e) => e.type === 'keydown').map((e) => e.key),
    mousedown: down ? {
      screenMinusClient: [down.screenX - down.clientX, down.screenY - down.clientY],
      windowScreen: down.windowScreen,
      viewOnScreen: viewBounds ? [content.x + viewBounds.x, content.y + viewBounds.y] : null,
      detail: down.detail,
    } : null,
    duringInput: events.length ? { hasFocus: events[events.length - 1].hasFocus, visibility: events[events.length - 1].visibility, webdriver: events[events.length - 1].webdriver } : null,
  };
}

// ---- Captures ---------------------------------------------------------------------

/* The pixel at 50 by 30 CSS pixels, inside the fixture's red block, and
   whether it is red in either byte order. Captures come back in the display's
   color profile, so sRGB red is only mostly red. */
function blockPixel(image, cssWidth) {
  if (image.isEmpty()) return { red: false, pixel: null };
  const { width, height } = image.getSize();
  const scale = width / cssWidth;
  const x = Math.round(50 * scale);
  const y = Math.round(30 * scale);
  if (x >= width || y >= height) return { red: false, pixel: null };
  const bitmap = image.toBitmap();
  const i = (y * width + x) * 4;
  const pixel = [bitmap[i], bitmap[i + 1], bitmap[i + 2], bitmap[i + 3]];
  const [first, green, third] = pixel;
  const redOver = (r, b) => r > 150 && r > 2 * green && r > 2 * b;
  const red = redOver(third, first) || redOver(first, third);
  return { red, pixel };
}

async function capture(contents, sessionId, cssWidth) {
  const direct = await contents.capturePage(undefined, { stayHidden: true }).catch((error) => ({ error: String(error) }));
  const shot = await bridge('GET', `/sessions/${sessionId}/screenshot?format=jpeg&quality=80`);
  const jpeg = shot.status === 200 ? nativeImage.createFromBuffer(shot.body) : null;
  return {
    capturePage: direct.error ? direct : { size: direct.getSize(), empty: direct.isEmpty(), block: blockPixel(direct, cssWidth) },
    bridgeScreenshot: { status: shot.status, size: jpeg ? jpeg.getSize() : null, block: jpeg ? blockPixel(jpeg, cssWidth) : null },
  };
}

// ---- One run ----------------------------------------------------------------------

/* Runs `work` bounded by `ms`, and records how long it took or how it failed. */
async function timed(phases, name, work, ms) {
  const started = Date.now();
  try {
    const value = await bounded(work, ms, name);
    phases[name] = Date.now() - started;
    return value;
  } catch (error) {
    phases[name] = `failed after ${Date.now() - started} ms: ${error.message}`;
    throw error;
  }
}

const INPUT_PATHS = {
  bridge: (sessionId) => typeThroughBridge(sessionId),
  timedCdp: (_sessionId, contents) => typeWithTimedCdp(contents),
  sendInputEvent: (_sessionId, contents) => typeWithSendInputEvent(contents),
};

async function run(windowName, tabState, inputPath) {
  const tag = `${windowName}-${tabState}-${inputPath}`;
  const phases = {};
  const result = { window: windowName, tab: tabState, input: inputPath, phases };
  let placed = null;
  try {
    placed = await timed(phases, 'place', placeTab(tabState, tag), 45_000);
    const { sessionId, contents } = placed;
    await sleep(700);
    result.pageBefore = await timed(phases, 'pageState', contents.executeJavaScript(pageState), 10_000);
    const counter = inputEvents.get(contents.id);
    counter.key = 0;
    counter.mouse = 0;
    logs.set(tag, []);
    result.sent = await timed(phases, 'input', INPUT_PATHS[inputPath](sessionId, contents), 60_000);
    await sleep(900);
    result.value = await timed(phases, 'readValue', contents.executeJavaScript('document.getElementById("name").value'), 10_000);
    result.typed = result.value === 'Ab';
    result.beforeInputEvent = { ...counter };
    if (inputPath === 'bridge') {
      result.capture = await timed(phases, 'capture', capture(contents, sessionId, result.pageBefore.inner[0] || STAGE.width), 30_000);
    }
  } catch (error) {
    result.error = error.message;
  } finally {
    if (placed) {
      result.events = summarizeEvents(logs.get(tag) || [], placed.contents);
      if (placed.sessionId !== TASK) await bounded(bridge('DELETE', `/sessions/${placed.sessionId}`), 10_000, 'closing').catch(() => undefined);
    }
  }
  return result;
}

// ---- Isolated world, fingerprint, dialog -------------------------------------------

async function isolatedWorld() {
  const bump = (contents) => contents.executeJavaScriptInIsolatedWorld(PAGE_WORLD_ID, [{ code: 'globalThis.__spikeCount = (globalThis.__spikeCount || 0) + 1' }]);
  await show(TASK);
  let contents = await openProbe(TASK, 'iso-1');
  const out = {};
  out.firstCall = await bump(contents);
  out.secondCall = await bump(contents);
  out.mainWorldSees = await contents.executeJavaScript('typeof globalThis.__spikeCount');
  const ids = async () => (await bridge('GET', `/sessions/${TASK}/page`)).json().elements.map((e) => `${e.id}:${e.name}`).join(',');
  out.pageIdsRead1 = await ids();
  out.pageIdsRead2 = await ids();
  await contents.executeJavaScript('history.pushState({}, "", location.href + "&pushed=1")');
  out.afterPushState = await bump(contents);
  contents = await openProbe(TASK, 'iso-2');
  out.afterSameOriginNavigation = await bump(contents);
  const crossOrigin = `${origin.replace('127.0.0.1', 'localhost')}/probe?tag=iso-3`;
  await bridge('POST', `/sessions/${TASK}/action`, { action: 'navigate', url: crossOrigin });
  out.afterCrossOriginNavigation = await bump(contents);
  await bridge('POST', `/sessions/${TASK}/action`, { action: 'back' });
  out.afterBack = { url: contents.getURL(), count: await bump(contents) };
  await bridge('POST', `/sessions/${TASK}/action`, { action: 'reload' });
  out.afterReload = await bump(contents);
  out.sandboxedNoPreload = true;
  return out;
}

async function fingerprint() {
  await show(TASK);
  const contents = await openProbe(TASK, 'fingerprint');
  await sleep(300);
  const page = await contents.executeJavaScript(`(async () => ({
    userAgent: navigator.userAgent,
    brands: navigator.userAgentData ? navigator.userAgentData.brands : null,
    platform: navigator.userAgentData ? navigator.userAgentData.platform : null,
    fullVersionList: navigator.userAgentData ? (await navigator.userAgentData.getHighEntropyValues(['fullVersionList'])).fullVersionList : null,
    webdriver: navigator.webdriver,
    chromeKeys: typeof window.chrome === 'object' && window.chrome ? Object.keys(window.chrome) : null,
    plugins: navigator.plugins.length,
    pdfViewerEnabled: navigator.pdfViewerEnabled,
    languages: navigator.languages,
    outer: [outerWidth, outerHeight],
    inner: [innerWidth, innerHeight],
    screen: [screen.width, screen.height],
    devicePixelRatio,
    hasFocus: document.hasFocus(),
  }))()`);
  return { page, requestHeaders: requestHeaders.get('fingerprint') };
}

async function dialog() {
  await show(TASK);
  const contents = await openProbe(TASK, 'dialog');
  contents.executeJavaScript('setTimeout(() => alert("spike"), 10)');
  await sleep(500);
  const started = Date.now();
  const read = await bridge('GET', `/sessions/${TASK}/page`);
  return { pageReadStatus: read.status, error: read.status === 200 ? null : read.json().error, ms: Date.now() - started };
}

// ---- Main -------------------------------------------------------------------------

async function main() {
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('lsappinfo', ['info', '-only', 'bundleid', execFileSync('lsappinfo', ['front']).toString().trim()]).toString();
      frontApp = (out.match(/bundleID="([^"]+)"/) || [])[1] || 'com.apple.finder';
    } catch {
      frontApp = 'com.apple.finder';
    }
  }
  const port = await startSite();
  origin = `http://127.0.0.1:${port}`;
  host.registerIpc(ipcMain);
  await host.start();
  win = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: mainWindowWebPreferences(9) });
  host.attachWindow(win);
  await win.loadFile(path.join(ROOT, 'e2e', 'helpers', 'in-app-browser-shell.html'));
  win.showInactive();
  const report = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${os.release()} ${process.arch}`,
    launchedWith: process.argv.slice(1).filter((a) => !a.endsWith('browser-spike.cjs')),
    runs: [],
  };
  await bridge('POST', '/sessions', { session_id: TASK, url: 'about:blank' });
  await bridge('POST', '/sessions', { session_id: OTHER, url: 'about:blank' });

  const save = () => fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  report.windowStates = {};
  progress('window: background');
  report.windowStates.background = await windowState('background');
  progress('fingerprint');
  report.fingerprint = await bounded(fingerprint(), 30_000, 'the fingerprint').catch((error) => ({ error: String(error) }));
  save();
  progress('isolated world');
  report.isolatedWorld = await bounded(isolatedWorld(), 60_000, 'the isolated-world check').catch((error) => ({ error: String(error) }));
  save();

  const tabs = ['shown', 'parked', 'hidden', 'off-window', 'parked-fresh'];
  for (const windowName of ['background', 'minimized', 'focused']) {
    if (windowName !== 'background') {
      progress(`window: ${windowName}`);
      report.windowStates[windowName] = await windowState(windowName);
    }
    for (const tab of tabs) {
      for (const input of Object.keys(INPUT_PATHS)) {
        progress(`run ${windowName} ${tab} ${input}`);
        report.runs.push(await run(windowName, tab, input));
        save();
      }
    }
    report.windowStates[`${windowName}AtEnd`] = { focused: win.isFocused(), minimized: win.isMinimized(), visible: win.isVisible() };
  }
  progress('dialog');
  report.dialog = await bounded(dialog(), 30_000, 'the dialog check').catch((error) => ({ error: String(error) }));
  save();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nreport: ${REPORT}\n`);
}

app.whenReady().then(main).catch((error) => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
}).finally(async () => {
  if (blocker) blocker.stdin.end();
  if (process.platform === 'darwin' && frontApp) {
    try {
      execFileSync('open', ['-b', frontApp]);
    } catch {
      // Giving focus back is a courtesy.
    }
  }
  // A tab with a dialog open may not close quickly; the report is already written.
  await bounded(host.stop(), 5_000, 'closing the host').catch(() => undefined);
  app.exit(process.exitCode || 0);
});
