import { describe, expect, it } from 'vitest';
import {
  MAX_ARTIFACT_EXCERPT_CHARS, artifactExcerpt, artifactsOnScreen, describeArtifacts, htmlText, showArtifactOnScreen,
} from './screenArtifacts';

describe('artifacts on screen, for the voice operator', () => {
  it('reads each open artifact while it is shown, the latest first, and forgets one once closed', () => {
    const closeA = showArtifactOnScreen(() => ({ title: 'A', type: 'md', text: 'a' }));
    const closeB = showArtifactOnScreen(() => ({ title: 'B', type: 'html', text: 'b' }));
    expect(artifactsOnScreen().map((a) => a.title)).toEqual(['B', 'A']);
    closeB();
    expect(artifactsOnScreen().map((a) => a.title)).toEqual(['A']);
    closeA();
    expect(artifactsOnScreen()).toEqual([]);
  });

  it('skips a reader that fails or has nothing', () => {
    const closeA = showArtifactOnScreen(() => { throw new Error('gone'); });
    const closeB = showArtifactOnScreen(() => null);
    expect(artifactsOnScreen()).toEqual([]);
    closeA();
    closeB();
  });

  it('keeps a bounded excerpt, in lines the server never cuts', () => {
    const excerpt = artifactExcerpt('word '.repeat(2000));
    expect(excerpt.length).toBe(MAX_ARTIFACT_EXCERPT_CHARS);
    const lines = describeArtifacts([{ title: 'Long', type: 'txt', text: 'word '.repeat(2000) }]);
    expect(lines[0]).toBe('Open artifact: "Long" (txt). The start of its visible text:');
    expect(Math.max(...lines.slice(1).map((l) => l.length))).toBeLessThanOrEqual(202);
    expect(describeArtifacts([{ title: 'Chart', type: 'png', text: '' }])).toEqual(['Open artifact: "Chart" (png). No text of it can be read.']);
  });

  it("reads an HTML document's visible text without its scripts or styles", () => {
    expect(htmlText('<html><head><style>p{}</style></head><body><h1>Hi</h1><script>steal()</script><p>there</p></body></html>').replace(/\s+/g, ' ').trim())
      .toBe('Hi there');
  });
});
