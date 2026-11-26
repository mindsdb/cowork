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
import * as zlib from 'node:zlib';
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
  /** For a successful `text/event-stream` answer: called with the data of each
   *  complete event; once it returns true the answer is made without waiting
   *  for the stream to close (an MCP server may keep it open). The body is what
   *  arrived by then. */
  settleEarly?: (eventData: string) => boolean;
  /** Decode the body of a successful (2xx) answer in gzip, deflate or br, within
   *  `maxBytes` once decoded. Other statuses keep their raw body, so their status
   *  and headers still arrive. Without it the request asks for an uncompressed
   *  answer and the body is not decoded. */
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
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
    };
    const req = request(requestOptions, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let rawSize = 0;
      let size = 0;
      const fail = (code: GuardedFetchErrorCode, message: string) => {
        req.destroy();
        decoder?.destroy();
        finish(() => reject(new GuardedFetchError(code, message)));
      };
      const complete = () =>
        finish(() => {
          // Node's parser passes any three-digit status, and `Response` throws
          // outside 200-599; thrown here it would escape every handler.
          try {
            resolve(toResponse(res, Buffer.concat(chunks), decoded));
          } catch {
            reject(new GuardedFetchError('bad_response', 'the server sent a response that is not valid HTTP'));
          }
        });

      let decoder: zlib.Gunzip | zlib.Inflate | zlib.InflateRaw | zlib.BrotliDecompress | undefined;
      let decoded = false;
      const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
      const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
      const compressed = init.decodeBody === true && ok && encoding !== '' && encoding !== 'identity';
      if (compressed && !['gzip', 'x-gzip', 'deflate', 'br'].includes(encoding)) {
        fail('bad_response', 'the server used a compression this app cannot read');
        return;
      }
      decoded = compressed;
      const eventStream =
        ok && init.settleEarly !== undefined && String(res.headers['content-type'] ?? '').toLowerCase().includes('text/event-stream');
      // Each byte of the body is read once, so the work stays within `maxBytes`.
      const textDecoder = new TextDecoder('utf-8');
      const sse = eventStream ? new SseReader(init.settleEarly as (data: string) => boolean) : undefined;

      // Bytes of the body proper: what arrived, or what it decodes to.
      const accept = (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxBytes) {
          fail('too_large', 'the server sent more than the allowed size');
          return;
        }
        chunks.push(chunk);
        if (sse?.write(textDecoder.decode(chunk, { stream: true }))) {
          complete();
          req.destroy();
          decoder?.destroy();
        }
      };

      // A "deflate" body is meant to be zlib-wrapped, but some servers send it
      // raw; the choice needs the first two bytes, however they are split.
      let head = Buffer.alloc(0);
      const start = (bytes: Buffer) => {
        decoder = decoderFor(encoding, bytes);
        decoder.on('data', accept);
        decoder.on('end', complete);
        decoder.on('error', () => fail('bad_response', 'the server sent a body that is not valid compressed data'));
        decoder.write(bytes);
      };

      res.on('data', (chunk: Buffer) => {
        rawSize += chunk.length;
        if (rawSize > maxBytes) {
          fail('too_large', 'the server sent more than the allowed size');
          return;
        }
        if (!compressed) {
          accept(chunk);
          return;
        }
        if (decoder) {
          decoder.write(chunk);
          return;
        }
        head = Buffer.concat([head, chunk]);
        if (head.length >= 2 || encoding !== 'deflate') start(head);
      });
      res.on('end', () => {
        if (!compressed) complete();
        else {
          if (!decoder && head.length > 0) start(head);
          if (decoder) decoder.end();
          else if (
            [204, 205].includes(res.statusCode ?? 0) ||
            (init.method ?? 'GET').toUpperCase() === 'HEAD'
          ) {
            complete();
          } else {
            // A declared compression always has framing, even for an empty payload.
            fail('bad_response', 'the server declared a compressed body but sent nothing');
          }
        }
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

function decoderFor(encoding: string, head: Buffer) {
  if (encoding === 'br') return zlib.createBrotliDecompress();
  if (encoding === 'deflate') {
    const wrapped = head.length > 1 && (head[0] & 0x0f) === 8 && ((head[0] << 8) | head[1]) % 31 === 0;
    return wrapped ? zlib.createInflate() : zlib.createInflateRaw();
  }
  return zlib.createGunzip();
}

/** Reads server-sent events one piece of text at a time, each character once.
 *  Lines end in LF, CR or CRLF (a CRLF may be split between pieces); a blank
 *  line closes an event. `onData` gets the data of each event that has any, and
 *  returning true stops the reading. */
export class SseReader {
  private line = '';
  private data: string[] = [];
  private afterCr = false;
  private started = false;
  private stopped = false;

  constructor(private readonly onData: (data: string) => boolean) {}

  /** True once `onData` has returned true. */
  write(text: string): boolean {
    if (this.stopped) return true;
    if (!this.started) {
      if (text === '') return false;
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    let from = 0;
    for (let i = 0; i < text.length && !this.stopped; i++) {
      const c = text.charCodeAt(i);
      if (this.afterCr) {
        this.afterCr = false;
        if (c === 10) {
          from = i + 1;
          continue;
        }
      }
      if (c === 10 || c === 13) {
        this.line += text.slice(from, i);
        from = i + 1;
        this.afterCr = c === 13;
        this.endLine();
      }
    }
    if (!this.stopped) this.line += text.slice(from);
    return this.stopped;
  }

  /** The stream ended: a last line or event left open still counts. */
  end(): boolean {
    if (this.stopped) return true;
    if (this.line !== '') this.endLine();
    if (!this.stopped) this.endLine();
    return this.stopped;
  }

  private endLine(): void {
    const line = this.line;
    this.line = '';
    if (line === '') {
      const data = this.data.join('\n');
      this.data = [];
      if (data !== '' && this.onData(data)) this.stopped = true;
    } else if (line === 'data') {
      this.data.push('');
    } else if (line.startsWith('data:')) {
      this.data.push(line.slice(line.charAt(5) === ' ' ? 6 : 5));
    }
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
