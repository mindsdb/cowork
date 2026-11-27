import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import type { LookupAddress } from 'node:dns';
import cases from './__fixtures__/public-address-cases.json';
import { checkPublicHttpsUrl, createGuardedFetch, GuardedFetchError, SseParser, type GuardedFetchOptions } from './guarded-fetch';

type Responder = (options: https.RequestOptions & { servername?: string }, body: string) =>
  | { status: number; headers?: Record<string, string>; chunks?: Array<string | Buffer>; keepOpen?: boolean }
  | 'error'
  | 'hang';

// Every decoder `guarded-fetch` makes, so a test can check it is stopped.
const decoders = vi.hoisted(() => ({ made: [] as Array<{ destroyed: boolean }> }));
vi.mock('node:zlib', async (importActual) => {
  const actual = await importActual<typeof import('node:zlib')>();
  const recorded = <A extends unknown[], T extends { destroyed: boolean }>(make: (...args: A) => T) =>
    (...args: A): T => {
      const decoder = make(...args);
      decoders.made.push(decoder);
      return decoder;
    };
  return {
    ...actual,
    createGunzip: recorded(actual.createGunzip),
    createInflate: recorded(actual.createInflate),
    createBrotliDecompress: recorded(actual.createBrotliDecompress),
  };
});

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
        if (!outcome.keepOpen) res.end();
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

describe('settleEarly', () => {
  const SSE = { 'content-type': 'text/event-stream' };
  const MESSAGE = '{"jsonrpc":"2.0","id":1,"result":{}}';

  it('answers on the first complete event without waiting for the stream to close', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE, chunks: [`data: ${MESSAGE}\n\n`, 'data: never read\n\n'], keepOpen: true }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: true });
    expect(await response.text()).toContain(MESSAGE);
  });

  it('waits for the event to be complete', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE, chunks: [`data: ${MESSAGE}\n`], keepOpen: true }), { timeoutMs: 50 });
    // The line has ended but not the event, so only the timeout ends the wait.
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { settleEarly: true }))).toBe('timeout');
  });

  it('sees a CRLF event end split across chunks', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE, chunks: [`data: ${MESSAGE}\r`, '\n', '\r', '\n'], keepOpen: true }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: true });
    expect(await response.text()).toContain(MESSAGE);
  });

  it('sees past a leading BOM and a split multibyte character', async () => {
    const bytes = Buffer.from(`\ufeffdata: {"a":"é"}\n\n`);
    const cut = bytes.indexOf(0xc3) + 1;
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE, chunks: [bytes.subarray(0, cut), bytes.subarray(cut)], keepOpen: true }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: true });
    expect(await response.text()).toContain('"é"');
  });

  it('skips comment and priming events, and settles on the one with data', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE, chunks: [': hi\n\nid: 0\ndata:\n\n', `data: ${MESSAGE}\n\n`], keepOpen: true }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: true });
    expect(await response.text()).toContain(MESSAGE);
  });

  it('keeps reading past events the predicate does not accept', async () => {
    const wanted = (data: string) => data.includes('"id":1');
    const { fetchFn } = guarded(() => ({
      status: 200,
      headers: SSE,
      chunks: ['data: {"method":"notifications/message","params":{"x":1}}\n\n', `data: ${MESSAGE}\n\n`],
      keepOpen: true,
    }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: wanted });
    expect(await response.text()).toContain(MESSAGE);
  });

  it('sees an event ended by LF lines and a CRLF blank line, and a CR then LF split across chunks', async () => {
    const mixed = guarded(() => ({ status: 200, headers: SSE, chunks: [`data: ${MESSAGE}\n\r\n`], keepOpen: true }));
    expect(await (await mixed.fetchFn('https://mcp.example.com/mcp', { settleEarly: true })).text()).toContain(MESSAGE);
    const other = guarded(() => ({ status: 200, headers: SSE, chunks: [`data: ${MESSAGE}\r\n\r`, '\n'], keepOpen: true }));
    expect(await (await other.fetchFn('https://mcp.example.com/mcp', { settleEarly: true })).text()).toContain(MESSAGE);
  });

  it('reads any other answer to its end', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-type': 'application/json' }, chunks: ['data: x\n\n', 'rest'] }));
    const response = await fetchFn('https://mcp.example.com/mcp', { settleEarly: true });
    expect(await response.text()).toBe('data: x\n\nrest');
  });

  it('still enforces maxBytes on a stream that never completes an event', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: SSE, chunks: ['data: aaaaaaaaaa', 'aaaaaaaaaa'], keepOpen: true }), { maxBytes: 20 });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { settleEarly: true }))).toBe('too_large');
  });
});

