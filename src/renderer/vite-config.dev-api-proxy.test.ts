import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

import { DEV_PROXY_AUTH_TOKEN_ENV, DEV_PROXY_WINDOW_PROOF_ENV } from '../shared/server-launch';

/*
 * Loads the real renderer config as a dev server, puts it in front of a
 * loopback server that records what reaches it, and sends requests through
 * Vite's /api proxy, the way `npm run dev:web` runs it.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 'a1'.repeat(32);
const PROOF = 'b2'.repeat(32);
const ENV_KEYS = ['BUILD_TARGET', 'COWORK_SERVER_PORT', 'VITE_RENDERER_PORT', DEV_PROXY_AUTH_TOKEN_ENV, DEV_PROXY_WINDOW_PROOF_ENV] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

/* The headers each request to the stand-in cowork-server arrived with. */
const received: http.IncomingHttpHeaders[] = [];
let backend: http.Server;
let backendPort = 0;
let front: http.Server | undefined;
let dev: ViteDevServer | undefined;

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function close(server: http.Server | undefined): Promise<void> {
  return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
}

beforeAll(async () => {
  backend = http.createServer((req, res) => {
    received.push(req.headers);
    if (req.url === '/api/v1/responses') {
      /* What cowork-server does for a path without its trailing slash: a 307
         to an absolute URL built from the Host it received. */
      res.writeHead(307, { location: `http://${req.headers.host}${req.url}/` }).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  backendPort = await listen(backend);
});

afterEach(async () => {
  await close(front);
  await dev?.close();
  front = undefined;
  dev = undefined;
  received.length = 0;
});

afterAll(async () => {
  await close(backend);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/* Starts Vite with the dev-web variables set or not, behind a plain HTTP
   server, and returns that server's port. Set here rather than once, since
   tests/setup-env.ts clears COWORK_SERVER_* and *_TOKEN before every test. */
async function startVite(withCredentials: boolean): Promise<number> {
  process.env.COWORK_SERVER_PORT = String(backendPort);
  process.env.BUILD_TARGET = 'web';
  process.env.VITE_RENDERER_PORT = '5173';
  if (withCredentials) {
    process.env[DEV_PROXY_AUTH_TOKEN_ENV] = TOKEN;
    process.env[DEV_PROXY_WINDOW_PROOF_ENV] = PROOF;
  } else {
    delete process.env[DEV_PROXY_AUTH_TOKEN_ENV];
    delete process.env[DEV_PROXY_WINDOW_PROOF_ENV];
  }
  dev = await createServer({
    configFile: path.resolve(__dirname, 'vite.config.ts'),
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, ws: false, preTransformRequests: false },
  });
  front = http.createServer(dev.middlewares);
  return listen(front);
}

/* Sends one request through Vite and resolves with the headers the backend got. */
function through(port: number, headers: Record<string, string>, method = 'POST'): Promise<http.IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/settings/raw', method, headers }, (res) => {
      res.resume();
      res.on('end', () => {
        const last = received.at(-1);
        if (last) resolve(last);
        else reject(new Error(`the request did not reach the backend (status ${res.statusCode})`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe("Vite's /api proxy under dev:web", () => {
  it("adds the launch's token and proof to a request from Vite's own page", async () => {
    const port = await startVite(true);

    const headers = await through(port, { host: 'localhost:5173', origin: 'http://localhost:5173', 'x-cowork-window-proof': 'forged' });

    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['x-cowork-window-proof']).toBe(PROOF);
  });

  it("adds them to a same-origin GET, which carries Vite's page as its Referer", async () => {
    const port = await startVite(true);

    const headers = await through(port, { host: 'localhost:5173', referer: 'http://localhost:5173/c/1' }, 'GET');

    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['x-cowork-window-proof']).toBe(PROOF);
  });

  it('adds neither to a cross-site request, and removes the proof it brought', async () => {
    const port = await startVite(true);

    const headers = await through(port, { host: 'localhost:5173', origin: 'https://evil.example', 'x-cowork-window-proof': 'forged' });

    expect(headers.authorization).toBeUndefined();
    expect(headers['x-cowork-window-proof']).toBeUndefined();
  });

  it("points the server's trailing-slash redirect back at Vite, so the follow-up gets both headers too", async () => {
    const port = await startVite(true);

    const location = await new Promise<string | undefined>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/v1/responses', method: 'POST', headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.headers.location));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(location).toBe('http://localhost:5173/api/v1/responses/');
  });

  it('keeps both values out of what Vite hands the client bundle', async () => {
    await startVite(true);
    const config = dev!.config;

    const exposed = JSON.stringify({ env: config.env, define: config.define });
    expect(exposed).not.toContain(TOKEN);
    expect(exposed).not.toContain(PROOF);
    /* Unset, so Vite exposes only VITE_ variables (its default prefix). */
    expect(config.envPrefix).toBeUndefined();
    expect(Object.keys(config.env).filter((key) => key.startsWith('COWORK_'))).toEqual([]);
  });
});

describe("Vite's /api proxy under npm run dev", () => {
  it("forwards desktop main's headers unchanged when dev-web set no credentials", async () => {
    const port = await startVite(false);

    const headers = await through(port, {
      host: 'localhost:5173',
      origin: 'http://localhost:5173',
      authorization: 'Bearer from-desktop-main',
      'x-cowork-window-proof': 'from-desktop-main',
    });

    expect(headers.authorization).toBe('Bearer from-desktop-main');
    expect(headers['x-cowork-window-proof']).toBe('from-desktop-main');
  });
});
