import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  canDownloadArtifact, canDownloadOrgDraft, canShowInBrowserTab,
  canPreviewLocally, canPreviewOrgDraft, isFilePageArtifact, isImageArtifact, isInlineArtifact, isInlinePreviewable,
  isPublishableArtifact, isWidgetArtifact, PUBLISHABLE_FILE_EXTS,
} from './artifactKinds';

const FIXTURES = load(readFileSync(resolve(import.meta.dirname, 'artifactSurfaces.yaml'), 'utf-8'));

// ENG-1998: the viewer/card layer needs a single, shared answer to "is this
// an image artifact" — matching isHtmlArtifact's convention (declared `ext`
// wins, path suffix as a fallback) so the list, the inline chat card, and
// the preview modal can't drift on which files get a thumbnail.
describe('isImageArtifact', () => {
  it('is true for a declared image extension', () => {
    expect(isImageArtifact({ ext: '.png', path: '/a/logo.png' })).toBe(true);
    expect(isImageArtifact({ ext: '.svg', path: '/a/icon.svg' })).toBe(true);
  });

  it('falls back to the path suffix when ext is missing', () => {
    expect(isImageArtifact({ path: '/a/photo.jpeg' })).toBe(true);
  });

  it('is false for non-image artifacts', () => {
    expect(isImageArtifact({ ext: '.html', path: '/a/index.html' })).toBe(false);
    expect(isImageArtifact({ ext: '.md', path: '/a/report.md' })).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(isImageArtifact(null)).toBe(false);
    expect(isImageArtifact(undefined)).toBe(false);
  });
});

// ENG-4687: a PDF, Word, Excel, PowerPoint, CSV or text file shares as a
// read-only page of its own, like a web page or Markdown.
describe('isPublishableArtifact', () => {
  it('refuses a stateful full-stack app, and anything the server says it would refuse', () => {
    const page = { path: '/a/app/static/index.html', ext: '.html' };
    expect(isPublishableArtifact({ ...page, type: 'fullstack-stateful-app' })).toBe(false);
    expect(isPublishableArtifact({ ...page, type: 'fullstack-stateless-app' })).toBe(true);
    expect(isPublishableArtifact({ ...page, capabilities: { canPublish: false } })).toBe(false);
    expect(isPublishableArtifact({ ...page, capabilities: { canEdit: true } })).toBe(true);
  });

  it('covers web pages, Markdown and files shared as a page, by declared ext or path', () => {
    for (const path of ['/a/index.html', '/a/report.md', '/a/r.pdf', '/a/u.docx', '/a/m.xlsx', '/a/d.pptx', '/a/rows.csv', '/a/n.txt']) {
      expect(isPublishableArtifact({ path })).toBe(true);
    }
    expect(isPublishableArtifact({ ext: '.pdf', path: '/a/report' })).toBe(true);
  });

  it('leaves out what has no page: images, code, archives', () => {
    for (const path of ['/a/logo.png', '/a/main.py', '/a/bundle.zip']) {
      expect(isPublishableArtifact({ path })).toBe(false);
    }
    expect(isPublishableArtifact(null)).toBe(false);
  });

  it('tells a file shared as a page from a page itself', () => {
    expect(isFilePageArtifact({ path: '/a/m.xlsx' })).toBe(true);
    expect(isFilePageArtifact({ path: '/a/index.html' })).toBe(false);
    expect(isFilePageArtifact({ path: '/a/report.md' })).toBe(false);
  });

  it('lists the same kinds cowork-server renders a page for (file_page.PUBLISHABLE_FILE_SUFFIXES)', () => {
    expect([...PUBLISHABLE_FILE_EXTS]).toEqual(['.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.txt']);
  });
});

/*
 * The three surfaces that render an artifact body — the inline chat card, the
 * Working folder rail and the artifacts grid — each carried their own extension
 * list and drifted: the chat card counted images as previewable and the rail did
 * not. These are the one answer all three now ask.
 */
