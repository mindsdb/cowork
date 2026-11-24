import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { LookupAddress } from 'node:dns';
import cases from './__fixtures__/public-address-cases.json';
import { checkPublicHttpsUrl, createGuardedFetch, GuardedFetchError, type GuardedFetchOptions } from './guarded-fetch';

type Responder = (options: https.RequestOptions & { servername?: string }, body: string) =>
  | { status: number; headers?: Record<string, string>; chunks?: Array<string | Buffer>; open?: boolean }
  | 'error'
  | 'hang';

/* A stand-in for https.request: records the options it was called with and
   plays back what `responder` returns, without opening a socket. */
function fakeRequest(responder: Responder) {
  const calls: Array<https.RequestOptions & { servername?: string }> = [];
  let current: EventEmitter | undefined;
  // Like a real socket, destroying emits late error and close events.
  const destroy = vi.fn(() => {
    const res = current;
    queueMicrotask(() => {
      res?.emit('error', new Error('aborted'));
      res?.emit('close');
    });
  });
  const request = ((options: https.RequestOptions & { servername?: string }, onResponse: (res: unknown) => void) => {
    calls.push(options);
    const req = new EventEmitter() as EventEmitter & { write: (c: string) => void; end: () => void; destroy: () => void };
    let written = '';
    req.write = (chunk: string) => {
      written += chunk;
    };
    req.destroy = destroy;
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
        current = res;
        onResponse(res);
        for (const chunk of outcome.chunks ?? []) res.write(chunk);
        if (!outcome.open) res.end();
      });
    };
    return req;
  }) as unknown as typeof https.request;
  return { request, calls, destroy };
}

