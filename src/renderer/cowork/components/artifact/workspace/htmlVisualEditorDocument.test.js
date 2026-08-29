import { describe, expect, it } from 'vitest';
import {
  applyHtmlVisualEdit,
  applyHtmlVisualEditAtRanges,
  createHtmlVisualComparisonDocuments,
  createHtmlVisualEditorDocument,
  sanitizeHtmlVisualEdit,
} from './htmlVisualEditorDocument';

describe('HTML visual editor document', () => {
  it('marks authored text blocks without exposing HTML as the primary editor', () => {
    const html = `<!doctype html>
      <html><head><title>Deck</title></head><body>
        <main class="slide">
          <h1>Quarterly <em>review</em></h1>
          <p>One clear sentence.</p>
          <div><span>Supporting label</span></div>
        </main>
      </body></html>`;

    const result = createHtmlVisualEditorDocument(html, {
      baseUrl: 'https://draft.example/deck/index.html',
      token: 'test-token',
    });

    expect(result.editableCount).toBe(3);
    expect(result.content).toContain('data-cowork-editable-id="cowork-edit-0" tabindex="0"');
    expect(result.content).toContain('data-cowork-editable-id="cowork-edit-2"');
    expect(result.content).toContain('<base href="https://draft.example/deck/index.html">');
    expect(result.content.indexOf('test-token')).toBeLessThan(result.content.indexOf('<title>Deck</title>'));
  });

  it('does not inject an invalid base element for embedded preview URLs', () => {
    const result = createHtmlVisualEditorDocument('<h1>Hello</h1>', {
      baseUrl: 'data:text/html,%3Ch1%3EHello%3C%2Fh1%3E',
      token: 'embedded-token',
    });

    expect(result.content).not.toContain('<base');
  });

  it('builds rendered comparison documents and highlights changed copy', () => {
    const before = '<html><body><h1>Quarterly review</h1><p>Keep this.</p></body></html>';
    const after = '<html><body><h1>Launch review</h1><p>Keep this.</p></body></html>';
    const result = createHtmlVisualComparisonDocuments(before, after, {
      baseUrl: 'https://draft.example/deck.html',
    });

    expect(result.changes).toEqual([{ before: 'Quarterly review', after: 'Launch review' }]);
    expect(result.before).toContain('<h1 data-cowork-comparison-change="">Quarterly review</h1>');
    expect(result.after).toContain('<h1 data-cowork-comparison-change="">Launch review</h1>');
    expect(result.before).toContain('<base href="https://draft.example/deck.html">');
    expect(result.before).not.toContain('data-cowork-editable-id');
  });

  it('keeps a text replacement paired when the updated element gains an id', () => {
    const result = createHtmlVisualComparisonDocuments(
      '<main><h2>At a glance</h2><p>Clear and warm.</p></main>',
      '<main><h2>At a glance</h2><p id="summary">Current conditions.</p></main>',
    );

    expect(result.changes).toEqual([
      { before: 'Clear and warm.', after: 'Current conditions.' },
    ]);
  });

  it('keeps embedded comparison documents free of invalid base elements', () => {
    const result = createHtmlVisualComparisonDocuments('<h1>Before</h1>', '<h1>After</h1>', {
      baseUrl: 'data:text/html,%3Ch1%3EAfter%3C%2Fh1%3E',
    });

    expect(result.before).not.toContain('<base');
    expect(result.after).not.toContain('<base');
  });

  it('updates only the selected source range and keeps artifact logic untouched', () => {
    const html = `<!doctype html>
<html><body>
  <h1>Repeat</h1>
  <p>Repeat <em>now</em></p>
  <script>window.advanceSlide()</script>
</body></html>`;

    const next = applyHtmlVisualEdit(html, 'cowork-edit-1', 'Ready <em>today</em>');

    expect(next).toContain('<h1>Repeat</h1>');
    expect(next).toContain('<p>Ready <em>today</em></p>');
    expect(next).toContain('<script>window.advanceSlide()</script>');
    expect(next.split('\n')).toHaveLength(html.split('\n').length);
  });

  it('removes executable markup from edited text before it reaches the draft', () => {
    const edited = sanitizeHtmlVisualEdit(
      'Safe<script>alert(1)</script>'
      + '<a href="javascript:alert(1)" onclick="steal()">link</a>'
      + '<span style="background:url(javascript:steal())">text</span>',
    );

    expect(edited).toBe('Safe<a>link</a><span>text</span>');
  });

  it('preserves inert authoring comments inside an edited text block', () => {
    expect(sanitizeHtmlVisualEdit('Before<!-- keep -->after'))
      .toBe('Before<!-- keep -->after');
  });

  it('does not make explicitly locked or structurally complex regions editable', () => {
    const html = `<html><body>
      <p contenteditable="false">Locked by the artifact</p>
      <div>Before <section><p>Inside</p></section> after</div>
      <p aria-hidden="true">Hidden label</p>
    </body></html>`;

    const result = createHtmlVisualEditorDocument(html, { token: 'test-token' });

    expect(result.editableCount).toBe(1);
    expect(result.content).toContain(
      '<p data-cowork-editable-id="cowork-edit-0" tabindex="0">Inside</p>',
    );
    expect(result.content).not.toContain('contenteditable="false" data-cowork-editable-id');
  });

  it('fails safely when an obsolete element id is submitted', () => {
    expect(() => applyHtmlVisualEdit('<h1>Hello</h1>', 'cowork-edit-4', 'Goodbye'))
      .toThrow('no longer available');
  });

  it('fails safely when a stale range points outside the current source', () => {
    expect(() => applyHtmlVisualEditAtRanges(
      '<h1>Short</h1>',
      [{ id: 'cowork-edit-0', start: 4, end: 500 }],
      'cowork-edit-0',
      'Next',
    )).toThrow('no longer available');
  });

  it('keeps an element identity stable while its text is temporarily empty', () => {
    const html = '<html><body><h1>Title</h1><p>Body</p></body></html>';
    const document = createHtmlVisualEditorDocument(html, { token: 'test-token' });

    const emptied = applyHtmlVisualEditAtRanges(
      html,
      document.elements,
      'cowork-edit-0',
      '',
    );
    const retyped = applyHtmlVisualEditAtRanges(
      emptied.content,
      emptied.elements,
      'cowork-edit-0',
      'New title',
    );

    expect(retyped.content).toContain('<h1>New title</h1>');
    expect(retyped.content).toContain('<p>Body</p>');
  });
});
