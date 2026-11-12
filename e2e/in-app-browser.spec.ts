import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { electronHostsInAppBrowser } from '../src/shared/browser-contract';

/*
 * The in-app browser through its real bridge, in real Electron: the host from
 * dist/main (helpers/in-app-browser-app.cjs) drives a WebContentsView on a
 * throwaway profile, and a fixture server records what the page saw. This
 * shows that the agent's input reaches pages as trusted events, that page
 * reads run, that only the person hands control back, and that popups and
 * sign-ins behave. It makes no bot-detection claims: Playwright's Electron
 * launcher adds --remote-debugging-port=0, so those checks belong to a plain
 * launch of a packaged build.
 */

interface LogEntry {
  type: string;
  isTrusted?: boolean;
  key?: string | null;
  target?: string | null;
  value?: unknown;
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json: () => any;
}

const FIXTURE = fs.readFileSync(path.resolve('e2e/helpers/in-app-browser-fixture.html'));
const SESSION = 't-e2e0123456789abcdef0123';

let server: http.Server;
let origin: string;
let log: LogEntry[] = [];
let profile: string;
let app: ElectronApplication;
let shell: Page;
let bridge: { url: string; token: string };

async function startFixtureServer(): Promise<void> {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/log' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        log.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        res.writeHead(204).end();
      });
      return;
    }
    if (url.pathname === '/form') return void res.writeHead(200, { 'content-type': 'text/html' }).end(FIXTURE);
    if (url.pathname === '/popup') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Popup</title><p id="o"></p><script>document.getElementById("o").textContent = window.opener ? "has opener" : "no opener"</script>');
    }
    if (url.pathname === '/features') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Features</title><p id="o"></p><script>document.getElementById("o").textContent = "SharedWorker: " + typeof SharedWorker</script>');
    }
    if (url.pathname === '/autopop') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Auto</title><script>setTimeout(() => window.open("/popup", "_blank"), 1500)</script>');
    }
    if (url.pathname === '/set-cookie') {
      return void res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'e2e=kept; Max-Age=3600; Path=/' }).end('<title>Set</title>set');
    }
    if (url.pathname === '/long') {
      /* 150 lines 30 px apart, about 6,000 characters: more than a page
         read's default 3,000. */
      const lines = Array.from({ length: 150 }, (_, i) => `<p>Line ${i + 1} of the long page says hello.</p>`).join('');
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Long</title><style>body{margin:0;font:16px sans-serif}p{margin:0;height:30px;line-height:30px}</style>${lines}`);
    }
    if (url.pathname === '/many') {
      /* 20,000 rows of about 125 characters, each with a button: about
         2.5 MB of text and 20,000 controls, scrolled to the middle. */
      const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.';
      const rows = Array.from({ length: 20_000 }, (_, i) => `<div><p>Row ${i} ${filler}</p><button>Action ${i}</button></div>`).join('');
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Many</title>${rows}<script>scrollTo(0, document.documentElement.scrollHeight / 2)</script>`);
    }
    if (url.pathname === '/late') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Late</title><button onclick="fetch(\'/slow\').then((r) => r.text()).then((t) => { const p = document.createElement(\'p\'); p.textContent = t; document.body.append(p); })">Load</button>');
    }
    if (url.pathname === '/slow') {
      setTimeout(() => res.writeHead(200, { 'content-type': 'text/plain' }).end('Arrived late'), 2_500);
      return;
    }
    if (url.pathname === '/still') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Still</title><button>Nothing</button><button onclick="document.getElementById(\'o\').textContent = \'Changed\'">Change</button><p id="o">Before</p>');
    }
    if (url.pathname === '/frames') {
      /* One frame from this origin, and the same page from another one:
         localhost is another origin than 127.0.0.1. */
      const other = origin.replace('127.0.0.1', 'localhost');
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Frames</title><p>Top text</p><iframe src="/frame-inner" style="width:400px;height:200px"></iframe><iframe src="${other}/frame-inner" style="width:400px;height:200px"></iframe>`);
    }
    if (url.pathname === '/unseen-frames') {
      /* Same-origin frames in view, in DOM order: two the person sees (one
         tinted grey), then one under a box, a faint one, a masked one, a
         darkened one, a blurred one and one inside a box that inverts and
         darkens it, then one below the view. */
      const styles = ['', 'filter:grayscale(1)', '', 'opacity:0.05', 'mask-image:linear-gradient(transparent,transparent)', 'filter:brightness(0)', 'filter:blur(40px)', ''];
      const at = (i: number) => `position:absolute;left:${(i % 4) * 200}px;top:${Math.floor(i / 4) * 130}px;width:200px;height:120px;border:0;margin:0`;
      const frames = styles.map((style, i) => (i === 7
        ? `<div style="${at(i)};filter:invert(1) brightness(0)"><iframe src="/frame-inner" style="width:200px;height:120px;border:0"></iframe></div>`
        : `<iframe src="/frame-inner" style="${at(i)};${style}"></iframe>`)).join('');
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Unseen</title><style>body{margin:0}</style>${frames}<div style="${at(2)};background:#fff"></div>`
          + '<iframe src="/frame-inner" style="position:absolute;left:0;top:3000px;width:200px;height:120px;border:0"></iframe>');
    }
    if (url.pathname === '/hidden-frame') {
      /* One same-origin frame, 300 by 150 at (50, 50), alone on its page,
         drawn as `case` says: plain; in a page a dark mode inverts; slightly
         dimmed; under a white cover that only paints (a 1 px element's box
         shadow or outline), which a hit test can't see; under a white cover
         with a 3 px hole at the middle of each cell of a 5 by 5 grid over it;
         or through a mask border. */
      const frame = (style = '') => `<iframe src="/frame-inner" style="position:absolute;left:50px;top:50px;width:300px;height:150px;border:0;${style}"></iframe>`;
      const dot = (paint: string) => `<div style="position:absolute;left:200px;top:125px;width:1px;height:1px;z-index:2;${paint}"></div>`;
      const holes = [0.1, 0.3, 0.5, 0.7, 0.9].flatMap((fy) => [0.1, 0.3, 0.5, 0.7, 0.9].map((fx) => `M${Math.floor(300 * fx) - 1} ${Math.floor(150 * fy) - 1}h3v3h-3z`)).join('');
      const pages: Record<string, string> = {
        plain: frame(),
        dark: `<div style="filter:invert(1) hue-rotate(180deg);background:#fff;position:absolute;inset:0">${frame()}</div>`,
        dimmed: frame('filter:brightness(0.85)'),
        shadow: frame() + dot('box-shadow:0 0 0 400px #fff'),
        outline: frame() + dot('outline:400px solid #fff'),
        holes: frame() + `<div style="position:absolute;left:50px;top:50px;width:300px;height:150px;z-index:2;background:#fff;clip-path:path(evenodd,'M0 0H300V150H0Z${holes}')"></div>`,
        'mask-border': frame('-webkit-mask-box-image-source:linear-gradient(transparent,transparent);-webkit-mask-box-image-slice:1 fill'),
      };
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Hidden frame</title><style>body{margin:0;background:#fff}</style>${pages[url.searchParams.get('case') ?? 'plain']}`);
    }
    if (url.pathname === '/css-editor') {
      /* A same-origin frame whose draft CSS alone makes editable. */
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Editor</title><p>Top</p><iframe src="/css-editor-inner" style="width:400px;height:200px;border:0"></iframe>');
    }
    if (url.pathname === '/shadow-editor') {
      /* A same-origin frame whose drafts sit in a widget's open shadow root:
         one CSS alone makes editable, one an attribute does. */
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Shadow editor</title><p>Top</p><iframe src="/shadow-editor-inner" style="width:400px;height:200px;border:0"></iframe>');
    }
    if (url.pathname === '/shadow-editor-inner') {
      const drafts = '<div tabindex="0">To: <div style="-webkit-user-modify:read-write;min-height:20px">CSS-DRAFT typed by the person</div></div>'
        + '<div tabindex="0">Cc: <div contenteditable style="min-height:20px">ATTR-DRAFT typed by the person</div></div>';
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Inner</title><p>Compose</p><x-compose id="c"></x-compose><button>Send</button><script>document.getElementById("c").attachShadow({ mode: "open" }).innerHTML = ${JSON.stringify(drafts)}</script>`);
    }
    if (url.pathname === '/css-editor-inner') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Inner</title><p>Compose</p><div tabindex="0">To: <div style="-webkit-user-modify:read-write;min-height:40px">CSS-DRAFT typed by the person</div></div><button>Send</button>');
    }
    if (url.pathname === '/frame-inner') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Inner</title><p>Get the weekly digest.</p><label>Email <input value="ada@example.test"></label><button>Subscribe</button>');
    }
    if (url.pathname === '/buy') {
      /* Another site's page that records every click it gets, as a one-click
         Buy would act on it. */
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Buy</title><style>html,body{margin:0;height:100%}button{width:100%;height:100%}</style><button>Buy now</button>'
          + '<script>addEventListener("click", (e) => fetch("/log", { method: "POST", body: JSON.stringify({ type: "frame-click", isTrusted: e.isTrusted }) }))</script>');
    }
    if (url.pathname === '/wrapped-frame') {
      /* Another site's frame inside a control that is listed with a number,
         and the same page behind an object and an embed that name themselves
         as controls. */
      const buy = `${origin.replace('127.0.0.1', 'localhost')}/buy`;
      const box = 'display:block;width:400px;height:120px;border:0;margin:0';
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Wrapped</title><div tabindex="0" aria-label="More info" style="${box}"><iframe src="${buy}" style="${box}"></iframe></div>`
          + `<object data="${buy}" type="text/html" role="button" aria-label="Dismiss" style="${box}"></object>`
          + `<embed src="${buy}" type="text/html" tabindex="0" title="Close" style="${box}">`);
    }
    if (url.pathname === '/sealed-frame') {
      /* Another site's frame in a closed shadow root of a control that is
         listed with a number: the page's DOM can't place it. */
      const buy = `${origin.replace('127.0.0.1', 'localhost')}/buy`;
      const box = 'display:block;width:400px;height:120px;border:0;margin:0';
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Sealed</title><div id="w" tabindex="0" aria-label="More info" style="${box}"></div>`
          + `<script>document.getElementById("w").attachShadow({ mode: "closed" }).innerHTML = '<iframe src="${buy}" style="${box}"></iframe>'</script>`);
    }
    if (url.pathname === '/sealed-slot-frame') {
      /* A control that slots its own text, which fills it, over another
         site's frame laid in its closed shadow root: the page's own hit test
         stops at the control and finds its text at every point. */
      const buy = `${origin.replace('127.0.0.1', 'localhost')}/buy`;
      const sealed = `<style>iframe{position:absolute;left:0;top:0;width:100%;height:100%;border:0}</style><slot></slot><iframe src="${buy}"></iframe>`;
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Sealed slot</title><x-btn id="w" role="button" style="display:block;position:relative;width:400px;height:120px;margin:0;overflow:hidden;font:100px/120px sans-serif">Continue</x-btn>'
          + `<script>document.getElementById("w").attachShadow({ mode: "closed" }).innerHTML = ${JSON.stringify(sealed)}</script>`);
    }
    if (url.pathname === '/frame-fields') {
      /* Another site's embedded form, with an ordinary field and a password
         field the person has filled. */
      const fields = `${origin.replace('127.0.0.1', 'localhost')}/fields`;
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Frame fields</title><style>body{margin:0}</style><iframe src="${fields}" style="position:absolute;left:0;top:0;width:400px;height:200px;border:0"></iframe>`);
    }
    if (url.pathname === '/fields') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Fields</title><style>body{margin:0;background:#fff}input{position:absolute;left:0;width:300px;height:40px;border:0;background:#fff;font:20px sans-serif}</style>'
          + '<input id="u" style="top:0"><input id="p" type="password" value="hunter2" style="top:100px">'
          + '<script>addEventListener("keydown", (e) => fetch("/log", { method: "POST", body: JSON.stringify({ type: "frame-key", key: e.key, target: e.target.id, isTrusted: e.isTrusted }) }))</script>');
    }
    if (url.pathname === '/closed-fields') {
      /* A form the page keeps in a closed shadow root, with an ordinary
         field and a password field the person has filled. */
      const form = '<style>input{position:absolute;left:0;width:300px;height:40px;border:0;font:20px sans-serif}</style>'
        + '<input id="u" style="top:0"><input id="p" type="password" value="hunter2" style="top:100px">';
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Closed fields</title><style>body{margin:0}</style><x-login id="host" style="display:block;position:absolute;left:0;top:0;width:400px;height:200px"></x-login>'
          + `<script>const root = document.getElementById("host").attachShadow({ mode: "closed" }); root.innerHTML = ${JSON.stringify(form)};`
          + 'root.addEventListener("keydown", (e) => fetch("/log", { method: "POST", body: JSON.stringify({ type: "closed-key", key: e.key, target: e.target.id, isTrusted: e.isTrusted }) }));</script>');
    }
    if (url.pathname === '/closed-frame-fields') {
      /* Another site's embedded form in a closed shadow root. */
      const fields = `${origin.replace('127.0.0.1', 'localhost')}/fields`;
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Closed frame fields</title><style>body{margin:0}</style><div id="host" style="position:absolute;left:0;top:0;width:400px;height:200px"></div>'
          + `<script>document.getElementById("host").attachShadow({ mode: "closed" }).innerHTML = '<iframe src="${fields}" style="position:absolute;left:0;top:0;width:400px;height:200px;border:0"></iframe>'</script>`);
    }
    if (url.pathname === '/card') {
      /* A checkout form whose card number shows in clear, from (100, 40) to
         (290, 80), grey on light grey, so only a mask draws black there. */
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Card</title><style>body{margin:0;background:#fff}input{position:absolute;left:100px;top:40px;width:190px;height:40px;border:0;padding:0;background:#ddd;font:bold 18px monospace;color:#777}</style>'
          + '<input autocomplete="cc-number" value="4242424242424242">');
    }
    if (url.pathname === '/scaled-card') {
      /* Another site's checkout frame, 300 by 100, drawn at twice its size. */
      const card = `${origin.replace('127.0.0.1', 'localhost')}/card`;
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Scaled card</title><style>body{margin:0;background:#fff}</style>'
          + `<iframe src="${card}" style="position:absolute;left:0;top:0;width:300px;height:100px;border:0;transform:scale(2);transform-origin:0 0"></iframe>`);
    }
    if (url.pathname === '/half-card') {
      /* Another site's checkout frame, 300 by 100, drawn at half its size. */
      const card = `${origin.replace('127.0.0.1', 'localhost')}/card`;
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Half card</title><style>body{margin:0;background:#fff}</style>'
          + `<iframe src="${card}" style="position:absolute;left:0;top:0;width:300px;height:100px;border:0;transform:scale(0.5);transform-origin:0 0"></iframe>`);
    }
    if (url.pathname === '/scaled-same-card') {
      /* The page's own checkout frame, 300 by 100, drawn at `scale` times its size. */
      const scale = Number(url.searchParams.get('scale'));
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Scaled same card</title><style>body{margin:0;background:#fff}</style>'
          + `<iframe src="/card" style="position:absolute;left:0;top:0;width:300px;height:100px;border:0;transform:scale(${scale});transform-origin:0 0"></iframe>`);
    }
    if (url.pathname === '/along-same-card') {
      /* The page's own checkout frame, 300 by 100, turned 30 degrees by an
         offset path, its transform, rotate and scale all none: drawn inside
         (95, 32) to (405, 268), its card number from (206, 136) to (362, 226). */
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Along same card</title><style>body{margin:0;background:#fff}</style>'
          + '<iframe src="/card" style="position:absolute;left:0;top:0;width:300px;height:100px;border:0;offset-path:path(\'M 250 150 L 400 150\');offset-rotate:30deg"></iframe>');
    }
    if (url.pathname === '/reflected-card') {
      /* Three card numbers -webkit-box-reflect copies: the page's own field,
         from (0, 0) to (190, 40), copied 20 px below it; the page's own
         checkout frame at (300, 0) and another site's at (0, 250), 300 by
         100, each copied 10 px below it. */
      const card = `${origin.replace('127.0.0.1', 'localhost')}/card`;
      const frame = 'position:absolute;width:300px;height:100px;border:0;-webkit-box-reflect:below 10px';
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Reflected card</title><style>body{margin:0;background:#fff}input{display:block;margin:0;width:190px;height:40px;border:0;padding:0;background:#ddd;font:bold 18px monospace;color:#777}</style>'
          + '<div style="position:absolute;left:0;top:0;-webkit-box-reflect:below 20px"><input autocomplete="cc-number" value="4242424242424242"></div>'
          + `<iframe src="/card" style="${frame};left:300px;top:0"></iframe><iframe src="${card}" style="${frame};left:0;top:250px"></iframe>`);
    }
    if (url.pathname === '/closed-same-card') {
      /* The page's own checkout frame, in a closed shadow root. */
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Closed same card</title><style>body{margin:0;background:#fff}</style><div id="host" style="position:absolute;left:0;top:0;width:300px;height:100px"></div>'
          + '<script>document.getElementById("host").attachShadow({ mode: "closed" }).innerHTML = \'<iframe src="/card" style="position:absolute;left:0;top:0;width:300px;height:100px;border:0"></iframe>\'</script>');
    }
    if (url.pathname === '/clear-frame') {
      /* Another site's frame drawn fully transparent over a button. */
      const buy = `${origin.replace('127.0.0.1', 'localhost')}/buy`;
      const at = 'position:absolute;left:0;top:0;width:300px;height:100px;border:0;margin:0';
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end(`<title>Clear</title><button style="${at}">Under</button><iframe src="${buy}" style="${at};opacity:0"></iframe>`);
    }
    if (url.pathname === '/moving-frame') {
      /* Another site's frame that slides over the button once the pointer
         moves on the page. */
      const buy = `${origin.replace('127.0.0.1', 'localhost')}/buy`;
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Moving</title><style>body{margin:0}</style>'
          + '<button onclick="document.title = \'clicked\'" style="position:absolute;left:0;top:200px;width:300px;height:100px">Go</button>'
          + `<iframe id="f" src="${buy}" style="position:absolute;left:600px;top:0;width:300px;height:100px;border:0"></iframe>`
          + '<script>addEventListener("pointermove", () => { const f = document.getElementById("f"); f.style.left = "0px"; f.style.top = "200px"; }, { once: true })</script>');
    }
    if (url.pathname === '/swap-frame') {
      /* Another site's player frame under the point, and its Buy frame,
         which slides over the player once the pointer moves on the page. */
      const other = origin.replace('127.0.0.1', 'localhost');
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Swap</title><style>body{margin:0}</style>'
          + `<iframe src="${other}/player" style="position:absolute;left:0;top:0;width:300px;height:100px;border:0"></iframe>`
          + `<iframe id="f" src="${other}/buy" style="position:absolute;left:600px;top:300px;width:300px;height:100px;border:0;z-index:5"></iframe>`
          + '<script>addEventListener("pointermove", () => { const f = document.getElementById("f"); f.style.left = "0px"; f.style.top = "0px"; }, { once: true })</script>');
    }
    if (url.pathname === '/player') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Player</title><style>html,body{margin:0;height:100%}button{width:100%;height:100%}</style><button>Play video</button>'
          + '<script>addEventListener("click", (e) => fetch("/log", { method: "POST", body: JSON.stringify({ type: "player-click", isTrusted: e.isTrusted }) }))</script>');
    }
    if (url.pathname === '/covered') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Covered</title><button onclick="document.title = \'clicked\'">Under</button><div style="position:fixed;inset:0;background:rgba(0,0,0,0.3)">Cookie banner</div>');
    }
    if (url.pathname === '/echo-cookie') {
      const cookie = (req.headers.cookie ?? '').replace(/[<>&]/g, '');
      return void res.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Echo</title><p>cookie:[${cookie}]</p>`);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function launch(): Promise<void> {
  const { ELECTRON_RUN_AS_NODE: _dropped, ...env } = process.env;
  app = await electron.launch({
    args: [path.resolve('e2e/helpers/in-app-browser-app.cjs')],
    env: { ...(env as Record<string, string>), IN_APP_BROWSER_PROFILE: profile },
  });
  shell = await app.firstWindow();
  await expect.poll(() => app.evaluate(() => (globalThis as any).inAppBrowserE2e ?? null)).not.toBeNull();
  bridge = await app.evaluate(() => (globalThis as any).inAppBrowserE2e);
}

function call(method: string, route: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request(`${bridge.url}${route}`, {
      method,
      headers: { authorization: `Bearer ${bridge.token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buffer, json: () => JSON.parse(buffer.toString('utf-8')) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function page(): Promise<any> {
  const reply = await call('GET', `/sessions/${SESSION}/page`);
  expect(reply.status, reply.body.toString()).toBe(200);
  return reply.json();
}

async function act(step: Record<string, unknown>): Promise<Reply> {
  return call('POST', `/sessions/${SESSION}/action`, step);
}

async function element(name: string): Promise<number> {
  const found = (await page()).elements.find((e: { name: string }) => e.name === name);
  expect(found, `no element named ${name}`).toBeTruthy();
  return found.id;
}

/* Marks the /form page's own window from main, so a reload, which drops the
   mark, shows. */
async function markPage(): Promise<void> {
  await app.evaluate(({ webContents }, at) => webContents.getAllWebContents().find((contents) => contents.getURL() === at)?.executeJavaScript('window.inAppBrowserE2eMark = "kept"'), `${origin}/form`);
  expect(await pageMark()).toBe('kept');
}

/* The /form page's mark, or null once the page reloaded. */
async function pageMark(): Promise<string | null> {
  return app.evaluate(({ webContents }, at) => webContents.getAllWebContents().find((contents) => contents.getURL() === at)?.executeJavaScript('window.inAppBrowserE2eMark ?? null') ?? 'no page', `${origin}/form`);
}

/* Whether each of `points`, in the page's CSS pixels, is black in a
   screenshot of the page at `route`, as a mask draws it. */
async function blackIn(route: string, points: number[][]): Promise<boolean[]> {
  const shot = await call('GET', `/sessions/${SESSION}/screenshot?quality=95`);
  expect(shot.status, shot.body.toString()).toBe(200);
  const width: number = await app.evaluate(({ webContents }, at) => webContents.getAllWebContents().find((contents) => contents.getURL() === at)?.executeJavaScript('innerWidth'), `${origin}${route}`);
  const scale = Number(shot.headers['x-image-width']) / width;
  const pixels: number[][] = await app.evaluate(({ nativeImage }, { jpeg, at }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(jpeg, 'base64'));
    const { width: imageWidth } = image.getSize();
    const bitmap = image.toBitmap();
    return at.map(([x, y]) => [...bitmap.subarray((y * imageWidth + x) * 4, (y * imageWidth + x) * 4 + 3)]);
  }, { jpeg: shot.body.toString('base64'), at: points.map(([x, y]) => [Math.round(x * scale), Math.round(y * scale)]) });
  return pixels.map((rgb) => rgb.every((channel) => channel < 40));
}

async function openAt(route: string): Promise<void> {
  expect((await act({ action: 'navigate', url: `${origin}${route}` })).status).toBe(200);
  await expect.poll(async () => (await page()).url).toBe(`${origin}${route}`);
}

test.describe.configure({ mode: 'serial' });

/* The host refuses to run below its Electron floor (electronHostsInAppBrowser
   in src/shared/browser-contract.ts), so on an older Electron there is nothing
   to drive. Raise the floor with Electron's support window; never lower it to
   make this spec run. */
const ELECTRON_VERSION: string = JSON.parse(fs.readFileSync(path.resolve('node_modules/electron/package.json'), 'utf-8')).version;
test.skip(!electronHostsInAppBrowser(ELECTRON_VERSION), `the in-app browser doesn't run on this checkout's Electron ${ELECTRON_VERSION}`);

test.beforeAll(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'in-app-browser-e2e-'));
  await startFixtureServer();
  await launch();
  const opened = await call('POST', '/sessions', { session_id: SESSION, url: `${origin}/form` });
  expect(opened.status).toBe(201);
  await expect.poll(async () => (await page()).elements.length, { timeout: 15_000 }).toBeGreaterThan(3);
  await expect.poll(async () => (await page()).scroll.viewport, { timeout: 5_000 }).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  fs.rmSync(profile, { recursive: true, force: true });
});

