import { describe, it, expect } from 'vitest';
import type { TopSite } from '../../shared/browser-types';
import {
  normalizeUrlInput,
  isAllowedTabUrl,
  generateTabId,
  createTabModel,
  emptyBrowserState,
  addTab,
  removeTab,
  activateTab,
  setTabPinned,
  patchTab,
  topSiteKey,
  mergeTopSites,
  parseChromeHistoryRows,
  redactUrlForLog,
  appendHistoryEntry,
  patchHistoryTitle,
  historyToTopSites,
  sanitizePersistedTabs,
  sanitizeHistory,
  sanitizeFaviconUrl,
  dedupeDownloadName,
  nextZoomFactor,
  classifyControl,
  CONSEQUENTIAL_TERMS,
  detectsAuthWall,
  MAX_TABS,
  HISTORY_CAP,
} from './browser-logic';

describe('normalizeUrlInput', () => {
  it('returns empty for blank input', () => {
    expect(normalizeUrlInput('')).toBe('');
    expect(normalizeUrlInput('   ')).toBe('');
  });

  it('passes through anything that already has a scheme', () => {
    expect(normalizeUrlInput('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normalizeUrlInput('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizeUrlInput('about:blank')).toBe('about:blank');
    // Dangerous schemes pass through HERE — isAllowedTabUrl rejects them at
    // the load sites (normalize's job is shape, not policy).
    expect(normalizeUrlInput('file:///etc/passwd')).toBe('file:///etc/passwd');
  });

  it('treats host:port as a port, not a scheme (http for local, https otherwise)', () => {
    expect(normalizeUrlInput('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeUrlInput('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizeUrlInput('example.com:8080')).toBe('https://example.com:8080');
    expect(normalizeUrlInput('localhost:3000/path?q=1')).toBe('http://localhost:3000/path?q=1');
  });

  it('upgrades bare domains to https', () => {
    expect(normalizeUrlInput('example.com')).toBe('https://example.com');
    expect(normalizeUrlInput('docs.example.com/path?q=1')).toBe('https://docs.example.com/path?q=1');
  });

  it('turns queries (spaces or no dot) into a Google search', () => {
    expect(normalizeUrlInput('hello world')).toBe(
      `https://www.google.com/search?q=${encodeURIComponent('hello world')}`,
    );
    expect(normalizeUrlInput('hello')).toBe(
      `https://www.google.com/search?q=${encodeURIComponent('hello')}`,
    );
  });
});

describe('isAllowedTabUrl', () => {
  it('allows http(s), about:blank, and the empty start-page url', () => {
    expect(isAllowedTabUrl('https://example.com/x?y=1')).toBe(true);
    expect(isAllowedTabUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isAllowedTabUrl('about:blank')).toBe(true);
    expect(isAllowedTabUrl('')).toBe(true);
  });

  it('rejects file:, data:, javascript:, and other schemes', () => {
    expect(isAllowedTabUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedTabUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isAllowedTabUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedTabUrl('mailto:a@b.com')).toBe(false);
    expect(isAllowedTabUrl('chrome://settings')).toBe(false);
    expect(isAllowedTabUrl('ftp://files.example.com')).toBe(false);
  });
});

describe('tab model transitions', () => {
  it('generateTabId produces unique, url-safe ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateTabId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^t[0-9a-z]+$/);
  });

  it('createTabModel fills defaults and honors overrides', () => {
    const blank = createTabModel();
    expect(blank).toMatchObject({
      title: '', url: '', favicon: null, isLoading: false, loadProgress: 0,
      canGoBack: false, canGoForward: false, error: null, isAgentControlled: false,
    });
    const tab = createTabModel({ id: 'fixed', url: 'https://a.com', title: 'A' });
    expect(tab).toMatchObject({ id: 'fixed', url: 'https://a.com', title: 'A' });
  });

  it('addTab appends and activates per the flag (first tab always activates)', () => {
    let s = emptyBrowserState();
    const a = createTabModel({ id: 'a' });
    const b = createTabModel({ id: 'b' });
    const c = createTabModel({ id: 'c' });
    s = addTab(s, a, false);
    expect(s.activeTabId).toBe('a'); // first tab: nothing else could be active
    s = addTab(s, b, false);
    expect(s.activeTabId).toBe('a'); // explicit background tab
    s = addTab(s, c, true);
    expect(s.activeTabId).toBe('c');
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('setTabPinned moves the tab to the pinned/unpinned boundary', () => {
    let s = emptyBrowserState();
    for (const id of ['a', 'b', 'c', 'd']) s = addTab(s, createTabModel({ id }), false);

    // Pin 'c' → last of the pinned region, ahead of everything unpinned.
    s = setTabPinned(s, 'c', true);
    expect(s.tabs.map((t) => t.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(s.tabs[0].pinned).toBe(true);

    // Pin 'b' → appends after the pinned region, keeps relative order.
    s = setTabPinned(s, 'b', true);
    expect(s.tabs.map((t) => t.id)).toEqual(['c', 'b', 'a', 'd']);

    // Pinning an already-pinned tab is a no-op (identity, not a copy).
    const same = setTabPinned(s, 'b', true);
    expect(same).toBe(s);

    // Unpin 'c' → first of the unpinned region, 'b' stays pinned in front.
    s = setTabPinned(s, 'c', false);
    expect(s.tabs.map((t) => t.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(s.tabs[1].pinned).toBe(false);

    // Unknown id is a no-op.
    expect(setTabPinned(s, 'nope', true)).toBe(s);
  });

  it('createTabModel defaults pinned to false and sanitizePersistedTabs keeps it', () => {
    expect(createTabModel().pinned).toBe(false);
    const sanitized = sanitizePersistedTabs({
      tabs: [
        { id: 'a', url: 'https://a.com', title: 'A', favicon: null, pinned: true, zoom: 1 },
        { id: 'b', url: 'https://b.com', title: 'B', favicon: null },
      ],
      activeTabId: 'a',
    });
    expect(sanitized?.tabs).toEqual([
      { id: 'a', url: 'https://a.com', title: 'A', favicon: null, pinned: true, zoom: 1 },
      { id: 'b', url: 'https://b.com', title: 'B', favicon: null, pinned: false, zoom: 1 },
    ]);
  });

  it('removeTab activates the nearest survivor (right, else left, else null)', () => {
    let s = emptyBrowserState();
    for (const id of ['a', 'b', 'c', 'd']) s = addTab(s, createTabModel({ id }), false);

    // Active in the middle → the tab that slid into its slot (right) wins.
    let s2 = activateTab(s, 'b');
    s2 = removeTab(s2, 'b');
    expect(s2.activeTabId).toBe('c');

    // Active at the end → the left neighbor wins.
    let s3 = activateTab(s, 'd');
    s3 = removeTab(s3, 'd');
    expect(s3.activeTabId).toBe('c');

    // Closing an inactive tab leaves the active tab alone.
    let s4 = activateTab(s, 'a');
    s4 = removeTab(s4, 'c');
    expect(s4.activeTabId).toBe('a');

    // Closing the last tab empties the state.
    const one = addTab(emptyBrowserState(), createTabModel({ id: 'solo' }), true);
    const gone = removeTab(one, 'solo');
    expect(gone.tabs).toEqual([]);
    expect(gone.activeTabId).toBeNull();

    // Unknown id is a no-op.
    expect(removeTab(s, 'nope')).toBe(s);
  });

  it('activateTab only activates existing tabs', () => {
    const s = addTab(emptyBrowserState(), createTabModel({ id: 'a' }), true);
    expect(activateTab(s, 'a').activeTabId).toBe('a');
    expect(activateTab(s, 'ghost')).toBe(s);
  });

  it('patchTab patches fields but never the id', () => {
    const s = addTab(emptyBrowserState(), createTabModel({ id: 'a' }), true);
    const s2 = patchTab(s, 'a', { title: 'T', isLoading: true, id: 'hijack' } as never);
    expect(s2.tabs[0]).toMatchObject({ id: 'a', title: 'T', isLoading: true });
    // Original untouched (immutable transitions).
    expect(s.tabs[0].title).toBe('');
  });
});

describe('mergeTopSites', () => {
  const chrome = (url: string, title: string, visits: number): TopSite => ({
    url, title, visits, source: 'chrome',
  });
  const cowork = (url: string, title: string, visits: number): TopSite => ({
    url, title, visits, source: 'cowork',
  });

  it('topSiteKey dedupes by origin+path (query/hash/trailing slash ignored)', () => {
    expect(topSiteKey('https://a.com/x?y=1#z')).toBe('https://a.com/x');
    expect(topSiteKey('https://a.com/x/')).toBe('https://a.com/x');
    expect(topSiteKey('https://a.com')).toBe('https://a.com');
    expect(topSiteKey('not a url')).toBe('not a url');
  });

  it('dedupes across sources, sums visits, and promotes cowork source/title', () => {
    const merged = mergeTopSites(
      [chrome('https://a.com/x?utm=1', 'A via chrome', 3)],
      [cowork('https://a.com/x', 'A', 2)],
      10,
    );
    expect(merged).toEqual([{ url: 'https://a.com/x?utm=1', title: 'A', visits: 5, source: 'cowork' }]);
  });

  it('sorts by visits desc; cowork wins ties; limit applies', () => {
    const merged = mergeTopSites(
      [chrome('https://a.com', 'A', 5), chrome('https://c.com', 'C', 9)],
      [cowork('https://b.com', 'B', 5)],
      2,
    );
    expect(merged.map((s) => s.url)).toEqual(['https://c.com', 'https://b.com']);
  });

  it('keeps any non-empty title when the cowork side has none; clamps junk visits', () => {
    const merged = mergeTopSites(
      [chrome('https://a.com', 'Chrome title', -3)],
      [cowork('https://a.com', '', 1)],
      10,
    );
    expect(merged[0]).toMatchObject({ title: 'Chrome title', visits: 1 });
  });
});

describe('parseChromeHistoryRows', () => {
  it('parses sqlite3 -json rows into chrome TopSites', () => {
    const rows = JSON.stringify([
      { url: 'https://a.com/', title: 'A', visit_count: 42 },
      { url: 'https://b.com/x', title: 'B', visit_count: 7 },
    ]);
    expect(parseChromeHistoryRows(rows)).toEqual([
      { url: 'https://a.com/', title: 'A', visits: 42, source: 'chrome' },
      { url: 'https://b.com/x', title: 'B', visits: 7, source: 'chrome' },
    ]);
  });

  it('drops non-http schemes, empty titles, and malformed rows', () => {
    const rows = JSON.stringify([
      { url: 'chrome://settings', title: 'Settings', visit_count: 99 },
      { url: 'chrome-extension://abc/page.html', title: 'Ext', visit_count: 5 },
      { url: 'file:///etc/passwd', title: 'pw', visit_count: 5 },
      { url: 'https://empty-title.com', title: '  ', visit_count: 5 },
      { url: 42, title: 'no url', visit_count: 5 },
      { title: 'no url at all', visit_count: 5 },
      null,
      'garbage',
      { url: 'ht tp://broken', title: 'bad url', visit_count: 1 },
      { url: 'https://ok.com', title: 'OK', visit_count: 2 },
    ]);
    expect(parseChromeHistoryRows(rows)).toEqual([
      { url: 'https://ok.com', title: 'OK', visits: 2, source: 'chrome' },
    ]);
  });

  it('caps each domain at 10 entries and defaults junk visit_counts to 1', () => {
    const rows = JSON.stringify(
      Array.from({ length: 15 }, (_, i) => ({
        url: `https://busy.com/p${i}`,
        title: `P${i}`,
        visit_count: i === 0 ? 'lots' : 15 - i,
      })),
    );
    const sites = parseChromeHistoryRows(rows);
    expect(sites).toHaveLength(10);
    expect(sites[0].visits).toBe(1); // 'lots' is not a number
  });

  it('returns [] for malformed json and non-array payloads', () => {
    expect(parseChromeHistoryRows('not json')).toEqual([]);
    expect(parseChromeHistoryRows('{"a":1}')).toEqual([]);
  });
});

describe('redactUrlForLog', () => {
  it('strips query and hash, keeping origin + path', () => {
    expect(redactUrlForLog('https://a.com/x/y?token=secret#frag')).toBe('https://a.com/x/y');
    expect(redactUrlForLog('http://127.0.0.1:8080/?q=1')).toBe('http://127.0.0.1:8080/');
  });

  it('returns empty string for unparseable input (log nothing)', () => {
    expect(redactUrlForLog('not a url')).toBe('');
  });
});

describe('history helpers', () => {
  it('appendHistoryEntry appends and prunes oldest beyond the cap', () => {
    let list = appendHistoryEntry([], { url: 'https://a.com', title: '', ts: 1 }, 3);
    list = appendHistoryEntry(list, { url: 'https://b.com', title: '', ts: 2 }, 3);
    list = appendHistoryEntry(list, { url: 'https://c.com', title: '', ts: 3 }, 3);
    list = appendHistoryEntry(list, { url: 'https://d.com', title: '', ts: 4 }, 3);
    expect(list.map((e) => e.url)).toEqual(['https://b.com', 'https://c.com', 'https://d.com']);
  });

  it('patchHistoryTitle fills the newest empty-title entry for the url only', () => {
    let list = appendHistoryEntry([], { url: 'https://a.com', title: 'Old', ts: 1 });
    list = appendHistoryEntry(list, { url: 'https://a.com', title: '', ts: 2 });
    const patched = patchHistoryTitle(list, 'https://a.com', 'New');
    expect(patched[0].title).toBe('Old');
    expect(patched[1].title).toBe('New');
    // Second patch for the same url: newest entry already titled → unchanged.
    expect(patchHistoryTitle(patched, 'https://a.com', 'Later')).toBe(patched);
    // Unknown url / empty title → unchanged.
    expect(patchHistoryTitle(patched, 'https://zzz.com', 'X')).toBe(patched);
    expect(patchHistoryTitle(patched, 'https://a.com', '')).toBe(patched);
  });

  it('historyToTopSites counts visits per url and keeps the latest title', () => {
    let list = appendHistoryEntry([], { url: 'https://a.com', title: '', ts: 1 });
    list = appendHistoryEntry(list, { url: 'https://a.com', title: 'A', ts: 2 });
    list = appendHistoryEntry(list, { url: 'https://b.com', title: 'B', ts: 3 });
    const sites = historyToTopSites(list);
    const a = sites.find((s) => s.url === 'https://a.com');
    expect(a).toEqual({ url: 'https://a.com', title: 'A', visits: 2, source: 'cowork' });
    expect(sites.find((s) => s.url === 'https://b.com')?.visits).toBe(1);
  });
});

describe('persistence validation', () => {
  it('sanitizePersistedTabs accepts a good file and repairs a stale activeTabId', () => {
    const good = {
      tabs: [
        { id: 'a', url: 'https://a.com', title: 'A', favicon: 'https://a.com/f.ico' },
        { id: 'b', url: 'https://b.com', title: 'B', favicon: null, junk: true },
        { id: '', url: 'https://bad.com' }, // empty id → dropped
        'garbage',
        { id: 'c' }, // url/title/favicon default
      ],
      activeTabId: 'ghost', // not in tabs → falls back to first tab
    };
    expect(sanitizePersistedTabs(good)).toEqual({
      tabs: [
        { id: 'a', url: 'https://a.com', title: 'A', favicon: 'https://a.com/f.ico', pinned: false, zoom: 1 },
        { id: 'b', url: 'https://b.com', title: 'B', favicon: null, pinned: false, zoom: 1 },
        { id: 'c', url: '', title: '', favicon: null, pinned: false, zoom: 1 },
      ],
      activeTabId: 'a',
    });
  });

  it('sanitizePersistedTabs rejects unusable shapes', () => {
    expect(sanitizePersistedTabs(null)).toBeNull();
    expect(sanitizePersistedTabs('x')).toBeNull();
    expect(sanitizePersistedTabs({})).toBeNull();
    expect(sanitizePersistedTabs({ tabs: 'nope' })).toBeNull();
  });

  it('sanitizePersistedTabs keeps a valid activeTabId and handles empty tab lists', () => {
    expect(
      sanitizePersistedTabs({ tabs: [{ id: 'a', url: '', title: '', favicon: null }], activeTabId: 'a' }),
    ).toEqual({ tabs: [{ id: 'a', url: '', title: '', favicon: null, pinned: false, zoom: 1 }], activeTabId: 'a' });
    expect(sanitizePersistedTabs({ tabs: [], activeTabId: 'a' })).toEqual({ tabs: [], activeTabId: null });
  });

  it('sanitizePersistedTabs drops tabs with disallowed url schemes', () => {
    const dirty = {
      tabs: [
        { id: 'good', url: 'https://a.com', title: 'A', favicon: null },
        { id: 'evil1', url: 'file:///etc/passwd', title: 'pw', favicon: null },
        { id: 'evil2', url: 'javascript:alert(1)', title: 'xss', favicon: null },
        { id: 'evil3', url: 'data:text/html,boom', title: 'data', favicon: null },
        { id: 'blank', url: '', title: '', favicon: null },
      ],
      activeTabId: 'evil1', // dropped → falls back to first survivor
    };
    expect(sanitizePersistedTabs(dirty)).toEqual({
      tabs: [
        { id: 'good', url: 'https://a.com', title: 'A', favicon: null, pinned: false, zoom: 1 },
        { id: 'blank', url: '', title: '', favicon: null, pinned: false, zoom: 1 },
      ],
      activeTabId: 'good',
    });
  });

  it('sanitizePersistedTabs caps restored tabs at MAX_TABS', () => {
    const raw = {
      tabs: Array.from({ length: MAX_TABS + 20 }, (_, i) => ({
        id: `t${i}`, url: `https://x${i}.com`, title: `T${i}`, favicon: null,
      })),
      activeTabId: 't0',
    };
    const sanitized = sanitizePersistedTabs(raw);
    expect(sanitized?.tabs).toHaveLength(MAX_TABS);
    expect(sanitized?.tabs.at(-1)?.id).toBe(`t${MAX_TABS - 1}`);
  });

  it('sanitizeHistory redacts query strings and drops non-redactable rows', () => {
    const out = sanitizeHistory([
      { url: 'https://a.com/page?token=secret#frag', title: 'A', ts: 1 },
      { url: 'file:///etc/passwd', title: 'x', ts: 2 },
      { url: 'not a url', title: 'y', ts: 3 },
      { url: 'https://b.com/keep', title: 'B', ts: 4 },
    ]);
    expect(out).toEqual([
      { url: 'https://a.com/page', title: 'A', ts: 1 },
      { url: 'https://b.com/keep', title: 'B', ts: 4 },
    ]);
  });

  it('sanitizeHistory drops junk rows and prunes to the cap', () => {
    expect(sanitizeHistory('nope')).toEqual([]);
    expect(
      sanitizeHistory([
        { url: 'https://a.com', title: 'A', ts: 1 },
        { url: '', title: 'empty url dropped', ts: 2 },
        { url: 'https://b.com' }, // title/ts default
        'garbage',
        null,
      ]),
    ).toEqual([
      { url: 'https://a.com/', title: 'A', ts: 1 },
      { url: 'https://b.com/', title: '', ts: 0 },
    ]);
    const huge = Array.from({ length: HISTORY_CAP + 50 }, (_, i) => ({ url: `https://h.com/${i}`, title: '', ts: i }));
    expect(sanitizeHistory(huge)).toHaveLength(HISTORY_CAP);
  });
});

describe('nextZoomFactor', () => {
  it("steps in and out along the Chrome ladder and clamps at the ends", () => {
    expect(nextZoomFactor(1, 1)).toBe(1.1);
    expect(nextZoomFactor(1.1, 1)).toBe(1.25);
    expect(nextZoomFactor(1, -1)).toBe(0.9);
    expect(nextZoomFactor(0.5, -1)).toBe(0.5); // floor
    expect(nextZoomFactor(3, 1)).toBe(3); // ceiling
  });

  it('reset returns 100% and unknown values snap to the nearest step first', () => {
    expect(nextZoomFactor(1.7, 0)).toBe(1);
    expect(nextZoomFactor(1.05, 1)).toBe(1.1); // tie snaps to the lower step (1.0), then up
    expect(nextZoomFactor(1.05, -1)).toBe(0.9); // tie → 1.0, then down
  });
});

describe('sanitizeFaviconUrl', () => {
  it('accepts http(s) and data: favicons', () => {
    expect(sanitizeFaviconUrl('https://a.com/favicon.ico')).toBe('https://a.com/favicon.ico');
    expect(sanitizeFaviconUrl('http://a.com/f.png')).toBe('http://a.com/f.png');
    expect(sanitizeFaviconUrl('data:image/png;base64,iVBOR')).toBe('data:image/png;base64,iVBOR');
  });

  it('rejects empty, non-http schemes, and oversized payloads', () => {
    expect(sanitizeFaviconUrl(null)).toBeNull();
    expect(sanitizeFaviconUrl('')).toBeNull();
    expect(sanitizeFaviconUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeFaviconUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeFaviconUrl(`data:image/png;base64,${'A'.repeat(256 * 1024)}`)).toBeNull();
  });
});

describe('dedupeDownloadName', () => {
  it('keeps the name when free, otherwise appends (n) before the extension', () => {
    expect(dedupeDownloadName('report.pdf', () => false)).toBe('report.pdf');
    const taken = new Set(['report.pdf', 'report (1).pdf']);
    expect(dedupeDownloadName('report.pdf', (n) => taken.has(n))).toBe('report (2).pdf');
    // No extension and dotfiles behave sensibly.
    expect(dedupeDownloadName('archive', (n) => n === 'archive')).toBe('archive (1)');
    expect(dedupeDownloadName('.gitignore', (n) => n === '.gitignore')).toBe('.gitignore (1)');
  });
});

describe('MAX_TABS', () => {
  it('caps the tab count at 50', () => {
    expect(MAX_TABS).toBe(50);
  });
});

describe('classifyControl', () => {
  it('marks submit inputs and buttons consequential regardless of text', () => {
    expect(classifyControl({ tag: 'input', inputType: 'submit' })).toBe('consequential');
    expect(classifyControl({ tag: 'input', inputType: 'submit', text: 'Search' })).toBe('consequential');
    expect(classifyControl({ tag: 'button', inputType: 'submit', text: 'Go' })).toBe('consequential');
    expect(classifyControl({ tag: 'button', inputType: 'SUBMIT', text: 'Go' })).toBe('consequential');
    // submit on a non-control tag is just another element.
    expect(classifyControl({ tag: 'a', inputType: 'submit', text: 'Go' })).toBe('safe');
  });

  it('marks every word-list term consequential', () => {
    for (const term of CONSEQUENTIAL_TERMS) {
      expect(classifyControl({ tag: 'button', text: term }), term).toBe('consequential');
    }
  });

  it('matches terms inside real button copy, case-insensitively, on word boundaries', () => {
    expect(classifyControl({ tag: 'button', text: 'Send message' })).toBe('consequential');
    expect(classifyControl({ tag: 'button', text: 'SEND' })).toBe('consequential');
    expect(classifyControl({ tag: 'button', text: 'Place Your Order' })).toBe('consequential');
    expect(classifyControl({ tag: 'button', text: 'Buy now' })).toBe('consequential');
    expect(classifyControl({ tag: 'a', text: 'Delete this page' })).toBe('consequential');
    expect(classifyControl({ tag: 'button', text: 'Schedule Send' })).toBe('consequential');
  });

  it('leaves safe controls and word-boundary near-misses alone', () => {
    for (const text of [
      'Search',
      'Save draft',
      'Archive',
      'Sender info',      // 'send' inside a word
      'Payment methods',  // 'pay' inside a word
      'Confirmed',        // 'confirm' inside a word
      'Schedule',         // bare 'schedule' is deliberately not listed
      'Sign in',
      '',
    ]) {
      expect(classifyControl({ tag: 'button', text }), text).toBe('safe');
    }
  });

  it('prefers visible text over aria-label, falling back when text is empty', () => {
    // Mirrors the snapshot walker's fallback chain (innerText || … || aria-label).
    expect(classifyControl({ tag: 'button', text: 'Save draft', ariaLabel: 'Send' })).toBe('safe');
    expect(classifyControl({ tag: 'button', text: '', ariaLabel: 'Delete conversation' })).toBe('consequential');
    expect(classifyControl({ tag: 'button', text: '   ', ariaLabel: 'Share' })).toBe('consequential');
  });

  it('treats missing labels and plain inputs as safe', () => {
    expect(classifyControl({ tag: 'button' })).toBe('safe');
    expect(classifyControl({ tag: 'input', inputType: 'text' })).toBe('safe');
    expect(classifyControl({ tag: 'input', inputType: 'password' })).toBe('safe');
    expect(classifyControl({ tag: 'a', text: 'Read more' })).toBe('safe');
  });
});

describe('detectsAuthWall', () => {
  it('matches every SSO host and its subdomains', () => {
    expect(detectsAuthWall({ url: 'https://accounts.google.com/signin' })).toBe(true);
    expect(detectsAuthWall({ url: 'https://login.microsoftonline.com/oauth2/authorize' })).toBe(true);
    expect(detectsAuthWall({ url: 'https://login.live.com' })).toBe(true);
    expect(detectsAuthWall({ url: 'https://my-tenant.okta.com/app' })).toBe(true);
    expect(detectsAuthWall({ url: 'https://deep.my-tenant.okta.com/login' })).toBe(true);
    expect(detectsAuthWall({ url: 'https://tenant.auth0.com/u/login' })).toBe(true);
    // Subdomains of the exact hosts count too.
    expect(detectsAuthWall({ url: 'https://sub.login.live.com' })).toBe(true);
  });

  it('rejects suffix spoofs, bare wildcard domains, and non-SSO hosts', () => {
    expect(detectsAuthWall({ url: 'https://accounts.google.com.evil.com' })).toBe(false);
    expect(detectsAuthWall({ url: 'https://evil-accounts.google.com' })).toBe(false);
    expect(detectsAuthWall({ url: 'https://notaccounts.google.com' })).toBe(false);
    expect(detectsAuthWall({ url: 'https://login.microsoftonline.com.evil.com' })).toBe(false);
    // '*.' entries match subdomains only — the bare domain is not a sign-in.
    expect(detectsAuthWall({ url: 'https://okta.com' })).toBe(false);
    expect(detectsAuthWall({ url: 'https://auth0.com' })).toBe(false);
    expect(detectsAuthWall({ url: 'https://example.com/login' })).toBe(false);
    expect(detectsAuthWall({ url: 'not a url' })).toBe(false);
    expect(detectsAuthWall({ url: '' })).toBe(false);
  });

  it('flags http(s) pages presenting a password field', () => {
    expect(detectsAuthWall({ url: 'https://example.com/login', hasPasswordField: true })).toBe(true);
    expect(detectsAuthWall({ url: 'http://localhost:3000/login', hasPasswordField: true })).toBe(true);
    expect(detectsAuthWall({ url: 'https://example.com', hasPasswordField: false })).toBe(false);
    // The heuristic is http(s)-only.
    expect(detectsAuthWall({ url: 'file:///etc/passwd', hasPasswordField: true })).toBe(false);
    expect(detectsAuthWall({ url: 'ftp://example.com', hasPasswordField: true })).toBe(false);
  });
});