describe('isInlinePreviewable', () => {
  it('covers what the viewer renders from markup or text', () => {
    expect(isInlinePreviewable({ ext: '.html', path: '/a/index.html' })).toBe(true);
    expect(isInlinePreviewable({ ext: '.md', path: '/a/report.md' })).toBe(true);
    expect(isInlinePreviewable({ path: '/a/rows.csv' })).toBe(true);
  });

  it('leaves images to canPreviewLocally', () => {
    /*
     * They load from the serve URL rather than the text or iframe path, and
     * org mode has no serve URL to load them from.
     */
    expect(isInlinePreviewable({ ext: '.png', path: '/a/logo.png' })).toBe(false);
    expect(canPreviewLocally({ ext: '.png', path: '/a/logo.png' })).toBe(true);
  });

  it('is false for a type the viewer has no renderer for', () => {
    expect(isInlinePreviewable({ ext: '.py', path: '/a/main.py' })).toBe(false);
    expect(canPreviewLocally({ ext: '.zip', path: '/a/report.zip' })).toBe(false);
  });
});

describe('canPreviewOrgDraft', () => {
  const draft = {
    ext: '.html',
    path: '/a/index.html',
    draftUrl: '/api/v1/artifacts/drafts/p/1/index.html',
  };

  it('is true for markup or text the draft endpoint serves', () => {
    expect(canPreviewOrgDraft(draft)).toBe(true);
    expect(canPreviewOrgDraft({ ...draft, ext: '.md', path: '/a/r.md' })).toBe(true);
  });

  it('needs a draft URL, because there is nothing else to read in org mode', () => {
    expect(canPreviewOrgDraft({ ...draft, draftUrl: '' })).toBe(false);
  });

  it('refuses a fullstack app, whose preview needs the desktop proxy', () => {
    expect(canPreviewOrgDraft({ ...draft, type: 'fullstack-stateless-app' })).toBe(false);
  });

  it('refuses an image, whose bytes come from the serve URL org mode blocks', () => {
    expect(canPreviewOrgDraft({ ...draft, ext: '.png', path: '/a/logo.png' })).toBe(false);
  });
});


describe('canDownloadOrgDraft', () => {
  /*
   * ENG-2044. The draft URL exists for every artifact with a primary file, so
   * "downloadable" is almost "has a draft" — the one exception is the reason
   * this is a predicate and not an inline `!!draftUrl`.
   */
  const DRAFT = '/api/v1/artifacts/drafts/p/11111111111111111111111111111111/x';

  it('is true for any non-app artifact with a draft URL, previewable or not', () => {
    expect(canDownloadOrgDraft({ draftUrl: DRAFT, ext: '.xlsx', type: 'file' })).toBe(true);
    expect(canDownloadOrgDraft({ draftUrl: DRAFT, ext: '.html', type: 'html-app' })).toBe(true);
    expect(canDownloadOrgDraft({ draftUrl: DRAFT, ext: '.png', type: 'image' })).toBe(true);
  });

  it('is false for a fullstack app: its primary is a shell index.html, not the app', () => {
    expect(canDownloadOrgDraft({
      draftUrl: `${DRAFT}/static/index.html`, ext: '.html', type: 'fullstack-stateless-app',
    })).toBe(false);
    expect(canDownloadOrgDraft({
      draftUrl: `${DRAFT}/static/index.html`, ext: '.html', type: 'fullstack-stateful-app',
    })).toBe(false);
  });

  it('is false without a draft URL — there is no primary file to stream', () => {
    expect(canDownloadOrgDraft({ draftUrl: '', ext: '.xlsx' })).toBe(false);
    expect(canDownloadOrgDraft(undefined)).toBe(false);
  });
});