test.beforeEach(() => {
  log = [];
});

test('reads the page from an isolated world, hiding the password', async () => {
  const snapshot = await page();
  expect(snapshot.scroll.viewport).toBeGreaterThan(0);
  const password = snapshot.elements.find((e: { name: string }) => e.name === 'Password');
  expect(password).toMatchObject({ role: 'textbox', type: 'password', value_hidden: true });
  expect(JSON.stringify(snapshot)).not.toContain('hunter2');
  expect(snapshot.challenges).toEqual([]);
});

test('clicks and double-clicks with trusted events', async () => {
  const go = await element('Go');
  const first = await act({ action: 'click', element: go });
  expect(first.status, first.body.toString()).toBe(200);
  await expect.poll(() => log.filter((e) => e.type === 'click' && e.target === 'go')).toHaveLength(1);
  expect(log.filter((e) => e.target === 'go').every((e) => e.isTrusted)).toBe(true);
  log = [];
  expect((await act({ action: 'click', element: go, clicks: 2 })).status).toBe(200);
  await expect.poll(() => log.some((e) => e.type === 'dblclick' && e.isTrusted)).toBe(true);
});

test('types key by key into a field, and refuses the password field', async () => {
  const name = await element('Name');
  expect((await act({ action: 'type', element: name, text: 'Ada' })).status).toBe(200);
  // Shift is held for the capital, as a person types it.
  await expect.poll(() => log.filter((e) => e.type === 'keydown' && e.target === 'name').map((e) => e.key)).toEqual(['Shift', 'A', 'd', 'a']);
  expect(log.filter((e) => e.target === 'name').every((e) => e.isTrusted)).toBe(true);
  const snapshot = await page();
  expect(snapshot.elements.find((e: { name: string }) => e.name === 'Name').value).toBe('Ada');

  log = [];
  const refused = await act({ action: 'type', element: await element('Password'), text: 'x' });
  expect(refused.status).toBe(403);
  expect(refused.json().error).toBe('password_field');
  expect(log.filter((e) => e.type === 'keydown')).toEqual([]);
});