function answers(...addresses: string[]): (hostname: string) => Promise<LookupAddress[]> {
  return async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

function guarded(responder: Responder, options: Partial<GuardedFetchOptions> = {}) {
  const fake = fakeRequest(responder);
  const fetchFn = createGuardedFetch({ lookupAll: answers('93.184.215.14'), request: fake.request, ...options });
  return { fetchFn, calls: fake.calls, destroy: fake.destroy };
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

  it('sends accept-encoding: identity unless the caller chose one', async () => {
    const { fetchFn, calls } = guarded(ok);
    await fetchFn('https://mcp.example.com/');
    await fetchFn('https://mcp.example.com/', { headers: { 'Accept-Encoding': 'gzip' } });
    expect((calls[0].headers as Record<string, string>)['accept-encoding']).toBe('identity');
    const second = calls[1].headers as Record<string, string>;
    expect(second['Accept-Encoding']).toBe('gzip');
    expect(second['accept-encoding']).toBeUndefined();
  });

  describe('an answer on a stream that stays open', () => {
    const event = 'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n';
    const open: Responder = () => ({ status: 200, headers: { 'content-type': 'text/event-stream' }, chunks: [event], open: true });

    it('resolves with the body once settleEarly accepts it, and drops the stream', async () => {
      const { fetchFn, destroy } = guarded(open, { timeoutMs: 50 });
      const response = await fetchFn('https://mcp.example.com/', {
        settleEarly: ({ contentType, status }) =>
          status === 200 && contentType === 'text/event-stream' ? (text) => text === event : null,
      });
      expect(await response.text()).toBe(event);
      expect(destroy).toHaveBeenCalledTimes(1);
      await new Promise((done) => setTimeout(done, 80)); // the timer must not fire a late rejection or a second destroy
      expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('hands each chunk to the feeder once, never the accumulated prefix', async () => {
      const seen: string[] = [];
      const { fetchFn } = guarded(() => ({ status: 200, chunks: ['a', 'b', 'c'], open: true }), { timeoutMs: 30 });
      await refusal(fetchFn('https://mcp.example.com/', { settleEarly: () => (text) => (seen.push(text), false) }));
      expect(seen).toEqual(['a', 'b', 'c']);
    });

    it('reassembles a multi-byte character split across chunks', async () => {
      const bytes = Buffer.from('é');
      const seen: string[] = [];
      const { fetchFn } = guarded(() => ({ status: 200, chunks: [bytes.subarray(0, 1), bytes.subarray(1)], open: true }), { timeoutMs: 30 });
      await refusal(fetchFn('https://mcp.example.com/', { settleEarly: () => (text) => (seen.push(text), false) }));
      expect(seen.join('')).toBe('é');
    });

    it('does not read the body of an error reply when decodeBody says no, whatever its encoding', async () => {
      const { fetchFn } = guarded(() => ({ status: 401, headers: { 'content-encoding': 'compress', 'www-authenticate': 'Bearer' }, chunks: ['junk'] }));
      const response = await fetchFn('https://mcp.example.com/', { decodeBody: (status) => status < 300 });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(await response.text()).toBe('');
    });

    it('still refuses an undecodable body when decodeBody says yes', async () => {
      const { fetchFn } = guarded(() => ({ status: 200, headers: { 'content-encoding': 'compress' }, chunks: ['junk'] }));
      expect(await refusal(fetchFn('https://mcp.example.com/', { decodeBody: () => true }))).toBe('bad_response');
    });

    it('does not settle early on a non-2xx status', async () => {
      const { fetchFn } = guarded(() => ({ status: 500, chunks: [event], open: true }), { timeoutMs: 20 });
      expect(await refusal(fetchFn('https://mcp.example.com/', { settleEarly: () => () => true }))).toBe('timeout');
    });

    it.each([
      ['without a predicate', undefined],
      ['when the predicate says no', () => false],
      ['when the predicate throws', () => {
        throw new Error('boom');
      }],
    ])('still times out %s', async (_name, feeder) => {
      const settleEarly = feeder && (() => feeder);
      const { fetchFn } = guarded(open, { timeoutMs: 20 });
      expect(await refusal(fetchFn('https://mcp.example.com/', { settleEarly }))).toBe('timeout');
    });

    it('still enforces the size limit before asking', async () => {
      const feeder = vi.fn(() => true);
      const settleEarly = () => feeder;
      const { fetchFn } = guarded(() => ({ status: 200, chunks: ['x'.repeat(2000)], open: true }), { maxBytes: 1000 });
      expect(await refusal(fetchFn('https://mcp.example.com/', { settleEarly }))).toBe('too_large');
      expect(feeder).not.toHaveBeenCalled();
    });
  });

  describe('compressed answers', () => {
    const text = '{"hello":"world"}';
    const encoded = (encoding: string, body: Buffer): Responder => () => ({
      status: 200,
      headers: { 'content-type': 'application/json', 'content-encoding': encoding, 'content-length': String(body.length) },
      chunks: [body],
    });

    it.each(['gzip', 'GZIP', ' x-gzip '])('decodes %s and drops the encoding headers', async (encoding) => {
      const { fetchFn } = guarded(encoded(encoding, gzipSync(text)));
      const response = await fetchFn('https://mcp.example.com/');
      expect(await response.text()).toBe(text);
      expect(response.headers.get('content-encoding')).toBeNull();
      expect(response.headers.get('content-length')).toBeNull();
    });

    it('does not settle early on a compressed stream, but decodes at the end', async () => {
      const settleEarly = vi.fn(() => () => true);
      const { fetchFn } = guarded(encoded('gzip', gzipSync(text)));
      const response = await fetchFn('https://mcp.example.com/', { settleEarly });
      expect(await response.text()).toBe(text);
      expect(settleEarly).not.toHaveBeenCalled();
    });

    it('rejects a decompression bomb as too_large', async () => {
      const bomb = gzipSync('a'.repeat(10_000));
      expect(bomb.length).toBeLessThan(1000);
      const { fetchFn } = guarded(encoded('gzip', bomb), { maxBytes: 1000 });
      expect(await refusal(fetchFn('https://mcp.example.com/'))).toBe('too_large');
    });

    it.each(['compress', 'gzip, br', 'zstd'])('rejects the encoding %s as bad_response', async (encoding) => {
      const { fetchFn } = guarded(encoded(encoding, Buffer.from(text)));
      expect(await refusal(fetchFn('https://mcp.example.com/'))).toBe('bad_response');
    });

    it('rejects a corrupt gzip body as bad_response', async () => {
      const { fetchFn } = guarded(encoded('gzip', Buffer.from('not gzip at all')));
      expect(await refusal(fetchFn('https://mcp.example.com/'))).toBe('bad_response');
    });

    it('accepts a bodiless response that carries a content-encoding header', async () => {
      const { fetchFn } = guarded(() => ({ status: 204, headers: { 'content-encoding': 'gzip' } }));
      expect((await fetchFn('https://mcp.example.com/')).status).toBe(204);
    });
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
