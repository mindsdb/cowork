import { describe, expect, it, vi } from 'vitest';

import {
  isAbsoluteArtifactPreviewUrl,
  TEXT_PREVIEW_EXTS,
  withArtifactCommentFlag,
  withArtifactVersion,
  injectDraftBaseHref,
  canFetchDraftWithCredentials,
  countCsvRows,
  csvRowsToGfmTable,
  CSV_PREVIEW_ROW_LIMIT,
  draftPreviewErrorMessage,
  parseCsv,
  DRAFT_FRAGMENT_GUARD_SCRIPT,
} from './artifactPreviewUtils';
import { TEXT_PREVIEW_EXTS as SHARED_TEXT_PREVIEW_EXTS } from '../../lib/artifactKinds';

describe('artifact preview URLs', () => {
  it('recognizes network and embedded absolute URLs', () => {
    expect(isAbsoluteArtifactPreviewUrl('https://example.com/draft.html')).toBe(true);
    expect(isAbsoluteArtifactPreviewUrl('blob:http://localhost/id')).toBe(true);
    expect(isAbsoluteArtifactPreviewUrl('data:text/html,hello')).toBe(true);
    expect(isAbsoluteArtifactPreviewUrl('//example.com/draft.html')).toBe(true);
    expect(isAbsoluteArtifactPreviewUrl('/api/v1/artifacts/drafts/id/file.html')).toBe(false);
    expect(isAbsoluteArtifactPreviewUrl('javascript:alert(1)')).toBe(false);
  });

  it('versions query-capable preview URLs', () => {
    expect(withArtifactVersion('/draft.html', 'rev-5')).toBe('/draft.html?v=rev-5');
    expect(withArtifactCommentFlag('/draft.html?v=rev-5'))
      .toBe('/draft.html?v=rev-5&__antonComments=1');
  });

  it('does not corrupt content-addressed preview URLs with query suffixes', () => {
    const dataUrl = 'data:text/html,%3Ch1%3EHello%3C%2Fh1%3E';
    const blobUrl = 'blob:http://localhost/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    expect(withArtifactVersion(dataUrl, 'rev-5')).toBe(dataUrl);
    expect(withArtifactCommentFlag(dataUrl)).toBe(dataUrl);
    expect(withArtifactVersion(blobUrl, 'rev-5')).toBe(blobUrl);
    expect(withArtifactCommentFlag(blobUrl)).toBe(blobUrl);
  });
});

/*
 * The viewer's text renderer and the click gates that promise it have to read
 * one set. They used to hold a copy each, so adding a format meant editing
 * both: miss the gate and no click reaches a file the viewer renders; miss the
 * viewer and a card offers a preview that falls through to the iframe.
 */
describe('TEXT_PREVIEW_EXTS', () => {
  it('is the same set the artifact click gates read', () => {
    expect(TEXT_PREVIEW_EXTS).toBe(SHARED_TEXT_PREVIEW_EXTS);
  });
});

/*
 * The old `src=` iframe navigation never attached credentials, regardless of
 * what origin it pointed at. `authFetch` attaches the web Keycloak bearer to
 * whatever URL it is given, so routing a draft through it is only safe when
 * that URL is our own API — anything else (a data:/blob: URL with no network
 * request at all, or a genuinely different origin) must keep using the old
 * unauthenticated `src=` path instead.
 */
describe('canFetchDraftWithCredentials', () => {
  const API_ORIGIN = 'https://cowork.example';

  it('allows a same-origin absolute draft URL', () => {
    expect(canFetchDraftWithCredentials(`${API_ORIGIN}/api/v1/artifacts/drafts/p/1/index.html`, API_ORIGIN))
      .toBe(true);
  });

  it('rejects an embedded data: URL', () => {
    expect(canFetchDraftWithCredentials('data:text/html,%3Ch1%3EHi%3C%2Fh1%3E', API_ORIGIN)).toBe(false);
  });

  it('rejects an embedded blob: URL', () => {
    expect(canFetchDraftWithCredentials('blob:http://localhost/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', API_ORIGIN))
      .toBe(false);
  });

  it('rejects a genuinely cross-origin absolute URL', () => {
    expect(canFetchDraftWithCredentials('https://evil.example/index.html', API_ORIGIN)).toBe(false);
  });

  it('rejects rather than throwing when the API origin itself is unparseable', () => {
    expect(canFetchDraftWithCredentials('https://cowork.example/index.html', '')).toBe(false);
  });
});

/*
 * srcdoc gives an iframe no base URL of its own. Fetched draft HTML that used
 * to navigate the iframe's `src` directly relied on the browser deriving the
 * base from that URL; srcdoc needs the same base stated explicitly or every
 * relative <script src>/<link href>/anchor in the document breaks.
 */
