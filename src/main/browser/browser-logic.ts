// Pure decision logic for the embedded browser (see CLAUDE.md §Embedded
// browser). No electron, no fs, no network — every function maps inputs to
// outputs so it can be unit-tested directly, like update-logic.ts.
// browser-manager.ts owns the I/O (WebContentsViews, persistence) and
// delegates here.

import type { BrowserState, BrowserTabInfo, TopSite } from '../../shared/browser-types';

// ---------------------------------------------------------------------------
// Omnibox input → URL + scheme allowlist
// ---------------------------------------------------------------------------

/** Thrown for client-fixable request errors (blocked url, resource caps).
 *  The bridge maps these to 400 instead of 500. */
export class BrowserRequestError extends Error {}

/** The only URLs a tab may load: http(s), about:blank, or '' (blank
 *  start-page tab). Enforced by the manager BEFORE any model patch and in
 *  ensureView — will-navigate never fires for programmatic loadURL, so this
 *  is the real guard (the will-navigate handler is defense-in-depth). */
export function isAllowedTabUrl(url: string): boolean {
  if (!url) return true;
  return /^https?:\/\//i.test(url) || url === 'about:blank';
}

/** Normalize omnibox text into a loadable URL.
 *  - '' (or whitespace) → '' (blank start-page tab)
 *  - host:port (localhost:3000, 127.0.0.1:8080, example.com:8080) → scheme
 *    prepended: http for localhost/127.0.0.1, https for other domains —
 *    must run BEFORE the scheme pass-through since `localhost:` also matches
 *    the scheme regex
 *  - already-schemed input (https:, about:blank, …) passes through untouched —
 *    scheme safety is enforced by isAllowedTabUrl at the load sites, not here
 *  - text with spaces or without a dot is a search query → Google search
 *  - anything else is a bare domain → https://<domain> */
export function normalizeUrlInput(input: string): string {
  const text = input.trim();
  if (!text) return '';
  const hostPort = /^([a-zA-Z0-9.-]+):(\d{1,5})([/?#].*)?$/.exec(text);
  if (hostPort && Number(hostPort[2]) <= 65535) {
    const [, host, port, rest = ''] = hostPort;
    const scheme = host === 'localhost' || host === '127.0.0.1' ? 'http' : 'https';
    return `${scheme}://${host}:${port}${rest}`;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return text;
  if (text.includes(' ') || !text.includes('.')) {
    return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  }
  return `https://${text}`;
}

// ---------------------------------------------------------------------------
// Tab model transitions (serializable; views live in a manager side-map)
// ---------------------------------------------------------------------------

let tabCounter = 0;

/** Hard cap on open tabs — unbounded tab creation would exhaust memory
 *  (one renderer process per tab view). */
export const MAX_TABS = 50;

/** nanoid-style tab id: time + counter + random, URL-safe, no crypto import
 *  (ids only need uniqueness within one app run, not secrecy). */
export function generateTabId(): string {
  tabCounter = (tabCounter + 1) % 1296; // 36^2
  const time = Date.now().toString(36);
  const seq = tabCounter.toString(36).padStart(2, '0');
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `t${time}${seq}${rand}`;
}

export function createTabModel(partial?: Partial<BrowserTabInfo>): BrowserTabInfo {
  return {
    id: generateTabId(),
    title: '',
    url: '',
    favicon: null,
    isLoading: false,
    loadProgress: 0,
    canGoBack: false,
    canGoForward: false,
    error: null,
    isAgentControlled: false,
    ...partial,
  };
}

export function emptyBrowserState(): BrowserState {
  return { tabs: [], activeTabId: null, viewVisible: false };
}

export function addTab(state: BrowserState, tab: BrowserTabInfo, activate: boolean): BrowserState {
  return {
    ...state,
    tabs: [...state.tabs, tab],
    activeTabId: activate || state.activeTabId === null ? tab.id : state.activeTabId,
  };
}

/** Remove a tab. When the removed tab was active, activate the nearest
 *  survivor — the tab that slid into its slot (was to its right), else the
 *  one before it; closing the last tab leaves the state empty. */
export function removeTab(state: BrowserState, tabId: string): BrowserState {
  const index = state.tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== tabId);
  let activeTabId = state.activeTabId;
  if (activeTabId === tabId) {
    const next = tabs[index] ?? tabs[index - 1] ?? null;
    activeTabId = next ? next.id : null;
  }
  return { ...state, tabs, activeTabId };
}

export function activateTab(state: BrowserState, tabId: string): BrowserState {
  if (!state.tabs.some((t) => t.id === tabId)) return state;
  return { ...state, activeTabId: tabId };
}

export function patchTab(
  state: BrowserState,
  tabId: string,
  patch: Partial<BrowserTabInfo>,
): BrowserState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...patch, id: t.id } : t)),
  };
}

