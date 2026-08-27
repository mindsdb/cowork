import { describe, it, expect } from 'vitest';
import { isImageArtifact } from './artifactKinds';

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
