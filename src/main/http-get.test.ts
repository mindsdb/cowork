import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';

// http-get is dependency-light (node built-ins only) — importing it doesn't pull
// electron/keytar, which fail to load on Linux CI without libsecret (ENG-749).
import { httpsGet } from './http-get';

let server: http.Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

function listen(handler: http.RequestListener): Promise<number> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve((server!.address() as AddressInfo).port);
    });
  });
}

describe('httpsGet bounding (ENG-749)', () => {
  it('returns the body on a normal response', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200);
      res.end('hello');
    });
    const res = await httpsGet(`http://127.0.0.1:${port}/x`, 1000, 1000);
    expect(res.statusCode).toBe(200);
    expect(res.body.toString()).toBe('hello');
  });

  // A steady trickle defeats socket inactivity timeouts; only the absolute deadline can terminate
  // this download.
  it('rejects on the absolute deadline while the response keeps trickling', async () => {
    const port = await listen((req, res) => {
      res.writeHead(200);
      res.write('a');
      const iv = setInterval(() => { try { res.write('a'); } catch {  } }, 20);
      req.on('close', () => clearInterval(iv));
    });
    // Inactivity 5s never fires under a 20ms trickle; absolute 150ms bounds it.
    await expect(
      httpsGet(`http://127.0.0.1:${port}/x`, 5000, 150),
    ).rejects.toThrow(/absolute deadline/i);
  });
});
