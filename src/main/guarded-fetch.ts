/*
 * A fetch for requests the main process makes to a server the user typed in:
 * a custom MCP server's login metadata, registration, token and revocation
 * endpoints. Every request goes only to a public https address checked at
 * that moment, and the socket connects to exactly the address that was
 * checked, so a name cannot pass the check and then point somewhere private.
 *
 * Built on Node's `https`, not `electron.net`: Chromium's network stack picks
 * the address itself and may go through a proxy, so it cannot promise which
 * address is dialed. The cost is that a network which only lets traffic out
 * through a proxy cannot reach custom servers; that failure has its own code.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import * as https from 'node:https';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import * as zlib from 'node:zlib';
import { isIpLiteralHost, isPublicAddress } from './public-address';

export type GuardedFetchErrorCode =
  | 'invalid_url'
  | 'not_https'
  | 'not_public'
  | 'unresolved'
  | 'too_large'
  | 'timeout'
  | 'bad_response'
  | 'network'
  | 'proxy_network';

/** A refused or failed guarded request. Never a `TypeError`, so callers that
 *  treat a `TypeError` as "nothing there" cannot mistake a refusal for it. */
export class GuardedFetchError extends Error {
  constructor(readonly code: GuardedFetchErrorCode, message: string) {
    super(message);
    this.name = 'GuardedFetchError';
  }
}

export interface GuardedRequestInit {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: string | URLSearchParams;
  /** Resolve as soon as a successful answer is a text/event-stream with a
   *  complete event that ends the wait, without waiting for the stream to
   *  close (an MCP server may keep it open). `true` ends it at the first event
   *  that carries data; a function ends it at the first event whose data it
   *  accepts. The body is then what arrived so far, decoded. */
  settleEarly?: boolean | ((eventData: string) => boolean);
  /** Ask for and decode gzip, deflate and br bodies. The decoded size is held
   *  to `maxBytes` too. Without it the request asks for no encoding. */
  decodeBody?: boolean;
}

export type GuardedFetch = (input: string | URL, init?: GuardedRequestInit) => Promise<Response>;

export interface GuardedFetchOptions {
  /** Every address a name resolves to. Defaults to the system resolver. */
  lookupAll?: (hostname: string) => Promise<LookupAddress[]>;
  /** Replaced only by tests that serve from loopback. */
  isAllowedAddress?: (address: string) => boolean;
  /** Replaced only by tests. */
  request?: typeof https.request;
  /** Whether the system would send `url` through a proxy; asked only after a
   *  connection fails, to tell a proxy-only network from an outage. */
  proxyConfigured?: (url: URL) => Promise<boolean>;
  maxBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const NO_BODY_STATUSES = new Set([204, 205, 304]);

/** A fetch that sends requests only to checked public https addresses. */
export function createGuardedFetch(options: GuardedFetchOptions = {}): GuardedFetch {
  const lookupAll = options.lookupAll ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  const isAllowed = options.isAllowedAddress ?? isPublicAddress;
  const request = options.request ?? https.request;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (input, init = {}) => {
    const url = parseUrl(input);
    const addresses = await checkedAddresses(url.hostname, lookupAll, isAllowed);
    try {
      return await send(request, url, init, addresses, maxBytes, timeoutMs);
    } catch (err) {
      if (err instanceof GuardedFetchError && err.code === 'network' && options.proxyConfigured) {
        if (await options.proxyConfigured(url).catch(() => false)) {
          throw new GuardedFetchError('proxy_network', 'this network only allows connections through a proxy');
        }
      }
      throw err;
    }
  };
}

/** Throws a `GuardedFetchError` unless `input` is an https URL whose host is,
 *  or resolves only to, public addresses. For an address the main process
 *  hands to the browser rather than fetches itself (an authorize endpoint). */
export async function checkPublicHttpsUrl(
  input: string | URL,
  options: Pick<GuardedFetchOptions, 'lookupAll' | 'isAllowedAddress'> = {},
): Promise<URL> {
  const url = parseUrl(input);
  const lookupAll = options.lookupAll ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  await checkedAddresses(url.hostname, lookupAll, options.isAllowedAddress ?? isPublicAddress);
  return url;
}

function parseUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(String(input));
  } catch {
    throw new GuardedFetchError('invalid_url', 'that is not a valid address');
  }
  if (url.protocol !== 'https:') throw new GuardedFetchError('not_https', 'the address must use https');
  if (url.username || url.password) throw new GuardedFetchError('invalid_url', 'the address must not carry a user or password');
  if (!url.hostname) throw new GuardedFetchError('invalid_url', 'the address has no host');
  return url;
}

