/*
 * The in-app browser's profile and the lockdown every one of its views gets.
 *
 * One profile per account: session.fromPath(<userData>/browser-profiles/<key>),
 * the key named by the account's data root, in a folder made owner-only
 * (0700), shared by the account's organizations, since sign-ins belong to the
 * person. It sits under the app's userData because Electron 44 and later keep
 * a fromPath session's cookies across a restart only there (the sandboxed
 * network service writes nowhere else); a profile under the account data root
 * lost every sign-in at each restart. A launch that can't name its account
 * gets an in-memory profile instead: its account root is random per launch,
 * so no later launch would reach that folder, or clear it. The views never
 * use the app's default session, whose request hook hands the local server's
 * key to loopback requests, and never inherit the main window's preferences.
 *
 * Each view runs sandboxed with context isolation and web security on, no
 * Node, no preload and no DevTools (DevTools would also detach the agent's
 * debugger), and with Blink's AutomationControlled and SharedWorker features
 * off. Every permission and device request is denied. Top-level navigation is
 * http and https only; the LAN stays reachable, which is a main reason to
 * browse from the person's own machine. The request listener cancels a page's
 * requests to the local server's port or the bridge's port, apart from the
 * two kinds it never sees (PAGE_REQUEST_FILTER_URLS says which). The user
 * agent loses the app and Electron tokens.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { Session, WebContents, WebPreferences } from 'electron';
import { diagnostic } from '../shared/diagnostics';
import { QUARANTINE_PREFIX } from './account-data';

export const BROWSER_PROFILES_DIR = 'browser-profiles';

/** Whether `accountRoot` is a launch's quarantine root, which can't be named
    again by any later launch: its name is random per launch. */
export function isQuarantinedAccountRoot(accountRoot: string): boolean {
  return path.basename(accountRoot).startsWith(QUARANTINE_PREFIX);
}

function profileKey(accountRoot: string): string {
  return createHash('sha256').update(path.resolve(accountRoot)).digest('hex').slice(0, 16);
}

/** The account's profile folder under the app's userData: one per account
    data root, so each account keeps its own sign-ins. */
export function browserProfilePath(userDataDir: string, accountRoot: string): string {
  return path.join(userDataDir, BROWSER_PROFILES_DIR, profileKey(accountRoot));
}

/** The in-memory partition for a quarantined account root. It has no
    `persist:` prefix, so its sign-ins end when the app quits. */
export function browserMemoryPartition(accountRoot: string): string {
  return `browser-${profileKey(accountRoot)}`;
}

/** Makes the profile folder and pins it owner-only past the umask. */
export function ensureProfileDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (error) {
    diagnostic('main.browser-profile', 'WARNING', 'browser_profile_could_not_restrict_its_folder', error);
  }
}

/** Every browser view's preferences. */
export function browserViewPreferences(session: Session): WebPreferences {
  return {
    session,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    devTools: false,
    /* A shared worker's WebSockets have no frame, so they would skip the
       profile's request listener; most sites check for SharedWorker first. */
    disableBlinkFeatures: 'AutomationControlled,SharedWorker',
    // The agent works in tabs the pane doesn't show.
    backgroundThrottling: false,
    // A page that opens dialogs in a loop gets Chromium's "stop this page" choice.
    safeDialogs: true,
    navigateOnDragDrop: false,
    spellcheck: false,
  };
}

const KEPT_PRODUCTS = new Set(['Mozilla', 'AppleWebKit', 'Chrome', 'Safari', 'Version', 'Mobile']);

/** The user agent without the app's and Electron's own product tokens. */
export function browserUserAgent(electronUserAgent: string): string {
  const parts = electronUserAgent.match(/\([^)]*\)|\S+/g) ?? [];
  return parts.filter((part) => part.startsWith('(') || KEPT_PRODUCTS.has(part.split('/')[0])).join(' ');
}

/* The profile's one request listener cancels three kinds of request: to the
   protected loopback ports, to MindsHub's own hosts and to link-local
   metadata addresses. It sees what a page's frames and dedicated workers
   request, their WebSockets included. Two kinds skip it: a service worker's
   WebSockets, since Electron hooks only a WebSocket that belongs to a frame,
   and any WebTransport session, which Electron doesn't hook at all. Shared
   workers, whose WebSockets would skip it too, are off in every view
   (browserViewPreferences). Everything else, the LAN and other local servers
   included, stays reachable, because the network is the person's own. */
export const PAGE_REQUEST_FILTER_URLS = ['http', 'https', 'ws', 'wss'].map((scheme) => `${scheme}://*/*`);

/* MindsHub's own hosts: every name under mindshub.ai except the apex and
   docs.mindshub.ai, and all of mdb.ai and 4nton.ai, apexes included. A
   MindsHub session in this browser would let the agent mint keys or approve
   its own cards. */
const MINDSHUB_WHOLE_ZONES = ['mdb.ai', '4nton.ai'];
const MINDSHUB_AI_OPEN = new Set(['mindshub.ai', 'docs.mindshub.ai']);

/** Whether `hostname` is one of MindsHub's own hosts: by exact name or
    dot-delimited suffix, lowercased and without a trailing dot, the rule
    anton's `is_mindshub_host` uses. `mindshub.ai.evil.com` is not. */
export function isMindsHubHost(hostname: string): boolean {
  const name = bareHost(hostname);
  if (MINDSHUB_WHOLE_ZONES.some((zone) => name === zone || name.endsWith(`.${zone}`))) return true;
  return name.endsWith('.mindshub.ai') && !MINDSHUB_AI_OPEN.has(name);
}

const METADATA_NAMES = new Set(['metadata', 'metadata.google.internal']);