describe('decodeBody', () => {
  const text = JSON.stringify({ hello: 'world'.repeat(50) });
  const encoders: Array<[string, (b: Buffer) => Buffer]> = [
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ];

  it('asks for identity unless it can decode, and keeps a header the caller set', async () => {
    const plain = guarded(ok);
    await plain.fetchFn('https://mcp.example.com/mcp');
    expect(plain.calls[0].headers).toMatchObject({ 'accept-encoding': 'identity' });
    const decoding = guarded(ok);
    await decoding.fetchFn('https://mcp.example.com/mcp', { decodeBody: true });
    expect(decoding.calls[0].headers).toMatchObject({ 'accept-encoding': 'gzip, deflate, br' });
    const own = guarded(ok);
    await own.fetchFn('https://mcp.example.com/mcp', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(own.calls[0].headers).toMatchObject({ 'Accept-Encoding': 'gzip' });
    expect(own.calls[0].headers).not.toHaveProperty('accept-encoding');
  });

  it.each(encoders)('decodes a %s body', async (name, encode) => {
    const body = encode(Buffer.from(text));
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': name }, chunks: [body.subarray(0, 5), body.subarray(5)] }));
    const response = await fetchFn('https://mcp.example.com/mcp', { decodeBody: true });
    expect(await response.text()).toBe(text);
    expect(response.headers.get('content-encoding')).toBeNull();
  });

  it('does not settle early on a compressed event stream: it reads to the end and checks it', async () => {
    const body = gzipSync(Buffer.from('data: {"a":1}\n\n'));
    const headers = { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' };
    const open = guarded(() => ({ status: 200, headers, chunks: [body], keepOpen: true }), { timeoutMs: 50 });
    expect(await refusal(open.fetchFn('https://mcp.example.com/mcp', { decodeBody: true, settleEarly: true }))).toBe('timeout');
    const finite = guarded(() => ({ status: 200, headers, chunks: [body] }));
    const response = await finite.fetchFn('https://mcp.example.com/mcp', { decodeBody: true, settleEarly: true });
    expect(await response.text()).toBe('data: {"a":1}\n\n');
  });

  it('rejects a compressed event stream whose gzip trailer is missing, with early settle on', async () => {
    const body = gzipSync(Buffer.from('data: {"a":1}\n\n'));
    const headers = { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' };
    const { fetchFn } = guarded(() => ({ status: 200, headers, chunks: [body.subarray(0, body.length - 8)] }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true, settleEarly: true }))).toBe('bad_response');
  });

  it.each([401, 403])('hands back a %i with an encoding it cannot decode, undecoded', async (status) => {
    const { fetchFn } = guarded(() => ({ status, headers: { 'content-encoding': 'zstd', 'www-authenticate': 'Bearer' }, chunks: ['x'] }));
    const response = await fetchFn('https://mcp.example.com/mcp', { decodeBody: true });
    expect(response.status).toBe(status);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it.each(encoders)('rejects a malformed %s body as bad_response', async (name) => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': name }, chunks: ['this is not compressed'] }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
  });

  it('rejects a truncated gzip body as bad_response', async () => {
    const body = gzipSync(Buffer.from(text));
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, chunks: [body.subarray(0, body.length - 10)] }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
  });

  it('rejects an encoding it cannot decode as bad_response', async () => {
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'zstd' }, chunks: ['x'] }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
  });

  it('rejects a body that is small compressed but larger than maxBytes decoded', async () => {
    const body = gzipSync(Buffer.alloc(10_000, 'a'));
    expect(body.length).toBeLessThan(200);
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, chunks: [body] }), { maxBytes: 1000 });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('too_large');
  });

  it('rejects a compressed body larger than maxBytes as sent', async () => {
    const noise = Buffer.from(Array.from({ length: 400 }, (_, i) => (i * 7919) % 251));
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, chunks: [gzipSync(noise)] }), { maxBytes: 100 });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('too_large');
  });

  it.each(encoders)('destroys the %s decoder when it refuses a body as too large decoded', async (name, encode) => {
    decoders.made.length = 0;
    const body = encode(Buffer.alloc(10_000, 'a'));
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': name }, chunks: [body] }), { maxBytes: 1000 });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('too_large');
    expect(decoders.made).toHaveLength(1);
    expect(decoders.made[0].destroyed).toBe(true);
  });

  it('destroys the decoder when it refuses a body as too large as sent', async () => {
    decoders.made.length = 0;
    const noise = Buffer.from(Array.from({ length: 400 }, (_, i) => (i * 7919) % 251));
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, chunks: [gzipSync(noise)] }), { maxBytes: 100 });
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('too_large');
    expect(decoders.made).toHaveLength(1);
    expect(decoders.made[0].destroyed).toBe(true);
  });

  it.each(encoders)('destroys the %s decoder when it refuses a malformed body', async (name) => {
    decoders.made.length = 0;
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': name }, chunks: ['this is not compressed'] }));
    expect(await refusal(fetchFn('https://mcp.example.com/mcp', { decodeBody: true }))).toBe('bad_response');
    expect(decoders.made).toHaveLength(1);
    expect(decoders.made[0].destroyed).toBe(true);
  });

  it('returns the body as it arrived without decodeBody', async () => {
    const body = gzipSync(Buffer.from(text));
    const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, chunks: [body] }));
    const response = await fetchFn('https://mcp.example.com/mcp');
    expect(Buffer.from(await response.arrayBuffer()).equals(body)).toBe(true);
  });
});

describe('SseParser', () => {
  const feed = (...parts: string[]) => {
    const parser = new SseParser();
    return parts.flatMap((part) => parser.push(part));
  };

  it('dispatches only on an empty line, whatever the line endings', () => {
    expect(feed('data: a\n\n')).toEqual(['a']);
    expect(feed('data: a\r\n\r\n')).toEqual(['a']);
    expect(feed('data: a\r\r')).toEqual(['a']);
    expect(feed('data: a\n\r\n')).toEqual(['a']);
    expect(feed('data: a\r\n\n')).toEqual(['a']);
  });

  it('discards an event that is not ended by an empty line', () => {
    expect(feed('data: a\n')).toEqual([]);
    expect(feed('data: a')).toEqual([]);
  });

  it('joins data lines, drops comments, and survives splits and a BOM', () => {
    expect(feed('\ufeff: c\r', '\ndata: a\r', '\ndata: b\r', '\n\r', '\n')).toEqual(['a\nb']);
  });
});
