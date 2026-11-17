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
import { isIpLiteralHost, isPublicAddress } from './public-address';

export type GuardedFetchErrorCode =
  | 'invalid_url'
  | 'not_https'
  | 'not_public'
  | 'unresolved'
  | 'too_large'
  | 'timeout'
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
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);

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
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          finish(() => reject(new GuardedFetchError('too_large', 'the server sent more than the allowed size')));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(() => resolve(toResponse(res, Buffer.concat(chunks)))));
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

function toResponse(res: IncomingMessage, body: Buffer): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const status = res.statusCode ?? 502;
  return new Response(NO_BODY_STATUSES.has(status) ? null : new Uint8Array(body), { status, statusText: res.statusMessage, headers });
}