describe('canDownloadArtifact', () => {
  const DRAFT = '/api/v1/artifacts/drafts/local/11111111111111111111111111111111/data.zip';
  const SERVE = '/v1/artifacts/serve/data/data.zip';

  it('is true when either URL carries the file', () => {
    expect(canDownloadArtifact({ draftUrl: DRAFT, ext: '.zip' })).toBe(true);
    expect(canDownloadArtifact({ serveUrl: SERVE, ext: '.zip' })).toBe(true);
    expect(canDownloadArtifact({ serveUrl: SERVE, draftUrl: DRAFT, ext: '.zip' })).toBe(true);
  });

  it('is false for a fullstack app, on either URL', () => {
    expect(canDownloadArtifact({ draftUrl: DRAFT, type: 'fullstack-stateless-app' })).toBe(false);
    expect(canDownloadArtifact({ serveUrl: SERVE, type: 'fullstack-stateful-app' })).toBe(false);
  });

  it('is false for a card with no URL at all', () => {
    expect(canDownloadArtifact({ ext: '.zip', path: '/a/data.zip' })).toBe(false);
    expect(canDownloadArtifact({ serveUrl: '', draftUrl: '' })).toBe(false);
    expect(canDownloadArtifact(undefined)).toBe(false);
  });
});

describe('canShowInBrowserTab', () => {
  it.each(FIXTURES.browserTab.opens)('is true for %s, which a tab renders', (ext) => {
    expect(canShowInBrowserTab({ ext, path: `/a/file${ext}` })).toBe(true);
    expect(canShowInBrowserTab({ path: `/a/file${ext}` })).toBe(true);
  });

  it.each(FIXTURES.browserTab.withheld)('is false for %s, which a surface keeps out of a tab', (ext) => {
    expect(canShowInBrowserTab({ ext, path: `/a/file${ext}` })).toBe(false);
  });

  it('is false for a missing artifact', () => {
    expect(canShowInBrowserTab(null)).toBe(false);
  });
});

// ENG-4684: the agent marks a chart or diagram to show live inside the reply
// with metadata `display: "inline"`. The server may hand the field over at
// the top of the card or under `metadata`; one predicate reads both.
describe('isInlineArtifact', () => {
  it('is true for display "inline" at the top level', () => {
    expect(isInlineArtifact({ display: 'inline', ext: '.html' })).toBe(true);
  });

  it('is true for display "inline" nested under metadata', () => {
    expect(isInlineArtifact({ metadata: { display: 'inline' } })).toBe(true);
  });

  it('tolerates case and surrounding whitespace', () => {
    expect(isInlineArtifact({ display: ' Inline ' })).toBe(true);
  });

  it('prefers the top-level field over the nested one', () => {
    expect(isInlineArtifact({ display: 'card', metadata: { display: 'inline' } })).toBe(false);
  });

  it('is false when the field is absent, empty or something else', () => {
    expect(isInlineArtifact(null)).toBe(false);
    expect(isInlineArtifact(undefined)).toBe(false);
    expect(isInlineArtifact({})).toBe(false);
    expect(isInlineArtifact({ display: '' })).toBe(false);
    expect(isInlineArtifact({ display: 'block' })).toBe(false);
    expect(isInlineArtifact({ display: true })).toBe(false);
    expect(isInlineArtifact({ metadata: null })).toBe(false);
  });

  it('is true for a widget too, which renders the same way', () => {
    expect(isInlineArtifact({ display: 'widget' })).toBe(true);
    expect(isInlineArtifact({ metadata: { display: ' Widget ' } })).toBe(true);
  });
});

// ENG-4684: `display: "widget"` collects input in the chat. It renders like
// an inline artifact but is not a deliverable (no share, publish or list row).
describe('isWidgetArtifact', () => {
  it('is true for display "widget", top level or nested', () => {
    expect(isWidgetArtifact({ display: 'widget' })).toBe(true);
    expect(isWidgetArtifact({ metadata: { display: 'WIDGET ' } })).toBe(true);
  });

  it('is false for inline and everything else', () => {
    expect(isWidgetArtifact({ display: 'inline' })).toBe(false);
    expect(isWidgetArtifact({ display: 'card', metadata: { display: 'widget' } })).toBe(false);
    expect(isWidgetArtifact({})).toBe(false);
    expect(isWidgetArtifact(null)).toBe(false);
    expect(isWidgetArtifact({ display: 1 })).toBe(false);
  });
});