test('selects an option, presses Enter, and scrolls with the wheel', async () => {
  expect((await act({ action: 'select', element: await element('Color'), value: 'Blue' })).status).toBe(200);
  expect((await page()).elements.find((e: { name: string }) => e.name === 'Color').value).toBe('Blue');
  expect((await act({ action: 'press', element: await element('Name'), key: 'Enter' })).status).toBe(200);
  await expect.poll(() => log.some((e) => e.type === 'keydown' && e.key === 'Enter' && e.isTrusted)).toBe(true);
  expect((await act({ action: 'scroll', direction: 'down', amount: 600 })).status).toBe(200);
  await expect.poll(async () => (await page()).scroll.y).toBeGreaterThan(0);
  expect(log.some((e) => e.type === 'wheel' && e.isTrusted)).toBe(true);
});

test('scrolls an element into view before clicking it', async () => {
  const far = await element('Far away');
  expect((await act({ action: 'click', element: far })).status).toBe(200);
  await expect.poll(() => log.some((e) => e.type === 'click' && e.target === 'far' && e.isTrusted)).toBe(true);
});

test('reads the text the person sees once the page is scrolled past what a read holds', async () => {
  await openAt('/long');
  expect((await page()).text.startsWith('Line 1 of the long page')).toBe(true);
  expect((await act({ action: 'scroll', direction: 'down', amount: 3600 })).status).toBe(200);
  await expect.poll(async () => (await page()).scroll.y).toBeGreaterThan(3000);
  const read = await page();
  // Lines are 30 px tall, so the first line in view is the one the scroll reached.
  const top = Math.floor(read.scroll.y / 30) + 1;
  expect(read.text.startsWith(`… Line ${top} of the long page`), read.text.slice(0, 80)).toBe(true);
  expect(read.text).toContain(`Line ${top + 5} of the long page`);
  expect(read.text).toContain('… (above the view) Line 1 of the long page');
});

