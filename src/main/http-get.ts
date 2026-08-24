// Dependency-light HTTP GET for the updater. Kept out of ui-updater.ts so it (and
// its tests) don't transitively pull electron/keytar — which fail to load on
// Linux CI without libsecret (ENG-749 review). Node built-ins only.

import * as https from 'https';
import * as http from 'http';

/** Loopback host? Plaintext http is only ever fetched from these. */
export function isLoopbackUrl(u: string): boolean {
  try {
    const host = new URL(u).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

// `timeoutMs` is a per-socket inactivity timeout; `absoluteTimeoutMs` is a hard
// wall-clock deadline for the whole operation (spanning redirects), so a
// trickle-fed response can't reset the inactivity timeout forever and hang the
// boot poll (ENG-749).
export function httpsGet(
  url: string,
  timeoutMs = 10000,
  absoluteTimeoutMs = timeoutMs,
): Promise<{ statusCode: number; headers: Record<string, any>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeReq: http.ClientRequest | null = null;
    const succeed = (v: { statusCode: number; headers: Record<string, any>; body: Buffer }) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(v);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try { activeReq?.destroy(); } catch { /* already gone */ }
      reject(err);
    };
    const deadline = setTimeout(
      () => fail(new Error('Request exceeded absolute deadline')),
      absoluteTimeoutMs,
    );
    deadline.unref?.();

    const doGet = (reqUrl: string, redirects: number) => {
      try {
        if (redirects > 5) { fail(new Error('Too many redirects')); return; }
        // https by default; plaintext http only for a loopback QA fixture host
        // — never for a remote host, tampered manifest, or redirect target.
        const isHttp = reqUrl.startsWith('http://');
        if (isHttp && !isLoopbackUrl(reqUrl)) {
          fail(new Error(`refusing plaintext http fetch from a non-loopback host: ${reqUrl}`));
          return;
        }
        const mod = isHttp ? http : https;
        const req = mod.get(reqUrl, { headers: { 'User-Agent': 'antontron-updater' } }, (res) => {
          // Follow redirects (GitHub releases use 302)
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            doGet(res.headers.location, redirects + 1);
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => succeed({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, any>,
            body: Buffer.concat(chunks),
          }));
          res.on('error', fail);
        });
        activeReq = req;
        req.on('error', fail);
        req.setTimeout(timeoutMs, () => fail(new Error('Request timed out')));
      } catch (err) {
        fail(err as Error);
      }
    };
    doGet(url, 0);
  });
}