// ---------------------------------------------------------------------------
// Top-sites merge (Chrome import + cowork history)
// ---------------------------------------------------------------------------

/** Dedupe key for a URL: origin + path (trailing slash stripped), so
 *  `https://a.com/x?y=1` and `https://a.com/x` are the same site. Unparseable
 *  URLs key on their raw text. */
export function topSiteKey(url: string): string {
  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/\/+$/, '');
    return `${u.origin}${pathname}`;
  } catch {
    return url;
  }
}

/** Merge Chrome-imported and cowork-history top sites: dedupe by origin+path,
 *  visits summed, cowork entries win ties, sorted by visits desc. A site seen
 *  in both sources reports source 'cowork' (the user got there via us too). */
export function mergeTopSites(chrome: TopSite[], cowork: TopSite[], limit: number): TopSite[] {
  const byKey = new Map<string, TopSite & { cowork: boolean }>();
  for (const site of [...chrome, ...cowork]) {
    const key = topSiteKey(site.url);
    const existing = byKey.get(key);
    const isCowork = site.source === 'cowork';
    if (!existing) {
      byKey.set(key, { ...site, visits: Math.max(0, site.visits), cowork: isCowork });
    } else {
      existing.visits += Math.max(0, site.visits);
      existing.cowork = existing.cowork || isCowork;
      // Prefer a non-empty title from the cowork side, then any non-empty.
      if (isCowork && site.title) existing.title = site.title;
      else if (!existing.title && site.title) existing.title = site.title;
      if (existing.cowork) existing.source = 'cowork';
    }
  }
  const merged = [...byKey.values()];
  merged.sort((a, b) => {
    if (b.visits !== a.visits) return b.visits - a.visits;
    if (a.cowork !== b.cowork) return a.cowork ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return merged
    .slice(0, Math.max(0, limit))
    .map(({ url, title, visits, source }) => ({ url, title, visits, source }));
}

// ---------------------------------------------------------------------------
// Chrome history row parsing (sqlite3 -json output)
// ---------------------------------------------------------------------------

const PER_DOMAIN_CAP = 10;

/** Parse `/usr/bin/sqlite3 -json` output (a JSON array of row objects) into
 *  TopSites. Drops non-http schemes, empty titles, and caps each domain at 10
 *  entries. Malformed JSON → [] (import degrades, never throws). */
export function parseChromeHistoryRows(json: string): TopSite[] {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const sites: TopSite[] = [];
  const perDomain = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { url, title, visit_count } = row as { url?: unknown; title?: unknown; visit_count?: unknown };
    if (typeof url !== 'string' || typeof title !== 'string') continue;
    if (!url.startsWith('http')) continue; // chrome://, chrome-extension://, file://, about:
    if (!title.trim()) continue;
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      continue;
    }
    const count = perDomain.get(origin) ?? 0;
    if (count >= PER_DOMAIN_CAP) continue;
    perDomain.set(origin, count + 1);
    sites.push({
      url,
      title,
      visits: typeof visit_count === 'number' && visit_count > 0 ? Math.floor(visit_count) : 1,
      source: 'chrome',
    });
  }
  return sites;
}

// ---------------------------------------------------------------------------
// URL redaction + history
// ---------------------------------------------------------------------------

/** origin + path only — query strings and hashes carry tokens/searches and
 *  must never hit logs or the on-disk history. Unparseable → '' (log nothing). */
export function redactUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

export interface HistoryEntry {
  url: string;   // already redacted (origin + path)
  title: string; // '' until the title event patches it
  ts: number;
}

export const HISTORY_CAP = 2000;

