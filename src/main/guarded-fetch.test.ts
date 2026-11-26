import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as zlib from 'node:zlib';
import type { LookupAddress } from 'node:dns';
import cases from './__fixtures__/public-address-cases.json';
import { checkPublicHttpsUrl, createGuardedFetch, SseReader, GuardedFetchError, type GuardedFetchOptions } from './guarded-fetch';

type Responder = (options: https.RequestOptions & { servername?: string }, body: string) =>
  | { status: number; headers?: Record<string, string>; chunks?: Array<string | Buffer>; open?: boolean }
  | 'error'
  | 'hang';

/* A stand-in for https.request: records the options it was called with and
   plays back what `responder` returns, without opening a socket. */
function fakeRequest(responder: Responder) {
  const calls: Array<https.RequestOptions & { servername?: string }> = [];
  const request = ((options: https.RequestOptions & { servername?: string }, onResponse: (res: unknown) => void) => {
    calls.push(options);
    const req = new EventEmitter() as EventEmitter & { write: (c: string) => void; end: () => void; destroy: () => void };
    let written = '';
    req.write = (chunk: string) => {
      written += chunk;
    };
    req.destroy = () => {};
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
        for (const chunk of outcome.chunks ?? []) res.write(chunk);
        if (!outcome.open) res.end();
      });
    };
    return req;
  }) as unknown as typeof https.request;
  return { request, calls };
}

function answers(...addresses: string[]): (hostname: string) => Promise<LookupAddress[]> {
  return async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

function guarded(responder: Responder, options: Partial<GuardedFetchOptions> = {}) {
  const fake = fakeRequest(responder);
  const fetchFn = createGuardedFetch({ lookupAll: answers('93.184.215.14'), request: fake.request, ...options });
  return { fetchFn, calls: fake.calls };
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

const SSE_HEADERS = { 'content-type': 'text/event-stream' };
const anyEvent = () => true;
const EVENT = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n';

describe('settleEarly', () => {
  it('answers on the first complete event, without waiting for the stream to close', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE_HEADERS, chunks: [EVENT], open: true }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: anyEvent });
    expect(await response.text()).toBe(EVENT);
  });

  it('waits past a priming or comment event for one that carries data', async () => {
    const { fetchFn } = guarded(() => ({
      status: 200,
      headers: SSE_HEADERS,
      chunks: ['id: 1\ndata:\n\n', ': ping\n\n', EVENT],
      open: true,
    }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: anyEvent });
    expect(await response.text()).toContain('"result"');
  });

  it('does not answer on an event that is not closed yet', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE_HEADERS, chunks: ['data: {"a":1}\n'], open: true }), { timeoutMs: 30 });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { settleEarly: anyEvent }))).toBe('timeout');
  });

  it('reads a CRLF that is split across chunks', async () => {
    const { fetchFn } = guarded(() => ({
      status: 200,
      headers: SSE_HEADERS,
      chunks: ['data: {"a":1}\r', '\n\r', '\n'],
      open: true,
    }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: anyEvent });
    // The second CR already closes the event; the LF after it need not arrive.
    expect(await response.text()).toBe('data: {"a":1}\r\n\r');
  });

  it('reads a stream that starts with a byte order mark', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE_HEADERS, chunks: ['\uFEFF' + EVENT], open: true }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: anyEvent });
    expect(await response.text()).toContain('"result"');
  });

  it('does not settle early on a body that is not an event stream', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-type': 'application/json' }, chunks: [EVENT], open: true }), {
      timeoutMs: 30,
    });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { settleEarly: anyEvent }))).toBe('timeout');
  });

  it('still counts what arrived against the size limit', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE_HEADERS, chunks: ['data: ' + 'x'.repeat(100)], open: true }), { maxBytes: 50 });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { settleEarly: anyEvent }))).toBe('too_large');
  });
});

describe('settleEarly with a predicate', () => {
  it('waits for the event the predicate accepts, not the first one with data', async () => {
    const note = 'data: {"method":"notifications/message"}\n\n';
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE_HEADERS, chunks: [note, EVENT], open: true }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: (d) => d.includes('"result"') });
    expect(await response.text()).toBe(note + EVENT);
  });

  it('answers on a CR-terminated event while the stream is open', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE_HEADERS, chunks: ['data: {"a":1}\r\r'], open: true }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: anyEvent });
    expect(await response.text()).toBe('data: {"a":1}\r\r');
  });

  it('does not stall on a large fragmented stream that never matches', async () => {
    const chunks = Array.from({ length: 4096 }, () => 'data: ' + 'x'.repeat(120) + '\n');
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE_HEADERS, chunks }), { maxBytes: 1024 * 1024 });
    const started = Date.now();
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: () => false });
    expect((await response.text()).length).toBeGreaterThan(500_000);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('SseReader', () => {
  const read = (...parts: string[]) => {
    const seen: string[] = [];
    const reader = new SseReader((d) => (seen.push(d), false));
    parts.forEach((part) => reader.write(part));
    reader.end();
    return seen;
  };

  it('counts an event left open at the end of the stream', () => {
    expect(read('data: a\n')).toEqual(['a']);
    expect(read('data: a')).toEqual(['a']);
  });

  it('reads LF, CR and CRLF endings, split anywhere', () => {
    expect(read('data: a\r\r', 'data: b\n\n', 'data: c\r', '\n\r', '\n')).toEqual(['a', 'b', 'c']);
  });

  it('joins data lines and skips empty events and comments', () => {
    expect(read(': hi\n\ndata:\n\ndata: a\ndata:b\n\n')).toEqual(['a\nb']);
  });
});