/* The addresses a request may use: the IP literal itself, or every address
   the name resolves to, all of them public. `URL` already writes integer, hex
   and short IPv4 forms as dotted addresses and international names in their
   ASCII form, so `hostname` is the form checked and dialed. */
async function checkedAddresses(
  hostname: string,
  lookupAll: (hostname: string) => Promise<LookupAddress[]>,
  isAllowed: (address: string) => boolean,
): Promise<LookupAddress[]> {
  if (isIpLiteralHost(hostname)) {
    const address = bare(hostname);
    if (!isAllowed(address)) throw new GuardedFetchError('not_public', 'that address is not on the public internet');
    return [{ address, family: isIP(address) }];
  }
  let answers: LookupAddress[];
  try {
    answers = await lookupAll(hostname);
  } catch {
    throw new GuardedFetchError('unresolved', 'that host name does not resolve');
  }
  if (answers.length === 0) throw new GuardedFetchError('unresolved', 'that host name does not resolve');
  if (!answers.every((answer) => isAllowed(answer.address))) {
    throw new GuardedFetchError('not_public', 'that host is not on the public internet');
  }
  return answers;
}

function bare(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/* `lookup` for the request: hands back only the addresses already checked, so
   the socket cannot connect anywhere else. Node skips it for an IP literal
   host, which `checkedAddresses` has checked already. */
function pinnedLookup(addresses: LookupAddress[]): NonNullable<RequestOptions['lookup']> {
  return ((_hostname: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (lookupOptions?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }) as NonNullable<RequestOptions['lookup']>;
}

function headerRecord(headers: GuardedRequestInit['headers']): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, name) => {
      record[name] = value;
    });
    return record;
  }
  return { ...headers };
}

