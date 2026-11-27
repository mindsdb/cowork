import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as zlib from 'node:zlib';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { LookupAddress } from 'node:dns';
import cases from './__fixtures__/public-address-cases.json';
import { checkPublicHttpsUrl, createGuardedFetch, GuardedFetchError, type GuardedFetchOptions } from './guarded-fetch';
import { discoverMcpAuth } from './mcp-oauth';

type Responder = (options: https.RequestOptions & { servername?: string }, body: string) =>
  | { status: number; headers?: Record<string, string>; chunks?: Array<string | Buffer>; open?: boolean; resetAfter?: boolean }
  | 'error'
  | 'hang';

/* A stand-in for https.request: records the options it was called with and
   plays back what `responder` returns, without opening a socket. */
function fakeRequest(responder: Responder) {
  const calls: Array<https.RequestOptions & { servername?: string }> = [];
  const destroyed = { count: 0 };
  const request = ((options: https.RequestOptions & { servername?: string }, onResponse: (res: unknown) => void) => {
    calls.push(options);
    const req = new EventEmitter() as EventEmitter & { write: (c: string) => void; end: () => void; destroy: () => void };
    let written = '';
    req.write = (chunk: string) => {
      written += chunk;
    };
    req.destroy = () => {
      destroyed.count += 1;
    };
    req.end = () => {
      const outcome = responder(options, written);
      queueMicrotask(() => {
        if (outcome === 'error') {
          req.emit('error', new Error('ECONNREFUSED'));
          return;
        }
        if (outcome === 'hang') return;
        const res = Object.assign(new PassThrough(), {
          statusCode: outcome.status,
          statusMessage: '',
          headers: outcome.headers ?? {},
        });
        onResponse(res);
        void (async () => {
          for (const chunk of outcome.chunks ?? []) {
            res.write(chunk);
            // Let each chunk arrive on its own.
            await new Promise((done) => setImmediate(done));
          }
          if (outcome.resetAfter) res.emit('error', new Error('ECONNRESET'));
          else if (!outcome.open) res.end();
        })();
      });
    };
    return req;
  }) as unknown as typeof https.request;
  return { request, calls, destroyed };
}

function answers(...addresses: string[]): (hostname: string) => Promise<LookupAddress[]> {
  return async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

function guarded(responder: Responder, options: Partial<GuardedFetchOptions> = {}) {
  const fake = fakeRequest(responder);
  const fetchFn = createGuardedFetch({ lookupAll: answers('93.184.215.14'), request: fake.request, ...options });
  return { fetchFn, calls: fake.calls, destroyed: fake.destroyed };
}

const ok: Responder = () => ({ status: 200, headers: { 'content-type': 'application/json' }, chunks: ['{"ok":true}'] });

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(GuardedFetchError);
    return (err as GuardedFetchError).code;
  }
  throw new Error('expected a refusal');
}

function literalUrl(address: string): string {
  return address.includes(':') ? `https://[${address}]/mcp` : `https://${address}/mcp`;
}