describe('decodeBody', () => {
  it('reads a zlib-wrapped deflate body whose first chunk holds one header byte', async () => {
    const body = zlib.deflateSync('hello world'.repeat(10));
    const { fetchFn } = guarded(() => ({
      status: 200,
      headers: { 'content-encoding': 'deflate' },
      chunks: [body.subarray(0, 1), body.subarray(1)],
    }));
    expect(await (await fetchFn('https://mcp.example.com/mcp', { decodeBody: true })).text()).toBe('hello world'.repeat(10));
  });

  it('keeps the status and headers of an error answer whose body uses an unknown encoding', async () => {
    const { fetchFn } = guarded(() => ({
      status: 401,
      headers: { 'content-encoding': 'zstd', 'www-authenticate': 'Bearer' },
      chunks: ['not decodable'],
    }));
    const response = await fetchFn('https://mcp.example.com/mcp', { decodeBody: true });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  const text = JSON.stringify({ hello: 'world'.repeat(20) });
  const encoders: Array<[string, (data: string) => Buffer]> = [
    ['gzip', (d) => zlib.gzipSync(d)],
    ['deflate', (d) => zlib.deflateSync(d)],
    ['deflate', (d) => zlib.deflateRawSync(d)],
    ['br', (d) => zlib.brotliCompressSync(d)],
  ];

  it('asks for an uncompressed answer unless told to decode', async () => {
    const { fetchFn, calls } = guarded(ok);
    await fetchFn('https://mcp.example.com/mcp');
    await fetchFn('https://mcp.example.com/mcp', { decodeBody: true });
    expect((calls[0].headers as Record<string, string>)['accept-encoding']).toBe('identity');
    expect((calls[1].headers as Record<string, string>)['accept-encoding']).toBe('gzip, deflate, br');
  });

  it.each(encoders)('decodes a %s body', async (encoding, encode) => {
    const body = encode(text);
    const { fetchFn } = guarded(() => ({
      status: 200,
      headers: { 'content-type': 'application/json', 'content-encoding': encoding, 'content-length': String(body.length) },
      chunks: [body.subarray(0, 5), body.subarray(5)],
    }));
    const response = await fetchFn('https://mcp.example.com/mcp', { decodeBody: true });
    expect(await response.text()).toBe(text);
    expect(response.headers.get('content-encoding')).toBeNull();
  });

  it('settles early on an event inside a compressed stream', async () => {
    const { fetchFn } = guarded(() => ({
      status: 200,
      headers: { ...SSE_HEADERS, 'content-encoding': 'gzip' },
      chunks: [zlib.gzipSync(EVENT, { finishFlush: zlib.constants.Z_SYNC_FLUSH })],
      open: true,
    }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: anyEvent, decodeBody: true });
    expect(await response.text()).toBe(EVENT);
  });

  it('refuses a malformed compressed body', async () => {
    const { fetchFn } = guarded(() => ({
      status: 200,
      headers: { 'content-encoding': 'gzip' },
      chunks: ['this is not gzip data at all'],
    }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
  });

  it('refuses a truncated compressed body', async () => {
    const body = zlib.gzipSync(text);
    const { fetchFn } = guarded(() => ({
      status: 200,
      headers: { 'content-encoding': 'gzip' },
      chunks: [body.subarray(0, body.length - 8)],
    }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
  });

  it('refuses a compression it cannot read', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'zstd' }, chunks: ['x'] }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
  });

  it('refuses a body that is small compressed but over the limit once decoded', async () => {
    const body = zlib.gzipSync('a'.repeat(100_000));
    expect(body.length).toBeLessThan(1000);
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, chunks: [body] }), { maxBytes: 10_000 });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('too_large');
  });

  it('accepts a compressed body whose decoded size is within the limit', async () => {
    const body = zlib.gzipSync('a'.repeat(5_000));
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, chunks: [body] }), { maxBytes: 10_000 });
    expect((await (await fetchFn('https://mcp.example.com/mcp', { decodeBody: true })).text()).length).toBe(5_000);
  });

  it.each(['gzip', 'deflate', 'br'])('refuses a zero-byte body declared as %s', async (encoding) => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': encoding }, chunks: [] }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
  });

  it.each(encoders)('accepts a properly encoded empty %s payload as empty', async (encoding, encode) => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': encoding }, chunks: [encode('')] }));
    expect(await (await fetchFn('https://mcp.example.com/mcp', { decodeBody: true })).text()).toBe('');
  });

  it('allows an empty 204 that carries a compression header', async () => {
    const { fetchFn } = guarded(() => ({ status: 204, headers: { 'content-encoding': 'gzip' }, chunks: [] }));
    expect((await fetchFn('https://mcp.example.com/mcp', { decodeBody: true })).status).toBe(204);
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