describe('injectDraftBaseHref', () => {
  it('inserts a base tag pointing at the draft directory, inside <head>', () => {
    const html = '<html><head><title>Deck</title></head><body>Hi</body></html>';

    const result = injectDraftBaseHref(
      html,
      'https://cowork.example/api/v1/artifacts/drafts/p1/a1/index.html?v=5',
    );

    expect(result).toContain('<base href="https://cowork.example/api/v1/artifacts/drafts/p1/a1/">');
    expect(result.indexOf('<head')).toBeLessThan(result.indexOf('<base'));
    expect(result.indexOf('<base')).toBeLessThan(result.indexOf('<title>Deck</title>'));
  });

  it('prepends the base tag when the document has no <head>', () => {
    const result = injectDraftBaseHref(
      '<body>Hi</body>',
      'https://cowork.example/api/v1/artifacts/drafts/p1/a1/index.html',
    );

    expect(result).toContain('<base href="https://cowork.example/api/v1/artifacts/drafts/p1/a1/">');
    expect(result.endsWith('<body>Hi</body>')).toBe(true);
  });

  it('does not add a second base tag (or the guard script) when the document already has one', () => {
    const html = '<html><head><base href="https://custom.example/"></head><body>Hi</body></html>';

    const result = injectDraftBaseHref(
      html,
      'https://cowork.example/api/v1/artifacts/drafts/p1/a1/index.html',
    );

    expect(result).toBe(html);
  });

  it('strips the query string and filename, keeping only the directory', () => {
    const result = injectDraftBaseHref(
      '<head></head>',
      'https://cowork.example/api/v1/artifacts/drafts/p1/a1/report.html?v=3&__antonComments=1',
    );

    expect(result).toContain('<base href="https://cowork.example/api/v1/artifacts/drafts/p1/a1/">');
  });

  it('escapes characters that are unsafe inside an HTML attribute', () => {
    // `&` is a valid, unencoded path character per the URL spec (only query
    // strings require escaping it) but is unsafe left bare inside an HTML
    // attribute value — this is the one realistic way a draft directory path
    // could carry a character `escapeHtmlAttribute` has to neutralize.
    const result = injectDraftBaseHref(
      '<head></head>',
      'https://cowork.example/api/v1/artifacts/drafts/p1/a&b/index.html',
    );

    expect(result).toContain('<base href="https://cowork.example/api/v1/artifacts/drafts/p1/a&amp;b/">');
  });

  /*
   * srcdoc's document.URL stays `about:srcdoc` no matter what <base> says, so
   * a fragment-only link (href="#x") resolves against the base and no longer
   * matches the document's own URL — the browser treats it as a real
   * navigation instead of an in-page scroll (confirmed against a live
   * browser during review of PR #765). That navigation has no Authorization
   * header, so it reproduces the very 401 this file exists to fix. The guard
   * script intercepts it.
   */
  it('injects the fragment-navigation guard script alongside the base tag', () => {
    const result = injectDraftBaseHref('<head></head>', 'https://cowork.example/drafts/p1/a1/index.html');

    expect(result).toContain(DRAFT_FRAGMENT_GUARD_SCRIPT);
    expect(result.indexOf('<base')).toBeLessThan(result.indexOf('<script>'));
  });
});

/*
 * Runs the guard's source inside a fresh iframe's own realm (its own
 * `document`/`window`/`Function`), mirroring how it actually executes —
 * inside the srcdoc document, not the parent page. A plain `new Function()`
 * against the top-level test document would register a `click` listener that
 * outlives and accumulates across tests instead.
 */
function mountGuardedDocument(bodyHtml) {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  iframe.contentDocument.close();
  // eslint-disable-next-line no-new-func
  new iframe.contentWindow.Function(DRAFT_FRAGMENT_GUARD_SCRIPT)();
  return iframe;
}

