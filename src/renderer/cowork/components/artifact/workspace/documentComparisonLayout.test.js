// A document comparison's two sides are the viewer's DocumentPreview, which is
// absolutely placed over the stage (documentPreview.css). Without an override
// both previews escape their halves to the comparison panel and stack, the
// newer version over the older one and over the header (ENG-4687). happy-dom
// does no layout, so the source invariant is locked instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const workspaceCss = read('src/renderer/cowork/components/artifact/artifactWorkspace.css');
const previewCss = read('src/renderer/cowork/preview/documentPreview.css');

function ruleBody(css, selector) {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return null;
  const open = at + selector.length + 1;
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('document comparison layout (ENG-4687)', () => {
  it('the document preview is absolutely placed on its own', () => {
    expect(ruleBody(previewCss, '.document-preview')).toMatch(/position:\s*absolute/);
  });

  it('keeps each version in its own half of the comparison', () => {
    const preview = ruleBody(workspaceCss, '.artifact-compare-documents .document-preview');
    expect(preview, 'comparison preview rule not found').not.toBeNull();
    expect(preview).toMatch(/position:\s*relative/);
    expect(preview).toMatch(/inset:\s*auto/);
    expect(ruleBody(workspaceCss, '.artifact-compare-documents section')).toMatch(/position:\s*relative/);
  });
});
