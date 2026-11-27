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
import { StringDecoder } from 'node:string_decoder';
import { createBrotliDecompress, createGunzip, createInflate, type BrotliDecompress, type Gunzip, type Inflate } from 'node:zlib';
import type { Readable } from 'node:stream';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
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
  /** Answer as soon as the server has sent one complete server-sent event
   *  (ended by an empty line) whose data the function accepts, or, for `true`,
   *  any event with non-blank data, without waiting for the stream to close.
   *  Only for a 2xx, uncompressed `text/event-stream` answer; anything else is
   *  read to its end, so a compressed body is always checked whole. The body
   *  is what arrived up to that event. */
  settleEarly?: boolean | ((data: string) => boolean);
  /** Decode a gzip, deflate or br body. The decoded size, like the raw one, is
   *  held to `maxBytes`; a body that does not decode is `bad_response`.
   *  Without it the body is returned as it arrived. */
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
const SUPPORTED_ENCODINGS = 'gzip, deflate, br';

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
  // A body read as it streams in is simplest to judge uncompressed; ask for
  // only what `decodeBody` can undo.
  if (!hasHeader(headers, 'accept-encoding')) {
    headers['accept-encoding'] = init.decodeBody && !init.settleEarly ? SUPPORTED_ENCODINGS : 'identity';
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
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
    };
    const req = request(requestOptions, (res: IncomingMessage) => {
      // Declared before `fail`, which must stop it: bytes already written to a
      // decoder keep inflating (a few KB of brotli can become a gigabyte) until
      // it is destroyed.
      let decoder: Gunzip | Inflate | BrotliDecompress | null = null;
      const fail = (code: GuardedFetchErrorCode, message: string) => {
        if (decoder) res.unpipe(decoder);
        decoder?.destroy();
        req.destroy();
        res.destroy();
        finish(() => reject(new GuardedFetchError(code, message)));
      };
      // Only a success body is decoded; a refusal keeps its status and headers
      // for the caller, and its body is not read as anything.
      const status = res.statusCode ?? 0;
      const encoding = init.decodeBody && status >= 200 && status < 300 ? contentEncoding(res) : null;
      if (encoding === 'unsupported') {
        fail('bad_response', 'the server sent a body in an encoding that cannot be read');
        return;
      }
      decoder = encoding ? decoderFor(encoding) : null;
      // An unfinished compressed stream cannot be vouched for, so it is read to its end.
      const early = init.settleEarly && !decoder && isEventStream(res);
      const accepts = typeof init.settleEarly === 'function' ? init.settleEarly : (data: string) => data.trim() !== '';
      const events = early ? new EventWatcher(accepts) : null;
      const chunks: Buffer[] = [];
      let size = 0;
      let rawSize = 0;

      const done = (decoded: boolean) =>
        finish(() => {
          // Node's parser passes any three-digit status, and `Response` throws
          // outside 200-599; thrown here it would escape every handler.
          try {
            resolve(toResponse(res, Buffer.concat(chunks), decoded));
          } catch {
            reject(new GuardedFetchError('bad_response', 'the server sent a response that is not valid HTTP'));
          }
        });

      const body: Readable = decoder ? res.pipe(decoder) : res;
      if (decoder) {
        res.on('data', (chunk: Buffer) => {
          rawSize += chunk.length;
          if (rawSize > maxBytes) fail('too_large', 'the server sent more than the allowed size');
        });
        decoder.on('error', () => {
          if (!settled) fail('bad_response', 'the server sent a body that cannot be decoded');
        });
      }
      body.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxBytes) {
          fail('too_large', 'the server sent more than the allowed size');
          return;
        }
        chunks.push(chunk);
        if (events?.complete(chunk)) {
          req.destroy();
          res.destroy();
          done(decoder !== null);
        }
      });
      body.on('end', () => done(decoder !== null));
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

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function isEventStream(res: IncomingMessage): boolean {
  const status = res.statusCode ?? 0;
  return status >= 200 && status < 300 && String(res.headers['content-type'] ?? '').toLowerCase().includes('text/event-stream');
}

/** The one encoding the body carries, `null` for none, or `unsupported`. */
function contentEncoding(res: IncomingMessage): 'gzip' | 'deflate' | 'br' | 'unsupported' | null {
  const value = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (!value || value === 'identity') return null;
  if (value === 'gzip' || value === 'x-gzip') return 'gzip';
  if (value === 'deflate' || value === 'br') return value;
  return 'unsupported';
}

function decoderFor(encoding: 'gzip' | 'deflate' | 'br'): Gunzip | Inflate | BrotliDecompress {
  if (encoding === 'gzip') return createGunzip();
  if (encoding === 'deflate') return createInflate();
  return createBrotliDecompress();
}

/** An incremental server-sent-events parser. Lines end in LF, CR or CRLF (a
 *  CRLF split across chunks included); an event is dispatched only by an empty
 *  line, so an event cut off at the end of the stream is never returned. */
export class SseParser {
  private line = '';
  private afterCR = false;
  private started = false;
  private data: string[] = [];

  /** The data of every event completed by `text`; data lines join with a newline. */
  push(text: string): string[] {
    const events: string[] = [];
    for (const ch of text) {
      if (!this.started) {
        this.started = true;
        if (ch === '\ufeff') continue;
      }
      if (this.afterCR) {
        this.afterCR = false;
        if (ch === '\n') continue;
      }
      if (ch === '\r' || ch === '\n') {
        this.afterCR = ch === '\r';
        const event = this.endLine();
        if (event !== null) events.push(event);
      } else {
        this.line += ch;
      }
    }
    return events;
  }

  private endLine(): string | null {
    const line = this.line;
    this.line = '';
    if (line === '') {
      const data = this.data;
      this.data = [];
      return data.length > 0 ? data.join('\n') : null;
    }
    if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
    else if (line === 'data') this.data.push('');
    return null;
  }
}

/* Tells when the stream so far holds a whole event whose data is the answer.
   A comment, or an event the caller does not accept (a priming event, a
   notification), is not the answer and does not count. */
class EventWatcher {
  private readonly decoder = new StringDecoder('utf8');
  private readonly parser = new SseParser();

  constructor(private readonly accepts: (data: string) => boolean) {}

  complete(chunk: Buffer): boolean {
    return this.parser.push(this.decoder.write(chunk)).some((data) => this.accepts(data));
  }
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