test('reads a page of 20,000 controls and 2.5 MB of text scrolled to the middle well inside the read timeout, with what is in view first', async () => {
  await openAt('/many');
  await expect.poll(async () => (await page()).scroll.y, { timeout: 10_000 }).toBeGreaterThan(100_000);
  const started = Date.now();
  const read = await page();
  const took = Date.now() - started;
  const middle = Number(/^… Row (\d+) /.exec(read.text)?.[1]);
  expect(middle, read.text.slice(0, 80)).toBeGreaterThan(9_000);
  expect(read.elements).toHaveLength(300);
  expect(read.truncated).toBe(true);
  // The buttons in view come first, from the rows the text starts at.
  expect(read.elements[0]).toMatchObject({ role: 'button', name: `Action ${middle}` });
  expect(read.elements[0].offscreen).toBeUndefined();
  // About 0.1 s here, where a walk of every text node takes 1.5 s.
  expect(took, `the read took ${took} ms`).toBeLessThan(1_000);
});

test("a click's answer carries what a request it started brings 2.5 s later", async () => {
  await openAt('/late');
  const load = await element('Load');
  const started = Date.now();
  const reply = await act({ action: 'click', element: load, include_page: true });
  expect(reply.status, reply.body.toString()).toBe(200);
  const answer = reply.json();
  expect(answer.page.text).toContain('Arrived late');
  expect(answer.changed).toBe(true);
  expect(Date.now() - started).toBeLessThan(4_500);
});