describe('createGuardedFetch', () => {
  it.each(['http://mcp.example.com/mcp', 'ftp://mcp.example.com/', 'file:///etc/passwd'])('refuses %s as not https', async (url) => {
    const { fetchFn, calls } = guarded(ok);
    expect(await refusal(fetchFn(url))).toBe('not_https');
    expect(calls).toEqual([]);
  });

  it.each(['https://user:pw@mcp.example.com/', 'not a url'])('refuses %s as invalid', async (url) => {
    const { fetchFn, calls } = guarded(ok);
    expect(await refusal(fetchFn(url))).toBe('invalid_url');
    expect(calls).toEqual([]);
  });

  it.each(cases.refused)('refuses the IP literal %s before dialing', async (address) => {
    const lookupAll = vi.fn(answers('93.184.215.14'));
    const { fetchFn, calls } = guarded(ok, { lookupAll });
    expect(await refusal(fetchFn(literalUrl(address)))).toBe('not_public');
    expect(calls).toEqual([]);
    expect(lookupAll).not.toHaveBeenCalled();
  });

  it.each(['https://2130706433/', 'https://0x7f.1/', 'https://127.1/', 'https://0251.0376.0251.0376/'])(
    'refuses the integer, hex and short form %s',
    async (url) => {
      const { fetchFn, calls } = guarded(ok);
      expect(await refusal(fetchFn(url))).toBe('not_public');
      expect(calls).toEqual([]);
    },
  );

  it.each(cases.refused)('refuses a name resolving to %s', async (address) => {
    const { fetchFn, calls } = guarded(ok, { lookupAll: answers(address) });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp'))).toBe('not_public');
    expect(calls).toEqual([]);
  });

  it('refuses a name whose answer mixes a public and a private address', async () => {
    const { fetchFn, calls } = guarded(ok, { lookupAll: answers('93.184.215.14', '10.0.0.5') });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp'))).toBe('not_public');
    expect(calls).toEqual([]);
  });

  it('reports a name that does not resolve', async () => {
    const lookupAll = async () => {
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    const { fetchFn } = guarded(ok, { lookupAll });
    expect(await refusal(fetchFn('https://nowhere.example.com/'))).toBe('unresolved');
    expect(await refusal(createGuardedFetch({ lookupAll: async () => [], request: fakeRequest(ok).request })('https://x.example.com/'))).toBe('unresolved');
  });

  it('dials only the checked addresses, with the ASCII host as Host header and TLS name', async () => {
    const { fetchFn, calls } = guarded(ok, { lookupAll: answers('93.184.215.14', '2606:4700:4700::1111') });
    const response = await fetchFn(new URL('https://straße.example:8443/.well-known/oauth-protected-resource?x=1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const [options] = calls;
    expect(options.hostname).toBe('xn--strae-oqa.example');
    expect(options.servername).toBe('xn--strae-oqa.example');
    expect((options.headers as Record<string, string>).host).toBe('xn--strae-oqa.example:8443');
    expect(options.port).toBe(8443);
    expect(options.path).toBe('/.well-known/oauth-protected-resource?x=1');
    expect(options.agent).toBeInstanceOf(https.Agent);

    const pinned: unknown[] = [];
    options.lookup!('evil.example', { all: true } as never, (...args: unknown[]) => pinned.push(args));
    options.lookup!('evil.example', {} as never, (...args: unknown[]) => pinned.push(args));
    expect(pinned).toEqual([
      [null, [{ address: '93.184.215.14', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]],
      [null, '93.184.215.14', 4],
    ]);
  });

  it('sends no TLS name for a public IP literal, and dials it', async () => {
    const { fetchFn, calls } = guarded(ok);
    await fetchFn('https://93.184.215.14/mcp');
    expect(calls[0].hostname).toBe('93.184.215.14');
    expect(calls[0].servername).toBeUndefined();
  });

  it('sends the method, headers and body it is given', async () => {
    let seen = '';
    const { fetchFn, calls } = guarded((_options, body) => {
      seen = body;
      return { status: 200, chunks: ['{}'] };
    });
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: 'abc' });
    await fetchFn('https://auth.example.com/token', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: form,
    });
    expect(seen).toBe('grant_type=authorization_code&code=abc');
    expect(calls[0].method).toBe('POST');
    expect((calls[0].headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('returns a redirect as it is, without following it', async () => {
    const { fetchFn, calls } = guarded(() => ({ status: 302, headers: { location: 'https://10.0.0.5/' } }));
    const response = await fetchFn('https://mcp.example.com/');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://10.0.0.5/');
    expect(calls).toHaveLength(1);
  });

  it('stops reading a body over the size limit', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, chunks: ['x'.repeat(600), 'x'.repeat(600)] }), { maxBytes: 1000 });
    expect(await refusal(fetchFn('https://mcp.example.com/'))).toBe('too_large');
  });

  it('gives up on a server that does not answer in time', async () => {
    const { fetchFn } = guarded(() => 'hang', { timeoutMs: 20 });
    expect(await refusal(fetchFn('https://mcp.example.com/'))).toBe('timeout');
  });

  it('reports a failed connection on a proxy-only network as its own error', async () => {
    const proxied = guarded(() => 'error', { proxyConfigured: async () => true });
    expect(await refusal(proxied.fetchFn('https://mcp.example.com/'))).toBe('proxy_network');
    const direct = guarded(() => 'error', { proxyConfigured: async () => false });
    expect(await refusal(direct.fetchFn('https://mcp.example.com/'))).toBe('network');
  });
});

describe('createGuardedFetch bodies', () => {
  const SSE = { 'content-type': 'text/event-stream' };

  it('asks for no encoding by default, and for gzip, deflate and br when decoding', async () => {
    const plain = guarded(ok);
    await plain.fetchFn('https://mcp.example.com/mcp');
    expect(plain.calls[0].headers).toMatchObject({ 'accept-encoding': 'identity' });
    const decoding = guarded(ok);
    await decoding.fetchFn('https://mcp.example.com/mcp', { decodeBody: true });
    expect(decoding.calls[0].headers).toMatchObject({ 'accept-encoding': 'gzip, deflate, br' });
  });

  it('settles on the first complete event without waiting for the stream to close', async () => {
    const { fetchFn, destroyed } = guarded(() => ({ status: 200, headers: SSE, chunks: ['event: message\ndata: {"a":1}\n\n'], open: true }));
    const res = await fetchFn('https://mcp.example.com/mcp', { settleEarly: true });
    expect(await res.text()).toBe('event: message\ndata: {"a":1}\n\n');
    expect(destroyed.count).toBe(1);
  });

  it('keeps reading past a priming or comment event until one carries data', async () => {
    const { fetchFn } = guarded(() => ({
      status: 200,
      headers: SSE,
      chunks: ['id: 0\ndata:\n\n', ': ping\n\n', 'data: {"a":1}\n\n'],
      open: true,
    }));
    const res = await fetchFn('https://mcp.example.com/mcp', { settleEarly: true });
    expect(await res.text()).toContain('data: {"a":1}');
  });

  it('waits for the rest of an event that is not complete yet', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE, chunks: ['data: {"a":', '1}\n', '\n'], open: true }));
    expect(await (await fetchFn('https://mcp.example.com/mcp', { settleEarly: true })).text()).toBe('data: {"a":1}\n\n');
  });

  it('counts a CRLF pair split across chunks, and a leading BOM', async () => {
    const { fetchFn, destroyed } = guarded(() => ({
      status: 200,
      headers: SSE,
      chunks: [Buffer.from('\uFEFFdata: {"a":1}\r'), '\n\r', '\n'],
      open: true,
    }));
    const res = await fetchFn('https://mcp.example.com/mcp', { settleEarly: true });
    // The CR that ends the event is enough; the LF after it is not waited for.
    expect(await res.text()).toBe('data: {"a":1}\r\n\r');
    expect(destroyed.count).toBe(1);
  });

  it('does not settle early on a body that is not an event stream, or without the option', async () => {
    const json = guarded(() => ({ status: 200, headers: { 'content-type': 'application/json' }, chunks: ['data: x\n\n', '{}'] }));
    expect(await (await json.fetchFn('https://mcp.example.com/mcp', { settleEarly: true })).text()).toBe('data: x\n\n{}');
    const plain = guarded(() => ({ status: 200, headers: SSE, chunks: ['data: x\n\n', 'data: y\n\n'] }));
    expect(await (await plain.fetchFn('https://mcp.example.com/mcp')).text()).toBe('data: x\n\ndata: y\n\n');
  });

  const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  it.each([
    ['gzip', zlib.gzipSync(payload)],
    ['deflate', zlib.deflateSync(payload)],
    ['deflate', zlib.deflateRawSync(payload)],
    ['br', zlib.brotliCompressSync(payload)],
  ])('decodes a %s body', async (encoding, body) => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': encoding }, chunks: [body] }));
    const res = await fetchFn('https://mcp.example.com/mcp', { decodeBody: true });
    expect(await res.text()).toBe(payload);
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('leaves an encoded body alone when decoding was not asked for', async () => {
    const body = zlib.gzipSync(payload);
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, chunks: [body] }));
    const res = await fetchFn('https://mcp.example.com/mcp');
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
  });

  it.each(['gzip', 'deflate', 'br'])('rejects a malformed %s body as bad_response', async (encoding) => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': encoding }, chunks: ['this is not compressed'] }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
  });

  it('rejects an encoding it did not ask for as bad_response', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'zstd' }, chunks: ['x'] }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
  });

  it.each([
    ['gzip', (b: Buffer) => zlib.gzipSync(b)],
    ['deflate', (b: Buffer) => zlib.deflateSync(b)],
    ['br', (b: Buffer) => zlib.brotliCompressSync(b)],
  ])('rejects a %s body that is small compressed but larger than maxBytes decoded as too_large', async (encoding, compress) => {
    const body = compress(Buffer.alloc(100_000, 'a'));
    expect(body.length).toBeLessThan(1000);
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': encoding }, chunks: [body] }), { maxBytes: 1000 });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('too_large');
  });
});

