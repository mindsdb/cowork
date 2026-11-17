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

  // Regression: an update dependency (the bundle download) that never settles.
  // A steady trickle keeps resetting the per-socket inactivity timeout, so only
  // the absolute wall-clock deadline can end it — proving the poll can't hang.
  it('rejects on the absolute deadline while the response keeps trickling', async () => {
    const port = await listen((req, res) => {
      res.writeHead(200);
      res.write('a');
      const iv = setInterval(() => { try { res.write('a'); } catch { /* closed */ } }, 20);
      req.on('close', () => clearInterval(iv));
    });
    // Inactivity 5s never fires under a 20ms trickle; absolute 150ms bounds it.
    await expect(
      httpsGet(`http://127.0.0.1:${port}/x`, 5000, 150),
    ).rejects.toThrow(/absolute deadline/i);
  });
});

describe('httpsGet redirects', () => {
  // GitHub release assets always redirect. The redirect's own request kept its
  // inactivity timer armed, so a download that outlived it failed mid-transfer.
  it('finishes a download that outlives the redirect request\'s inactivity timeout', async () => {
    const port = await listen((req, res) => {
      if (req.url === '/asset') {
        res.writeHead(302, { Location: `http://127.0.0.1:${port}/bundle` });
        res.end();
        return;
      }
      res.writeHead(200);
      let sent = 0;
      const iv = setInterval(() => {
        sent += 1;
        res.write('a');
        if (sent === 10) { clearInterval(iv); res.end(); }
      }, 30);
      req.on('close', () => clearInterval(iv));
    });
    // 10 chunks at 30ms is ~300ms, three times the 100ms inactivity timeout,
    // but no gap between chunks reaches it.
    const res = await httpsGet(`http://127.0.0.1:${port}/asset`, 100, 2000);
    expect(res.statusCode).toBe(200);
    expect(res.body.toString()).toBe('a'.repeat(10));
  });
});