test('says whether a step changed what the page shows', async () => {
  await openAt('/still');
  const nothing = await act({ action: 'click', element: await element('Nothing') });
  expect(nothing.json()).toMatchObject({ ok: true, changed: false });
  const change = await act({ action: 'click', element: await element('Change') });
  expect(change.json()).toMatchObject({ ok: true, changed: true });
  expect((await act({ action: 'wait', ms: 10 })).json()).toMatchObject({ ok: true, changed: null });
});

test('reads a same-origin frame, lists one from another site unread, and lists no frame as an element', async () => {
  await openAt('/frames');
  await expect.poll(async () => (await page()).frames.map((f: { read: boolean }) => f.read), { timeout: 10_000 }).toEqual([true, false]);
  const snapshot = await page();
  expect(snapshot.elements).toEqual([]);
  const [same, other] = snapshot.frames;
  expect(same).toMatchObject({ url: `${origin}/frame-inner`, read: true, truncated: false });
  expect(same.text).toContain('Get the weekly digest.');
  expect(same.elements).toEqual([{ role: 'textbox', name: 'Email' }, { role: 'button', name: 'Subscribe' }]);
  // Boxes round outward, so an edge between two pixels takes both.
  expect(same.box).toMatchObject({ width: 400 });
  expect([200, 201]).toContain(same.box.height);
  expect(other).toMatchObject({ url: `${origin.replace('127.0.0.1', 'localhost')}/frame-inner`, read: false, box: { width: 400 } });
  expect([200, 201]).toContain(other.box.height);
  expect(JSON.stringify(snapshot)).not.toContain('ada@example.test');
});

test("reads no text of an editor that CSS alone makes editable in a same-origin frame, in its text or a name", async () => {
  await openAt('/css-editor');
  await expect.poll(async () => (await page()).frames.map((f: { read: boolean }) => f.read), { timeout: 10_000 }).toEqual([true]);
  const [frame] = (await page()).frames;
  expect(frame.text).toContain('Compose');
  expect(frame.elements).toEqual([{ role: 'clickable', name: 'To:' }, { role: 'button', name: 'Send' }]);
  expect(JSON.stringify(frame)).not.toContain('CSS-DRAFT');
});

test("reads no text of an editor in a widget's open shadow root in a same-origin frame, one CSS alone makes editable or one an attribute does, in its text or a name", async () => {
  await openAt('/shadow-editor');
  await expect.poll(async () => (await page()).frames.map((f: { read: boolean }) => f.read), { timeout: 10_000 }).toEqual([true]);
  await expect.poll(async () => (await page()).frames[0].text ?? '', { timeout: 10_000 }).toContain('Compose');
  const [frame] = (await page()).frames;
  expect(frame.text).toContain('Send');
  expect(JSON.stringify(frame)).not.toMatch(/CSS-DRAFT|ATTR-DRAFT/);
});

test('reads a same-origin frame only where the person sees it, and lists the rest with their boxes, unread', async () => {
  await openAt('/unseen-frames');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(9);
  const snapshot = await page();
  expect(snapshot.frames.map((f: { read: boolean }) => f.read)).toEqual([true, true, false, false, false, false, false, false, false]);
  expect(snapshot.frames.map((f: { offscreen?: boolean }) => f.offscreen ?? false)).toEqual([false, false, false, false, false, false, false, false, true]);
  expect(snapshot.frames.every((f: { box: { width: number } | null }) => f.box !== null && f.box.width >= 200)).toBe(true);
});

test('reads a same-origin frame a dark mode inverts or a filter dims, and leaves one unread under a cover only its paint shows, a cover with holes, or a mask border', async () => {
  const cases: Array<[string, boolean]> = [
    ['plain', true], ['dark', true], ['dimmed', true], ['shadow', false], ['outline', false], ['holes', false], ['mask-border', false],
  ];
  for (const [name, read] of cases) {
    await openAt(`/hidden-frame?case=${name}`);
    await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
    // The frame's page loads after the frame is placed: wait for its text where the frame is read.
    if (read) await expect.poll(async () => (await page()).frames[0].text ?? '', { timeout: 10_000, message: name }).toContain('Get the weekly digest.');
    const [frame] = (await page()).frames;
    expect.soft(frame.read, name).toBe(read);
    expect.soft(JSON.stringify(frame).includes('weekly digest'), name).toBe(read);
  }
});

test('refuses a click by number on a control something covers, and presses nothing', async () => {
  await openAt('/covered');
  const reply = await act({ action: 'click', element: await element('Under') });
  expect(reply.status).toBe(409);
  expect(reply.json()).toMatchObject({ error: 'stale_element', message: expect.stringContaining('is covered by another element') });
  expect((await page()).title).toBe('Covered');
});

test("lists no object or embed as an element, and refuses a click by number that would land in a control's own frame", async () => {
  await openAt('/wrapped-frame');
  /* The three owners with their boxes, and the embed's frame again with
     none: an embed never says whether it holds a frame, so the frame tree's
     extra child can't be placed, which holds every click by position here. */
  await expect.poll(async () => (await page()).frames.map((f: { box: unknown }) => f.box === null), { timeout: 10_000 }).toEqual([false, false, false, true]);
  const snapshot = await page();
  expect(snapshot.elements.map((e: { name: string }) => e.name)).toEqual(['More info']);
  const reply = await act({ action: 'click', element: await element('More info') });
  expect(reply.status, reply.body.toString()).toBe(409);
  expect(reply.json()).toMatchObject({ error: 'stale_element', message: expect.stringContaining('a frame') });
  // Long enough for a click that landed to have been recorded.
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(log.filter((e) => e.type === 'frame-click')).toEqual([]);
});