/* AWS's IPv6 metadata address, in the one spelling both `URL` and Chromium's
   resolver write it. It sits in fc00::/7 beside the LAN's own private
   addresses, so only this exact address is refused. */
const AWS_IPV6_METADATA = 'fd00:ec2::254';

/** Whether `hostname` (as `URL` renders it, or an address a resolver gives)
    is where cloud metadata services listen: 169.254.0.0/16, its IPv4-mapped
    IPv6 forms, fe80::/10, AWS's fd00:ec2::254, or a metadata service's
    name. */
export function isLinkLocalHost(hostname: string): boolean {
  const host = bareHost(hostname);
  if (METADATA_NAMES.has(host)) return true;
  const v4 = mappedIpv4(host) ?? (IPV4.test(host) ? host : null);
  if (v4) return v4.startsWith('169.254.');
  return /^fe[89ab][0-9a-f]:/.test(host) || host === AWS_IPV6_METADATA;
}

/** Why a page may not reach `address`, or null when it may: MindsHub's own
    hosts and link-local addresses, whatever the scheme. An address that
    doesn't parse is refused. */
export function refusedDestination(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return 'that is not a valid address';
  }
  if (isMindsHubHost(url.hostname)) return "MindsDB's sign-in and app hosts are blocked in this browser";
  if (isLinkLocalHost(url.hostname)) return 'link-local and cloud metadata addresses are blocked in this browser';
  return null;
}

/* A host name as the checks compare it: lowercased, every trailing dot gone,
   and an IPv6 literal without its brackets. */
function bareHost(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/* The IPv4 address inside an IPv4-mapped IPv6 address, in either the dotted
   form a resolver gives or the hex form `URL` gives, else null. */
function mappedIpv4(host: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Whether `hostname` is an IP literal rather than a name. */
export function isIpLiteral(hostname: string): boolean {
  const host = bareHost(hostname);
  return IPV4.test(host) || host.includes(':');
}

/* Whether a host is this machine: a localhost name, 127.0.0.0/8, 0.0.0.0, ::1,
   :: or their IPv4-mapped forms. */
function isLoopback(hostname: string): boolean {
  const host = bareHost(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = mappedIpv4(host) ?? (IPV4.test(host) ? host : null);
  if (v4) return v4.startsWith('127.') || v4 === '0.0.0.0';
  return host === '::1' || host === '::';
}

/* The port a URL reaches, its scheme's default when it names none. */
function portOf(url: URL): number {
  return Number(url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80));
}

/** Whether a page request goes to one of the protected loopback ports. */
export function reachesProtectedPort(address: string, ports: number[]): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (!isLoopback(url.hostname)) return false;
  return ports.includes(portOf(url));
}

/** Whether a top-level page may navigate to `address`. */
export function navigationAllowed(address: string): boolean {
  if (address === 'about:blank') return true;
  try {
    const { protocol } = new URL(address);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ProfileOptions {
  /** The local server's and the bridge's ports, read on every request. */
  protectedPorts(): number[];
}

/* A DNS name is checked by what it answers, through the profile's own
   resolver, whose host cache the page's request then uses too:
   - an answer in 169.254.0.0/16 (or its mapped form), or AWS's
     fd00:ec2::254, is where cloud metadata listens, so the name is refused
     like the address. An fe80 answer is not:
     LAN names (a printer, a NAS) often answer one beside their IPv4 address,
     and the LAN stays reachable;
   - a loopback answer is refused only on a protected port.
   A resolver failure lets the request through, where it fails on its own. A
   name that changes its answer between this check and the page's own lookup
   (DNS rebinding) is an accepted limit. */
export interface ResolvedRisk {
  metadata: boolean;
  loopback: boolean;
}

function isMetadataAddress(address: string): boolean {
  const host = bareHost(address);
  const v4 = mappedIpv4(host) ?? (IPV4.test(host) ? host : null);
  if (v4 !== null) return v4.startsWith('169.254.');
  return host === AWS_IPV6_METADATA;
}

export async function resolvedRisk(ses: Session, hostname: string): Promise<ResolvedRisk> {
  const clean = { metadata: false, loopback: false };
  if (typeof ses.resolveHost !== 'function') return clean;
  try {
    const { endpoints } = await ses.resolveHost(bareHost(hostname));
    return {
      metadata: endpoints.some((endpoint) => isMetadataAddress(endpoint.address)),
      loopback: endpoints.some((endpoint) => isLoopback(endpoint.address)),
    };
  } catch {
    return clean;
  }
}

/** Locks down a browser profile's session. Run once per session. */
export function configureBrowserSession(ses: Session, options: ProfileOptions): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  ses.on('select-hid-device', (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on('select-serial-port', (event, _ports, _contents, callback) => {
    event.preventDefault();
    callback('');
  });
  ses.on('select-usb-device', (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.webRequest.onBeforeRequest({ urls: PAGE_REQUEST_FILTER_URLS }, (details, callback) => {
    if (reachesProtectedPort(details.url, options.protectedPorts()) || refusedDestination(details.url) !== null) {
      callback({ cancel: true });
      return;
    }
    const url = new URL(details.url);
    if (isIpLiteral(url.hostname)) {
      callback({});
      return;
    }
    void resolvedRisk(ses, url.hostname).then((risk) => {
      callback({ cancel: risk.metadata || (risk.loopback && options.protectedPorts().includes(portOf(url))) });
    });
  });
  ses.setUserAgent(browserUserAgent(ses.getUserAgent()));
}

/** Keeps one view's top-level navigation to http, https and about:blank. */
export function guardNavigation(contents: WebContents): void {
  contents.on('will-navigate', (event, address) => {
    if (!navigationAllowed(address)) event.preventDefault();
  });
  contents.on('will-redirect', (event) => {
    if (event.isMainFrame && !navigationAllowed(event.url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