/** Append an entry and prune to the cap (oldest first). Returns a new list. */
export function appendHistoryEntry(
  list: HistoryEntry[],
  entry: HistoryEntry,
  cap: number = HISTORY_CAP,
): HistoryEntry[] {
  const next = [...list, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Patch the most recent entry for `url` that still has an empty title — the
 *  title event lands after did-navigate, so history is recorded with '' and
 *  filled in here. Returns a new list (unchanged when nothing matches). */
export function patchHistoryTitle(list: HistoryEntry[], url: string, title: string): HistoryEntry[] {
  if (!title) return list;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].url === url) {
      if (list[i].title) return list;
      const next = [...list];
      next[i] = { ...next[i], title };
      return next;
    }
  }
  return list;
}

/** Aggregate raw history entries into cowork-sourced TopSites (visit counts
 *  per redacted URL, newest non-empty title wins). */
export function historyToTopSites(history: HistoryEntry[]): TopSite[] {
  const byUrl = new Map<string, TopSite>();
  for (const entry of history) {
    const existing = byUrl.get(entry.url);
    if (existing) {
      existing.visits += 1;
      if (entry.title) existing.title = entry.title;
    } else {
      byUrl.set(entry.url, { url: entry.url, title: entry.title, visits: 1, source: 'cowork' });
    }
  }
  return [...byUrl.values()];
}

// ---------------------------------------------------------------------------
// Persisted tabs.json validation (restore on launch)
// ---------------------------------------------------------------------------

export interface PersistedTabs {
  tabs: Array<{ id: string; url: string; title: string; favicon: string | null }>;
  activeTabId: string | null;
}

/** Validate a parsed tabs.json into a PersistedTabs, or null when the shape
 *  is unusable. Per-tab junk is dropped rather than failing the whole file —
 *  including tabs whose url fails the scheme allowlist (a hand-edited or
 *  pre-guard file must never resurrect a file:/javascript: tab);
 *  error/isLoading are runtime-only and never persisted. */
export function sanitizePersistedTabs(raw: unknown): PersistedTabs | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as { tabs?: unknown; activeTabId?: unknown };
  if (!Array.isArray(data.tabs)) return null;
  const tabs: PersistedTabs['tabs'] = [];
  for (const t of data.tabs) {
    if (!t || typeof t !== 'object') continue;
    const tab = t as { id?: unknown; url?: unknown; title?: unknown; favicon?: unknown };
    if (typeof tab.id !== 'string' || !tab.id) continue;
    const url = typeof tab.url === 'string' ? tab.url : '';
    if (!isAllowedTabUrl(url)) continue;
    tabs.push({
      id: tab.id,
      url,
      title: typeof tab.title === 'string' ? tab.title : '',
      favicon: sanitizeFaviconUrl(typeof tab.favicon === 'string' ? tab.favicon : null),
    });
  }
  const activeTabId =
    typeof data.activeTabId === 'string' && tabs.some((t) => t.id === data.activeTabId)
      ? data.activeTabId
      : (tabs[0]?.id ?? null);
  return { tabs, activeTabId };
}

/** Validate a parsed history.json into HistoryEntry[] (never throws). */
export function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const entry = e as { url?: unknown; title?: unknown; ts?: unknown };
    if (typeof entry.url !== 'string' || !entry.url) continue;
    out.push({
      url: entry.url,
      title: typeof entry.title === 'string' ? entry.title : '',
      ts: typeof entry.ts === 'number' ? entry.ts : 0,
    });
  }
  return out.length > HISTORY_CAP ? out.slice(out.length - HISTORY_CAP) : out;
}

// ---------------------------------------------------------------------------
// Small shared validators (favicons, download filenames)
// ---------------------------------------------------------------------------

const FAVICON_MAX_BYTES = 256 * 1024;

/** Accept only http(s) or data: favicons under 256 KB — anything else
 *  (file:, javascript:, giant payloads) becomes null. */
export function sanitizeFaviconUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.length > FAVICON_MAX_BYTES) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  return null;
}

/** Pick a non-colliding download filename: `name`, then `base (1).ext`,
 *  `base (2).ext`, … `exists` receives candidate names (no directory). */
export function dedupeDownloadName(filename: string, exists: (name: string) => boolean): string {
  if (!exists(filename)) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`; // pathological — still unique-ish
}