test('refuses a click by number on a control whose closed shadow root holds a frame, and presses nothing', async () => {
  await openAt('/sealed-frame');
  // The frame tree's child has no owner in the DOM, so it is listed with no box.
  await expect.poll(async () => (await page()).frames.map((f: { box: unknown }) => f.box), { timeout: 10_000 }).toEqual([null]);
  const reply = await act({ action: 'click', element: await element('More info') });
  expect(reply.status, reply.body.toString()).toBe(409);
  expect(reply.json()).toMatchObject({ error: 'stale_element', message: expect.stringContaining('a frame') });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(log.filter((e) => e.type === 'frame-click')).toEqual([]);
});

test("refuses a click by number on a control that slots its own text over a frame in its closed shadow root, and presses nothing", async () => {
  await openAt('/sealed-slot-frame');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  const reply = await act({ action: 'click', element: await element('Continue') });
  expect(reply.status, reply.body.toString()).toBe(409);
  expect(reply.json()).toMatchObject({ error: 'stale_element', message: expect.stringContaining('a frame') });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(log.filter((e) => e.type === 'frame-click')).toEqual([]);
});

test('lists a transparent frame laid over a control, with its box, unread', async () => {
  await openAt('/clear-frame');
  const other = origin.replace('127.0.0.1', 'localhost');
  await expect.poll(async () => (await page()).frames, { timeout: 10_000 }).toEqual([
    { url: `${other}/buy`, read: false, box: { x: 0, y: 0, width: 300, height: 100 } },
  ]);
});

test('presses by position into a frame under the point only when anton says the person approved it', async () => {
  await openAt('/clear-frame');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  // The frame was there when anton read the page, so a step it didn't raise for approval is refused.
  const refused = await act({ action: 'click', x: 20, y: 20, coords: 'page' });
  expect(refused.status, refused.body.toString()).toBe(409);
  expect(refused.json()).toMatchObject({ error: 'stale_element', message: expect.stringContaining('a frame is now under the point (20, 20)') });
  // What anton sends once the app approved clicks by position on the page itself: into_frame false.
  const positionApproved = await act({ action: 'click', x: 20, y: 20, coords: 'page', into_frame: false });
  expect(positionApproved.status, positionApproved.body.toString()).toBe(409);
  expect(positionApproved.json()).toMatchObject({ error: 'stale_element', message: expect.stringContaining('a frame is now under the point (20, 20)') });
  const drop = await act({ action: 'drag', from: { x: 20, y: 150 }, to: { x: 20, y: 20 }, coords: 'page' });
  expect(drop.status, drop.body.toString()).toBe(409);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(log.filter((e) => e.type === 'frame-click')).toEqual([]);
  const approved = await act({ action: 'click', x: 20, y: 20, coords: 'page', into_frame: true });
  expect(approved.status, approved.body.toString()).toBe(200);
  await expect.poll(() => log.filter((e) => e.type === 'frame-click')).toEqual([{ type: 'frame-click', isTrusted: true }]);
});

test("types into an ordinary field of another site's embedded form, and refuses an editing key into its password field", async () => {
  await openAt('/frame-fields');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  // The person approved each click into the frame.
  expect((await act({ action: 'click', x: 20, y: 20, coords: 'page', into_frame: true })).status).toBe(200);
  const typed = await act({ action: 'press', key: 'a' });
  expect(typed.status, typed.body.toString()).toBe(200);
  await expect.poll(() => log.filter((e) => e.type === 'frame-key')).toEqual([{ type: 'frame-key', key: 'a', target: 'u', isTrusted: true }]);
  log = [];
  expect((await act({ action: 'click', x: 20, y: 120, coords: 'page', into_frame: true })).status).toBe(200);
  const refused = await act({ action: 'press', key: 'a' });
  expect(refused.status, refused.body.toString()).toBe(403);
  expect(refused.json().error).toBe('password_field');
  // A key that edits nothing still goes in.
  expect((await act({ action: 'press', key: 'ArrowLeft' })).status).toBe(200);
  await expect.poll(() => log.filter((e) => e.type === 'frame-key').map((e) => e.key)).toEqual(['ArrowLeft']);
});

test('refuses an editing key into a password field the page keeps in a closed shadow root, and types into an ordinary field there', async () => {
  await openAt('/closed-fields');
  expect((await act({ action: 'click', x: 20, y: 20, coords: 'page' })).status).toBe(200);
  const typed = await act({ action: 'press', key: 'a' });
  expect(typed.status, typed.body.toString()).toBe(200);
  await expect.poll(() => log.filter((e) => e.type === 'closed-key')).toEqual([{ type: 'closed-key', key: 'a', target: 'u', isTrusted: true }]);
  log = [];
  expect((await act({ action: 'click', x: 20, y: 120, coords: 'page' })).status).toBe(200);
  const refused = await act({ action: 'press', key: 'a' });
  expect(refused.status, refused.body.toString()).toBe(403);
  expect(refused.json().error).toBe('password_field');
  expect((await act({ action: 'press', key: 'ArrowLeft' })).status).toBe(200);
  await expect.poll(() => log.filter((e) => e.type === 'closed-key').map((e) => e.key)).toEqual(['ArrowLeft']);
});

test("refuses an editing key into the password field of another site's form the page keeps in a closed shadow root, and types into its ordinary field", async () => {
  await openAt('/closed-frame-fields');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  expect((await act({ action: 'click', x: 20, y: 20, coords: 'page', into_frame: true })).status).toBe(200);
  const typed = await act({ action: 'press', key: 'a' });
  expect(typed.status, typed.body.toString()).toBe(200);
  await expect.poll(() => log.filter((e) => e.type === 'frame-key')).toEqual([{ type: 'frame-key', key: 'a', target: 'u', isTrusted: true }]);
  log = [];
  expect((await act({ action: 'click', x: 20, y: 120, coords: 'page', into_frame: true })).status).toBe(200);
  const refused = await act({ action: 'press', key: 'a' });
  expect(refused.status, refused.body.toString()).toBe(403);
  expect(refused.json().error).toBe('password_field');
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(log.filter((e) => e.type === 'frame-key')).toEqual([]);
});

test("blacks out the password field of another site's embedded form in a screenshot, and shows the rest of the form", async () => {
  await openAt('/frame-fields');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  // The frame is 400 CSS pixels wide at the page's top left; its box says how the screenshot scales.
  const [frame] = (await page()).frames;
  const scale = frame.box.width / 400;
  const shot = await call('GET', `/sessions/${SESSION}/screenshot?quality=95`);
  expect(shot.status, shot.body.toString()).toBe(200);
  // CSS points: three in the password field (0, 100) to (300, 140), then the ordinary field and the form's background.
  const points = [[10, 105], [150, 120], [290, 135], [150, 20], [350, 170]].map(([x, y]) => [Math.round(x * scale), Math.round(y * scale)]);
  const pixels: number[][] = await app.evaluate(({ nativeImage }, { jpeg, at }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(jpeg, 'base64'));
    const { width } = image.getSize();
    const bitmap = image.toBitmap();
    return at.map(([x, y]) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)]);
  }, { jpeg: shot.body.toString('base64'), at: points });
  const dark = pixels.map((rgb) => rgb.every((channel) => channel < 40));
  expect(dark).toEqual([true, true, true, false, false]);
});

test("blacks out a card field in the page's own frame kept in a closed shadow root, where the page's search can't reach it", async () => {
  await openAt('/closed-same-card');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  // CSS points: three on the card number, then the form's background.
  expect(await blackIn('/closed-same-card', [[110, 60], [190, 60], [280, 60], [50, 20]])).toEqual([true, true, true, false]);
});