describe('createGuardedFetch event streams in discovery', () => {
  const SSE = { 'content-type': 'text/event-stream' };
  const INIT = { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'S', version: '1' } } };
  const SERVER = 'https://mcp.example.com/mcp';
  const event = (value: unknown) => `event: message\ndata: ${JSON.stringify(value)}\n\n`;

  it('ends the wait at the event the predicate accepts, not at an earlier notification', async () => {
    const note = { jsonrpc: '2.0', method: 'notifications/message', params: {} };
    const { fetchFn, destroyed } = guarded(() => ({ status: 200, headers: SSE, chunks: [event(note), event(INIT)], open: true }));
    const res = await fetchFn(SERVER, { settleEarly: (data) => JSON.parse(data).id === 1 });
    expect(await res.text()).toBe(event(note) + event(INIT));
    expect(destroyed.count).toBe(1);
  });

  it('accepts a notification followed by the initialize result through discovery', async () => {
    const note = { jsonrpc: '2.0', method: 'notifications/message', params: {} };
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE, chunks: [event(note), event(INIT)], open: true }));
    expect(await discoverMcpAuth(SERVER, fetchFn)).toEqual({ needsLogin: false });
  });

  it.each([
    ['gzip', (b: Buffer) => b],
    ['br', (b: Buffer) => zlib.brotliCompressSync(b)],
  ])('settles on a complete %s event while the stream stays open', async (encoding, compress) => {
    const first = Buffer.from(event(INIT));
    let body: Buffer;
    if (encoding === 'gzip') {
      const gz = zlib.createGzip();
      const parts: Buffer[] = [];
      gz.on('data', (d: Buffer) => parts.push(d));
      gz.write(first);
      gz.flush();
      await new Promise((done) => setTimeout(done, 20));
      body = Buffer.concat(parts);
    } else {
      body = compress(first);
    }
    const { fetchFn, destroyed } = guarded(
      () => ({ status: 200, headers: { ...SSE, 'content-encoding': encoding }, chunks: [body], open: true }),
      { timeoutMs: 1000 },
    );
    expect(await discoverMcpAuth(SERVER, fetchFn)).toEqual({ needsLogin: false });
    expect(destroyed.count).toBeGreaterThanOrEqual(1);
  });

  it('refuses a complete event stream that stays open past the size limit when decoded', async () => {
    const body = zlib.gzipSync(Buffer.from('data: ' + 'a'.repeat(100_000)));
    const { fetchFn } = guarded(() => ({ status: 200, headers: { ...SSE, 'content-encoding': 'gzip' }, chunks: [body], open: true }), { maxBytes: 1000 });
    expect(await refusal(fetchFn(SERVER, { settleEarly: true, decodeBody: true }))).toBe('too_large');
  });

  it('still reaches the login challenge when a 401 carries a body that cannot be decoded', async () => {
    const challenge = 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"';
    const { fetchFn } = guarded(() => ({ status: 401, headers: { 'content-encoding': 'gzip', 'www-authenticate': challenge }, chunks: [] }));
    const res = await fetchFn(SERVER, { decodeBody: true, settleEarly: true });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(challenge);
    expect(await res.text()).toBe('');
  });

  it('stops the decoder when an encoded response is reset', async () => {
    const destroy = vi.spyOn(zlib.Gunzip.prototype, 'destroy');
    try {
      const body = zlib.gzipSync(Buffer.from('data: ' + 'a'.repeat(100_000)));
      const { fetchFn } = guarded(() => ({
        status: 200,
        headers: { ...SSE, 'content-encoding': 'gzip' },
        chunks: [body.subarray(0, 20)],
        resetAfter: true,
      }));
      expect(await refusal(fetchFn(SERVER, { settleEarly: true, decodeBody: true }))).toBe('network');
      expect(destroy).toHaveBeenCalled();
    } finally {
      destroy.mockRestore();
    }
  });

  it.each([401, 500])('does not decode a %i body, so a small gzip body cannot hide the status', async (status) => {
    const body = zlib.gzipSync(Buffer.alloc(100_000, 'a'));
    const { fetchFn } = guarded(() => ({ status, headers: { 'content-encoding': 'gzip', 'www-authenticate': 'Bearer' }, chunks: [body] }), { maxBytes: 5000 });
    const res = await fetchFn(SERVER, { decodeBody: true, settleEarly: true });
    expect(res.status).toBe(status);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('refuses an empty encoded body on a successful event stream', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { ...SSE, 'content-encoding': 'gzip' }, chunks: [] }));
    expect(await refusal(fetchFn(SERVER, { settleEarly: true, decodeBody: true }))).toBe('bad_response');
  });

  it('reads an event stream in work that grows linearly with the bytes received', async () => {
    const chunks = Array.from({ length: 8000 }, () => 'data: ' + 'x'.repeat(122) + '\n');
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE, chunks }));
    const started = Date.now();
    const res = await fetchFn(SERVER, { settleEarly: true });
    expect((await res.text()).length).toBe(8000 * 129);
    // Re-scanning the whole body for every chunk took several seconds here.
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('status lines from a real HTTP parser', () => {
  /* A loopback server that answers every connection with `raw` bytes, so the
     response goes through Node's own HTTP parser as a hostile server's would. */
  async function serveRaw(raw: string): Promise<{ port: number; close: () => void }> {
    const server = net.createServer((socket) => {
      socket.once('data', () => socket.end(Buffer.from(raw, 'latin1')));
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    return { port: (server.address() as net.AddressInfo).port, close: () => server.close() };
  }

  it.each(['600 X', '999 X', '101 Switching Protocols'])(
    'rejects %s instead of throwing outside the promise',
    async (statusLine) => {
      const uncaught: Error[] = [];
      const onUncaught = (err: Error) => uncaught.push(err);
      process.on('uncaughtException', onUncaught);
      const { port, close } = await serveRaw(`HTTP/1.1 ${statusLine}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`);
      try {
        const request = ((options: https.RequestOptions, onResponse: (res: http.IncomingMessage) => void) =>
          http.request({ ...options, protocol: 'http:', agent: undefined, port }, onResponse)) as unknown as typeof https.request;
        const fetchFn = createGuardedFetch({
          request,
          isAllowedAddress: () => true,
          lookupAll: answers('127.0.0.1'),
          timeoutMs: 2000,
        });
        expect(await refusal(fetchFn('https://hostile.example/'))).toBe('bad_response');
        expect(uncaught).toEqual([]);
      } finally {
        close();
        process.off('uncaughtException', onUncaught);
      }
    },
  );
});

describe('checkPublicHttpsUrl', () => {
  it('accepts an https URL on a public host and returns it parsed', async () => {
    const url = await checkPublicHttpsUrl('https://auth.example.com/authorize', { lookupAll: answers('93.184.215.14') });
    expect(url.href).toBe('https://auth.example.com/authorize');
  });

  it.each([
    ['http://auth.example.com/authorize', 'not_https'],
    ['https://169.254.169.254/authorize', 'not_public'],
    ['https://[::1]/authorize', 'not_public'],
  ])('refuses %s', async (url, code) => {
    expect(await refusal(checkPublicHttpsUrl(url, { lookupAll: answers('93.184.215.14') }))).toBe(code);
  });

  it('refuses a name that resolves privately', async () => {
    expect(await refusal(checkPublicHttpsUrl('https://auth.example.com/', { lookupAll: answers('10.0.0.5') }))).toBe('not_public');
  });
});