describe('DRAFT_FRAGMENT_GUARD_SCRIPT', () => {
  it('prevents default and scrolls to the target for a fragment-only link', () => {
    const iframe = mountGuardedDocument('<a id="link" href="#target">Go</a><div id="target"></div>');
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    const target = doc.getElementById('target');
    const scrollSpy = vi.spyOn(target, 'scrollIntoView').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(win, 'fetch').mockImplementation(() => Promise.reject(new Error('must not fetch')));

    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    doc.getElementById('link').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('finds the target by id even when the fragment is percent-encoded', () => {
    const iframe = mountGuardedDocument(
      '<a id="link" href="#Section%20One">Go</a><div id="Section One"></div>',
    );
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    const target = doc.getElementById('Section One');
    const scrollSpy = vi.spyOn(target, 'scrollIntoView').mockImplementation(() => {});

    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    doc.getElementById('link').dispatchEvent(event);

    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it('does not intercept an ordinary (non-fragment) link', () => {
    const iframe = mountGuardedDocument('<a id="link" href="page2.html">Next</a>');
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;

    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    doc.getElementById('link').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('scrolls to top for a bare "#" link', () => {
    const iframe = mountGuardedDocument('<a id="link" href="#">Top</a>');
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    const scrollToSpy = vi.spyOn(win, 'scrollTo').mockImplementation(() => {});

    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    doc.getElementById('link').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });

  it('prevents default without throwing when the fragment is malformed percent-encoding', () => {
    const iframe = mountGuardedDocument('<a id="link" href="#100%25%">Broken</a>');
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;

    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    expect(() => doc.getElementById('link').dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
  });

  it('preventDefaults even when no element matches the fragment', () => {
    const iframe = mountGuardedDocument('<a id="link" href="#nowhere">Go</a>');
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;

    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    doc.getElementById('link').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('delegates from a click on a descendant of the anchor', () => {
    const iframe = mountGuardedDocument(
      '<a id="link" href="#target"><span id="icon">></span></a><div id="target"></div>',
    );
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    const target = doc.getElementById('target');
    const scrollSpy = vi.spyOn(target, 'scrollIntoView').mockImplementation(() => {});

    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    doc.getElementById('icon').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});

/*
 * A CSV preview printed Chromium's "Failed to fetch" where the table should
 * have been, because the text branch showed whatever it caught. These pin the
 * two rules the mapper owes its callers: a status is always named, and
 * a browser-internal string never reaches the modal.
 */
describe('draftPreviewErrorMessage', () => {
  it('maps 401 and 403 to the copy the draft-HTML branch already showed', () => {
    expect(draftPreviewErrorMessage({ status: 401 }))
      .toBe('Your session expired — reload the page and try again.');
    expect(draftPreviewErrorMessage({ status: 403 }))
      .toBe('You do not have access to this draft.');
  });

  it('names the status for anything else the server answered', () => {
    expect(draftPreviewErrorMessage({ status: 404 })).toBe('Could not load this preview (HTTP 404).');
    expect(draftPreviewErrorMessage({ status: 500 })).toBe('Could not load this preview (HTTP 500).');
  });

  it('keeps a server detail and adds the status to it', () => {
    expect(draftPreviewErrorMessage(Object.assign(new Error('Artifact not found'), { status: 404 })))
      .toBe('Artifact not found (HTTP 404)');
  });

  it('does not make a loader say its status twice', () => {
    expect(draftPreviewErrorMessage(
      Object.assign(new Error('Could not load private draft (500)'), { status: 500 }),
    )).toBe('Could not load private draft (500)');
  });

  it('never shows the browser text for a fetch that failed at the network layer', () => {
    const message = draftPreviewErrorMessage(new TypeError('Failed to fetch'));

    expect(message).not.toContain('Failed to fetch');
    expect(message).toBe('Could not reach the server to load this preview. Check the connection, then reload.');
  });

  // The message test is the backstop for a runtime that rejects with something
  // other than a TypeError, or wraps it on the way through.
  it.each([
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
  ])('maps the browser transport string %s even off a plain Error', (raw) => {
    expect(draftPreviewErrorMessage(new Error(raw))).not.toContain(raw);
  });

  it('passes our own messages through, since they already read as sentences', () => {
    expect(draftPreviewErrorMessage(new Error('Preview returned no content')))
      .toBe('Preview returned no content');
    expect(draftPreviewErrorMessage(new Error('Refusing to send credentials to an embedded draft URL')))
      .toBe('Refusing to send credentials to an embedded draft URL');
  });

  it('falls back to the caller phrasing when there is nothing to report', () => {
    expect(draftPreviewErrorMessage(undefined)).toBe('Could not load preview');
    expect(draftPreviewErrorMessage({}, 'Could not load this draft')).toBe('Could not load this draft');
  });
});

/*
 * The CSV preview path had no coverage at all, which is how the three parsing
 * defects below survived. `.csv` is the only artifact type these
 * four exports serve, so a wrong cell here is a wrong table on screen.
 */
describe('parseCsv', () => {
  it('parses a header and its rows', () => {
    expect(parseCsv('id,name\n1,Ada\n2,Grace\n')).toEqual([
      ['id', 'name'],
      ['1', 'Ada'],
      ['2', 'Grace'],
    ]);
  });

  it('keeps commas, newlines and escaped quotes inside a quoted field', () => {
    expect(parseCsv('name,note\n"Ada, L","said ""hi""\nthen left"\n')).toEqual([
      ['name', 'note'],
      ['Ada, L', 'said "hi"\nthen left'],
    ]);
  });

  it('reads a stray quote mid-value as literal text', () => {
    // One bare quote used to open a quoted field that never closed, so every
    // remaining row collapsed into a single cell.
    expect(parseCsv('id,note\n1,part"ial\n2,fine\n')).toEqual([
      ['id', 'note'],
      ['1', 'part"ial'],
      ['2', 'fine'],
    ]);
    expect(parseCsv('id,note\n1,he said "hi" loudly\n')).toEqual([
      ['id', 'note'],
      ['1', 'he said "hi" loudly'],
    ]);
  });

  it('strips the UTF-8 BOM that spreadsheet exporters write', () => {
    expect(parseCsv('\uFEFFid,name\n1,Ada\n')[0]).toEqual(['id', 'name']);
  });

  it.each([
    ['CRLF', 'id,name\r\n1,Ada\r\n'],
    ['LF', 'id,name\n1,Ada\n'],
    ['CR only', 'id,name\r1,Ada\r'],
  ])('ends a row on %s line endings', (_label, text) => {
    expect(parseCsv(text)).toEqual([['id', 'name'], ['1', 'Ada']]);
  });

  it('stops scanning once it has the header plus `limit` rows', () => {
    const rows = parseCsv('id\n1\n2\n3\n4\n', 2);

    expect(rows).toEqual([['id'], ['1'], ['2']]);
  });

  it('keeps a trailing row that has no final newline', () => {
    expect(parseCsv('id,name\n1,Ada')).toEqual([['id', 'name'], ['1', 'Ada']]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('countCsvRows', () => {
  it('counts the header with the data rows, which is what the notice reports', () => {
    expect(countCsvRows('id,name\n1,Ada\n2,Grace\n')).toBe(3);
  });

  it('counts a trailing row with no final newline', () => {
    expect(countCsvRows('id,name\n1,Ada')).toBe(2);
  });

  it('returns 0 for nothing to count', () => {
    expect(countCsvRows('')).toBe(0);
    expect(countCsvRows(undefined)).toBe(0);
  });

  /*
   * The two functions read the same file for the same screen: the table comes
   * from parseCsv, the "showing N of M" notice above it from countCsvRows. If
   * they disagree on quoting or line endings the notice contradicts the table,
   * so the shared rules are asserted together rather than once each.
   */
  it.each([
    ['plain', 'id,name\n1,Ada\n2,Grace\n'],
    ['no trailing newline', 'id,name\n1,Ada'],
    ['CRLF', 'id,name\r\n1,Ada\r\n'],
    ['CR only', 'id,name\r1,Ada\r2,Grace\r'],
    ['BOM', '\uFEFFid,name\n1,Ada\n'],
    ['newline inside a quoted field', 'id,note\n1,"two\nlines"\n'],
    ['stray quote', 'id,note\n1,part"ial\n2,fine\n'],
  ])('agrees with parseCsv on the row count for %s', (_label, text) => {
    expect(countCsvRows(text)).toBe(parseCsv(text).length);
  });
});

describe('csvRowsToGfmTable', () => {
  it('renders the first row as the header with a separator under it', () => {
    expect(csvRowsToGfmTable([['id', 'name'], ['1', 'Ada']])).toBe(
      '| id | name |\n| --- | --- |\n| 1 | Ada |',
    );
  });

  it('escapes the backslash before the pipe, so neither breaks the table', () => {
    expect(csvRowsToGfmTable([['a'], ['x|y'], ['c:\\path']])).toBe(
      '| a |\n| --- |\n| x\\|y |\n| c:\\\\path |',
    );
  });

  it('collapses a line break inside a cell to a space', () => {
    expect(csvRowsToGfmTable([['note'], ['two\nlines'], ['crlf\r\nlines']])).toBe(
      '| note |\n| --- |\n| two lines |\n| crlf lines |',
    );
  });

  it('pads a short row and truncates a long one to the header width', () => {
    expect(csvRowsToGfmTable([['a', 'b'], ['1'], ['1', '2', '3']])).toBe(
      '| a | b |\n| --- | --- |\n| 1 |  |\n| 1 | 2 |',
    );
  });

  it('renders nothing for no rows', () => {
    expect(csvRowsToGfmTable([])).toBe('');
    expect(csvRowsToGfmTable(null)).toBe('');
  });
});

describe('CSV_PREVIEW_ROW_LIMIT', () => {
  it('caps the inline table at 100 rows', () => {
    expect(CSV_PREVIEW_ROW_LIMIT).toBe(100);
    expect(parseCsv(`id\n${'1\n'.repeat(500)}`, CSV_PREVIEW_ROW_LIMIT))
      .toHaveLength(CSV_PREVIEW_ROW_LIMIT + 1);
  });
});