/* Attaches or detaches the debugger of the page at `route` from outside the
   browser, as something else holding it would. */
async function holdDebugger(route: string, hold: boolean): Promise<void> {
  await app.evaluate(({ webContents }, { at, attach }) => {
    const contents = webContents.getAllWebContents().find((c) => c.getURL() === at);
    if (attach) contents?.debugger.attach('1.3');
    else if (contents?.debugger.isAttached()) contents.debugger.detach();
  }, { at: `${origin}${route}`, attach: hold });
}

test("takes no screenshot while something else holds the debugger when the page keeps a frame its search can't reach, and blacks out whole another site's frame it found", async () => {
  await openAt('/closed-same-card');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  await holdDebugger('/closed-same-card', true);
  try {
    const shot = await call('GET', `/sessions/${SESSION}/screenshot?quality=95`);
    expect(shot.status, shot.body.toString()).toBe(500);
    expect(shot.json()).toMatchObject({ error: 'internal', message: expect.stringContaining("couldn't read every frame") });
  } finally {
    await holdDebugger('/closed-same-card', false);
  }
  await openAt('/frame-fields');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  await holdDebugger('/frame-fields', true);
  try {
    // CSS points: the ordinary field and the password field, both inside the frame.
    expect(await blackIn('/frame-fields', [[150, 20], [150, 120], [350, 170]])).toEqual([true, true, true]);
  } finally {
    await holdDebugger('/frame-fields', false);
  }
});

test("blacks out a card field where another site's frame draws it at twice its size", async () => {
  await openAt('/scaled-card');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  // CSS points: three on the card number, drawn from (200, 80) to (580, 160); then the frame's background, where an unscaled mask would land.
  expect(await blackIn('/scaled-card', [[220, 120], [390, 120], [560, 150], [150, 60], [100, 170]])).toEqual([true, true, true, false, false]);
});

test("blacks out a card field where another site's frame draws it at half its size", async () => {
  await openAt('/half-card');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  // CSS points: three on the card number, drawn from (50, 20) to (145, 40); then where an unscaled mask would land, and the frame's background.
  expect(await blackIn('/half-card', [[55, 23], [97, 30], [140, 37], [200, 60], [20, 10]])).toEqual([true, true, true, false, false]);
});

test("blacks out a card field where the page's own frame draws it at twice or half its size, and the whole frame where an offset path turns it, while something else holds the debugger too", async () => {
  for (const scale of [2, 0.5]) {
    const route = `/scaled-same-card?scale=${scale}`;
    await openAt(route);
    await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
    // CSS points: three on the card number, drawn from (100, 40) to (290, 80) times the scale; then the page or the frame's background where an unscaled mask would land.
    const points = [[100 * scale + 5, 40 * scale + 3], [195 * scale, 60 * scale], [290 * scale - 5, 80 * scale - 3], scale === 2 ? [150, 60] : [200, 60]];
    expect(await blackIn(route, points), `scale ${scale}`).toEqual([true, true, true, false]);
    await holdDebugger(route, true);
    try {
      expect(await blackIn(route, points), `scale ${scale}, the debugger held`).toEqual([true, true, true, false]);
    } finally {
      await holdDebugger(route, false);
    }
  }
  await openAt('/along-same-card');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(1);
  // CSS points: both ends and the middle of the card number, the four corners of the box the frame is drawn in, then the page outside it.
  const along = [[206, 136], [284, 181], [362, 226], [103, 40], [397, 40], [103, 260], [397, 260], [50, 300]];
  const blackedOut = [true, true, true, true, true, true, true, false];
  expect(await blackIn('/along-same-card', along), 'an offset path').toEqual(blackedOut);
  await holdDebugger('/along-same-card', true);
  try {
    expect(await blackIn('/along-same-card', along), 'an offset path, the debugger held').toEqual(blackedOut);
  } finally {
    await holdDebugger('/along-same-card', false);
  }
});

test('blacks out the copy -webkit-box-reflect draws of a card field, and the whole copy of a frame, while something else holds the debugger too', async () => {
  await openAt('/reflected-card');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(2);
  const points = [
    // The page's field, its copy from (0, 60) to (190, 100), and the gap between them.
    [95, 20], [10, 80], [95, 80], [180, 80], [95, 50],
    // The page's frame's copy from (300, 110) to (600, 210), its card number's copy from (400, 130) to (590, 170), and the page below it.
    [410, 150], [495, 150], [580, 150], [320, 120], [320, 230],
    // Another site's frame's copy from (0, 360) to (300, 460), its card number's copy from (100, 380) to (290, 420), and the page beside it.
    [195, 400], [20, 370], [350, 400],
  ];
  const blackedOut = [true, true, true, true, false, true, true, true, true, false, true, true, false];
  expect(await blackIn('/reflected-card', points)).toEqual(blackedOut);
  await holdDebugger('/reflected-card', true);
  try {
    expect(await blackIn('/reflected-card', points), 'the debugger held').toEqual(blackedOut);
  } finally {
    await holdDebugger('/reflected-card', false);
  }
});

test('refuses a click whose point a frame slides over as the pointer arrives, by number and by position, and presses nothing', async () => {
  await openAt('/moving-frame');
  const byNumber = await act({ action: 'click', element: await element('Go') });
  expect(byNumber.status, byNumber.body.toString()).toBe(409);
  expect(byNumber.json()).toMatchObject({ error: 'stale_element', message: expect.stringContaining('a frame') });
  await openAt('/moving-frame');
  const byPosition = await act({ action: 'click', x: 20, y: 220, coords: 'page' });
  expect(byPosition.status, byPosition.body.toString()).toBe(409);
  expect(byPosition.json()).toMatchObject({ error: 'stale_element', message: expect.stringContaining('a frame') });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(log.filter((e) => e.type === 'frame-click')).toEqual([]);
  expect((await page()).title).toBe('Moving');
});

test('presses nothing with into_frame once another frame slides over the approved one as the pointer arrives, and presses the approved one when it stays', async () => {
  // The pointer starts on the page, outside the player frame, so the page sees it move.
  expect((await act({ action: 'hover', x: 700, y: 500, coords: 'page' })).status).toBe(200);
  await openAt('/swap-frame');
  await expect.poll(async () => (await page()).frames.length, { timeout: 10_000 }).toBe(2);
  const swapped = await act({ action: 'click', x: 150, y: 50, coords: 'page', into_frame: true });
  expect(swapped.status, swapped.body.toString()).toBe(409);
  expect(swapped.json()).toMatchObject({ error: 'stale_element', message: expect.stringContaining('the frame under the point (150, 50) is no longer the one there') });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(log.filter((e) => e.type === 'frame-click' || e.type === 'player-click')).toEqual([]);
  // Read again, the Buy frame now lies under the point, and an approved press goes into it.
  const approved = await act({ action: 'click', x: 150, y: 50, coords: 'page', into_frame: true });
  expect(approved.status, approved.body.toString()).toBe(200);
  await expect.poll(() => log.filter((e) => e.type === 'frame-click')).toEqual([{ type: 'frame-click', isTrusted: true }]);
});

