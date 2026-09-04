import { describe, it, expect } from 'vitest';
import {
  canDownloadOrgDraft,
  canPreviewLocally, canPreviewOrgDraft, isImageArtifact, isInlinePreviewable,
} from './artifactKinds';

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
    expect(canPreviewLocally({ ext: '.docx', path: '/a/report.docx' })).toBe(false);
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