function send(
  request: typeof https.request,
  url: URL,
  init: GuardedRequestInit,
  addresses: LookupAddress[],
  maxBytes: number,
  timeoutMs: number,
): Promise<Response> {
  const host = bare(url.hostname);
  const body = init.body === undefined ? undefined : String(init.body);
  const headers: Record<string, string> = { ...headerRecord(init.headers), host: url.host };
  if (!Object.keys(headers).some((name) => name.toLowerCase() === 'accept-encoding')) {
    headers['accept-encoding'] = init.decodeBody ? 'gzip, deflate, br' : 'identity';
  }
  if (body !== undefined && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-length')) {
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  const requestOptions: RequestOptions & { servername?: string } = {
    protocol: 'https:',
    hostname: host,
    port: url.port ? Number(url.port) : 443,
    path: `${url.pathname}${url.search}`,
    method: init.method ?? 'GET',
    headers,
    lookup: pinnedLookup(addresses),
    // Its own agent: no shared pool, no proxy, no connection reused for another host.
    agent: new https.Agent({ keepAlive: false }),
  };
  if (!isIpLiteralHost(url.hostname)) requestOptions.servername = host;

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let teardown: (() => void) | null = null; // set once a response has a decoder to stop
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      teardown?.();
      outcome();
    };
    const req = request(requestOptions, (res: IncomingMessage) => {
      const chunks: Buffer[] = []; // the body handed back: decoded when `decode`
      const rawChunks: Buffer[] = []; // wire bytes held for a one-shot decode
      let wire = 0;
      let out = 0;
      const status = res.statusCode ?? 0;
      const okStatus = status >= 200 && status < 300;
      const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
      const decode = init.decodeBody === true && encoding !== '' && encoding !== 'identity';
      const early = !!init.settleEarly && okStatus && /^text\/event-stream\b/i.test(String(res.headers['content-type'] ?? ''));
      const matches = typeof init.settleEarly === 'function' ? init.settleEarly : (data: string) => data.trim() !== '';
      const scanner = early ? createSseScanner(matches) : null;
      const utf8 = new StringDecoder('utf8');
      let decoder: zlib.Gunzip | zlib.Inflate | zlib.InflateRaw | zlib.BrotliDecompress | null = null;
      let held: Buffer[] = [];
      teardown = () => decoder?.destroy();
      // A refusal's body is never read, so it is never decompressed either.
      const skipBody = decode && !okStatus;
      const stop = () => {
        req.destroy();
        decoder?.destroy();
      };
      const fail = (code: GuardedFetchErrorCode, message: string) => {
        stop();
        finish(() => reject(new GuardedFetchError(code, message)));
      };
      const resolveWith = (raw: Buffer) =>
        finish(() => {
          // Node's parser passes any three-digit status, and `Response` throws
          // outside 200-599; thrown here it would escape every handler.
          try {
            resolve(toResponse(res, raw, decode));
          } catch {
            reject(new GuardedFetchError('bad_response', 'the server sent a response that is not valid HTTP'));
          }
        });
      // Takes body bytes (decoded ones when `decode`); true once the answer is settled.
      const accept = (buf: Buffer): boolean => {
        if (settled) return true;
        out += buf.length;
        if (out > maxBytes) {
          fail('too_large', 'the server sent more than the allowed size');
          return true;
        }
        chunks.push(buf);
        if (scanner && scanner.feed(utf8.write(buf))) {
          stop();
          resolveWith(Buffer.concat(chunks));
          return true;
        }
        return false;
      };
      const feedDecoder = (chunk: Buffer) => {
        let first = chunk;
        if (!decoder) {
          if (encoding === 'deflate') {
            // Zlib-wrapped or raw deflate: tell them apart by the two-byte header.
            held.push(chunk);
            first = Buffer.concat(held);
            if (first.length < 2) return;
            held = [];
            const zlibWrapped = (first[0] & 0x0f) === 8 && ((first[0] << 8) | first[1]) % 31 === 0;
            decoder = zlibWrapped ? zlib.createInflate() : zlib.createInflateRaw();
          } else if (encoding === 'gzip' || encoding === 'x-gzip') {
            decoder = zlib.createGunzip();
          } else if (encoding === 'br') {
            decoder = zlib.createBrotliDecompress();
          } else {
            fail('bad_response', 'the server used an encoding that was not asked for');
            return;
          }
          decoder.on('data', (piece: Buffer) => {
            accept(piece);
          });
          decoder.on('error', (err: unknown) => {
            if ((err as { code?: string } | null)?.code === 'ERR_BUFFER_TOO_LARGE') fail('too_large', 'the server sent more than the allowed size');
            else fail('bad_response', 'the server sent a body that could not be decoded');
          });
          decoder.on('end', () => {
            if (!settled) resolveWith(Buffer.concat(chunks));
          });
        }
        decoder.write(first);
      };
      res.on('data', (chunk: Buffer) => {
        if (settled) return;
        wire += chunk.length;
        if (wire > maxBytes) {
          fail('too_large', 'the server sent more than the allowed size');
          return;
        }
        if (skipBody) return;
        if (!decode) accept(chunk);
        else if (early) feedDecoder(chunk);
        else rawChunks.push(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        if (!decode) {
          resolveWith(Buffer.concat(chunks));
          return;
        }
        if (skipBody) {
          resolveWith(Buffer.alloc(0));
          return;
        }
        if (early) {
          // The decoder's own `end` settles; an empty body or a stub header has none.
          if (decoder) decoder.end();
          else if (held.length > 0) fail('bad_response', 'the server sent a body that could not be decoded');
          else fail('bad_response', 'the server sent a body that could not be decoded');
          return;
        }
        decodeContent(Buffer.concat(rawChunks), encoding, maxBytes).then(
          (decoded) => resolveWith(decoded),
          (err: unknown) => finish(() => reject(err)),
        );
      });
      res.on('error', () => finish(() => reject(new GuardedFetchError('network', 'the connection failed'))));
    });
    const timer = setTimeout(() => {
      req.destroy();
      finish(() => reject(new GuardedFetchError('timeout', 'the server did not answer in time')));
    }, timeoutMs);
    req.on('error', () => finish(() => reject(new GuardedFetchError('network', 'the connection failed'))));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/* An incremental server-sent-event reader. `feed` takes the next piece of
   text and returns true once a complete event whose data satisfies `matches`
   has been seen. It keeps only the unfinished line and the data of the event
   being read, so the work is linear in the bytes received. A leading BOM is
   dropped; CRLF, CR and LF all end a line, including a CRLF split across
   pieces. Comments and events without data (a priming event) never match. */
function createSseScanner(matches: (data: string) => boolean): { feed: (text: string) => boolean } {
  let line = '';
  let data: string[] = [];
  let afterCR = false;
  let started = false;
  const endLine = (): boolean => {
    const current = line;
    line = '';
    if (current === '') {
      const joined = data.join('\n');
      const hadData = data.length > 0;
      data = [];
      return hadData && joined.trim() !== '' && matches(joined);
    }
    if (current.startsWith('data:')) data.push(current.slice(5).replace(/^ /, ''));
    return false;
  };
  return {
    feed(text) {
      let from = 0;
      if (!started && text.length > 0) {
        started = true;
        if (text.charCodeAt(0) === 0xfeff) from = 1;
      }
      let start = from;
      for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (c !== '\r' && c !== '\n') {
          afterCR = false;
          continue;
        }
        line += text.slice(start, i);
        start = i + 1;
        if (c === '\n' && afterCR) {
          afterCR = false;
          continue;
        }
        afterCR = c === '\r';
        if (endLine()) {
          return true;
        }
      }
      line += text.slice(start);
      return false;
    },
  };
}

function decodeContent(raw: Buffer, encoding: string, maxBytes: number): Promise<Buffer> {
  const limit = { maxOutputLength: maxBytes };
  const run = (decoder: (input: Buffer, options: zlib.ZlibOptions | zlib.BrotliOptions, cb: (err: Error | null, out: Buffer) => void) => void, input: Buffer) =>
    new Promise<Buffer>((resolve, reject) => {
      decoder(input, limit, (err, out) => (err ? reject(err) : resolve(out)));
    });
  const fail = (err: unknown): never => {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ERR_BUFFER_TOO_LARGE') throw new GuardedFetchError('too_large', 'the server sent more than the allowed size');
    throw new GuardedFetchError('bad_response', 'the server sent a body that could not be decoded');
  };
  let decoded: Promise<Buffer>;
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      decoded = run(zlib.gunzip, raw);
      break;
    case 'deflate':
      // Servers send zlib-wrapped or raw deflate; accept either.
      decoded = run(zlib.inflate, raw).catch((err) =>
        (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' ? Promise.reject(err) : run(zlib.inflateRaw, raw),
      );
      break;
    case 'br':
      decoded = run(zlib.brotliDecompress, raw);
      break;
    default:
      return Promise.reject(new GuardedFetchError('bad_response', 'the server used an encoding that was not asked for'));
  }
  return decoded.catch(fail);
}

function toResponse(res: IncomingMessage, body: Buffer, decoded = false): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (decoded && (name === 'content-encoding' || name === 'content-length')) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const status = res.statusCode ?? 0;
  if (!Number.isInteger(status) || status < 200 || status > 599) throw new RangeError(`status ${status}`);
  return new Response(NO_BODY_STATUSES.has(status) ? null : new Uint8Array(body), { status, statusText: res.statusMessage, headers });
}