test('turns shared workers off, since their WebSockets skip the request listener', async () => {
  await openAt('/features');
  await expect.poll(async () => (await page()).text).toContain('SharedWorker: undefined');
});

/* The app menu's Close and Reload take Command on macOS and Control elsewhere. */
const MENU_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

test("keeps the agent's close and reload chords in the page, away from the pane's claims and the app menu", async () => {
  await openAt('/form');
  await markPage();
  await shell.evaluate(() => { (window as any).inAppBrowserE2eMarker = 'kept'; });
  // A menu shortcut acts on the focused window.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
  for (const key of [`${MENU_MODIFIER}+w`, `${MENU_MODIFIER}+r`]) {
    const pressed = await act({ action: 'press', key });
    expect(pressed.status, pressed.body.toString()).toBe(200);
  }
  /* The page got both keys itself. The agent's keys never reach the view's
     before-input-event, where the pane claims a person's reload chord, and
     carry no native key code, so an unhandled one never reaches the menu.
     On macOS a key that main sends can't reach the menu either way, so the
     window checks below bite only outside it. */
  await expect.poll(() => ['w', 'r'].every((key) => log.some((e) => e.type === 'keydown' && e.key === key && e.isTrusted))).toBe(true);
  // Long enough for a menu shortcut to have closed or reloaded the window.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect(await shell.evaluate(() => (window as any).inAppBrowserE2eMarker)).toBe('kept');
  expect(await pageMark()).toBe('kept');
  expect((await page()).url).toBe(`${origin}/form`);
});

test("reloads the site, not the app, on the person's reload chord", async () => {
  await openAt('/form');
  await shell.evaluate((id) => (window as any).antontron.browser.show(id, { x: 400, y: 0, width: 800, height: 800 }), SESSION);
  await shell.evaluate(() => { (window as any).inAppBrowserE2eMarker = 'kept'; });
  const modifier = process.platform === 'darwin' ? 'meta' : 'control';
  for (const modifiers of [[modifier], [modifier, 'shift']] as Array<Array<'meta' | 'control' | 'shift'>>) {
    await markPage();
    // A person's keys, as the OS hands them to the focused view.
    await app.evaluate(({ BrowserWindow, webContents }, { at, held }) => {
      BrowserWindow.getAllWindows()[0]?.focus();
      const tab = webContents.getAllWebContents().find((contents) => contents.getURL() === at);
      tab?.focus();
      tab?.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: held });
      tab?.sendInputEvent({ type: 'keyUp', keyCode: 'R', modifiers: held });
    }, { at: `${origin}/form`, held: modifiers });
    await expect.poll(pageMark, { message: `${modifiers.join('+')}+R reloads the site` }).toBeNull();
  }
  /* The app stays as it was. On macOS a key that main sends can't reach the
     menu, so the poll above is what fails there without the pane's claim.
     Elsewhere the menu's Reload and Force Reload act on the focused view, the
     tab, so the site reloads with or without the claim; browser-view.test.ts
     covers the claim on every platform. */
  expect(await shell.evaluate(() => (window as any).inAppBrowserE2eMarker)).toBe('kept');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await shell.evaluate(() => (window as any).antontron.browser.hide());
});

test('takes a labelled JPEG screenshot with its size', async () => {
  const shot = await call('GET', `/sessions/${SESSION}/screenshot?annotate=true&format=jpeg&quality=70`);
  expect(shot.status).toBe(200);
  expect(shot.headers['content-type']).toBe('image/jpeg');
  expect([...shot.body.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  expect(Number(shot.headers['x-image-width'])).toBeGreaterThan(100);
  expect(Number(shot.headers['x-image-width'])).toBeLessThanOrEqual(1024);
});

test('hands the browser to the person, and only their Done hands it back', async () => {
  const handed = await call('POST', `/sessions/${SESSION}/control`, { holder: 'human', reason: 'Please sign in' });
  expect(handed.json()).toMatchObject({ holder: 'human', by: 'agent' });
  expect((await call('GET', `/sessions/${SESSION}/page`)).status).toBe(409);
  const takeBack = await call('POST', `/sessions/${SESSION}/control`, { holder: 'agent', reason: '' });
  expect(takeBack.status).toBe(403);
  expect(takeBack.json().error).toBe('person_only');
  await shell.evaluate((id) => (window as any).antontron.browser.handBack(id), SESSION);
  const info = (await call('GET', `/sessions/${SESSION}`)).json();
  expect(info.control).toMatchObject({ holder: 'agent', by: 'person', seq: handed.json().seq + 1 });
});

test('shows the task in the pane, answers whether it draws, and hides it again', async () => {
  const shown = await shell.evaluate((id) => (window as any).antontron.browser.show(id, { x: 400, y: 0, width: 800, height: 800 }), SESSION);
  expect(shown).toEqual({ exists: true, drawn: true });
  // A stage under main's floor keeps the task shown, but nothing draws.
  expect(await shell.evaluate(() => (window as any).antontron.browser.setBounds({ x: 400, y: 0, width: 800, height: 150 }))).toEqual({ drawn: false });
  expect(await shell.evaluate(() => (window as any).antontron.browser.setBounds({ x: 400, y: 0, width: 800, height: 800 }))).toEqual({ drawn: true });
  const missing = await shell.evaluate(() => (window as any).antontron.browser.show('t-missing', { x: 400, y: 0, width: 800, height: 800 }));
  expect(missing).toEqual({ exists: false, drawn: false });
  await shell.evaluate(() => (window as any).antontron.browser.hide());
});

test('opens a popup that follows a click as a tab, with its opener', async () => {
  await openAt('/form');
  expect((await act({ action: 'click', element: await element('Open popup') })).status).toBe(200);
  await expect.poll(async () => (await call('GET', `/sessions/${SESSION}/tabs`)).json().tabs.length).toBe(2);
  const tabs = (await call('GET', `/sessions/${SESSION}/tabs`)).json().tabs;
  // The agent holds the browser, so the popup opens in the background.
  expect(tabs.find((t: { active: boolean }) => t.active).id).toBe('t1');
  expect((await call('POST', `/sessions/${SESSION}/tabs/t2/activate`)).status).toBe(200);
  await expect.poll(async () => (await page()).text).toContain('has opener');
  expect((await call('DELETE', `/sessions/${SESSION}/tabs/t2`)).status).toBe(200);
});

test('refuses a popup that follows no input', async () => {
  await openAt('/autopop');
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect((await call('GET', `/sessions/${SESSION}/tabs`)).json().tabs).toHaveLength(1);
});

test('keeps a cookie across a restart, and Sign out of all sites clears it', async () => {
  await openAt('/set-cookie');
  await app.close();
  await launch();
  expect((await call('POST', '/sessions', { session_id: SESSION, url: `${origin}/echo-cookie` })).status).toBe(201);
  await expect.poll(async () => (await page()).text, { timeout: 15_000 }).toContain('cookie:[e2e=kept]');
  expect(await shell.evaluate(() => (window as any).antontron.browser.clearData())).toEqual({ ok: true });
  expect((await call('POST', '/sessions', { session_id: SESSION, url: `${origin}/echo-cookie` })).status).toBe(201);
  await expect.poll(async () => (await page()).text, { timeout: 15_000 }).toContain('cookie:[]');
});
