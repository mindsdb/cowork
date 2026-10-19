import { describe, expect, it, vi } from 'vitest';

import { inlineHtmlAssets } from './inlineHtmlAssets';

const files = (map) => vi.fn(async (path) => {
  if (!(path in map)) throw Object.assign(new Error('missing'), { status: 404 });
  return new Blob([map[path]], { type: path.endsWith('.png') ? 'image/png' : 'text/plain' });
});

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

describe('inlineHtmlAssets', () => {
  it('inlines a sibling stylesheet, script and image, resolved against the file', async () => {
    const fetchBlob = files({
      'reports/style.css': 'p { color: green }',
      'reports/js/app.js': 'window.ok = 1;',
      'shared/logo.png': 'PNG',
    });
    const html = `<!doctype html><html><head><link rel="stylesheet" href="style.css">
      <script src="./js/app.js"></script></head><body><img src="../shared/logo.png"></body></html>`;

    const doc = parse(await inlineHtmlAssets(html, 'reports/q3.html', fetchBlob));

    expect(doc.querySelector('link')).toBeNull();
    expect(doc.querySelector('style').textContent).toBe('p { color: green }');
    expect(doc.querySelector('script').hasAttribute('src')).toBe(false);
    expect(doc.querySelector('script').textContent).toBe('window.ok = 1;');
    expect(doc.querySelector('img').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('inlines relative url() refs inside the stylesheet, relative to the stylesheet', async () => {
    const fetchBlob = files({
      'css/site.css': 'body { background: url("../img/bg.png") }',
      'img/bg.png': 'PNG',
    });

    const doc = parse(await inlineHtmlAssets(
      '<link rel="stylesheet" href="css/site.css">', 'page.html', fetchBlob,
    ));

    expect(doc.querySelector('style').textContent).toMatch(/url\("data:image\/png;base64,[^"]+"\)/);
  });

  it('leaves external, rooted and data refs alone and never fetches them', async () => {
    const fetchBlob = files({});
    const html = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/x.css">
      <script src="//cdn.example.com/a.js"></script><img src="/abs.png"><img src="data:image/png;base64,AA==">`;

    const doc = parse(await inlineHtmlAssets(html, 'page.html', fetchBlob));

    expect(fetchBlob).not.toHaveBeenCalled();
    expect(doc.querySelector('link').getAttribute('href')).toBe('https://cdn.jsdelivr.net/x.css');
    expect(doc.querySelector('script').getAttribute('src')).toBe('//cdn.example.com/a.js');
  });

  it('keeps the page when an asset is missing, losing only that asset', async () => {
    const fetchBlob = files({ 'app.js': 'window.ok = 1;' });

    const doc = parse(await inlineHtmlAssets(
      '<link rel="stylesheet" href="gone.css"><script src="app.js"></script>', 'page.html', fetchBlob,
    ));

    expect(doc.querySelector('link').getAttribute('href')).toBe('gone.css');
    expect(doc.querySelector('script').textContent).toBe('window.ok = 1;');
  });

  it('moves deferred scripts after the body, in order, since an inline script ignores defer', async () => {
    const fetchBlob = files({ 'a.js': 'a();', 'b.js': 'b();' });
    const html = `<head><script src="a.js" defer></script>
      <script src="https://cdn.jsdelivr.net/lib.js" defer></script><script src="b.js" defer></script></head>
      <body><div id="chart"></div></body>`;

    const doc = parse(await inlineHtmlAssets(html, 'page.html', fetchBlob));

    expect(doc.head.querySelector('script')).toBeNull();
    const scripts = [...doc.body.querySelectorAll('script')];
    expect(scripts.map((s) => s.getAttribute('src') || s.textContent))
      .toEqual(['a();', 'https://cdn.jsdelivr.net/lib.js', 'b();']);
    expect(scripts.some((s) => s.hasAttribute('defer'))).toBe(false);
    expect(doc.body.firstElementChild.id).toBe('chart');
  });

  it('rewrites each url() on its own, so one ref never rewrites a longer one containing it', async () => {
    const fetchBlob = files({
      'site.css': '.a { background: url(bg.png) } .b { background: url(img/bg.png) }',
      'bg.png': 'ONE',
      'img/bg.png': 'TWO',
    });

    const css = parse(await inlineHtmlAssets(
      '<link rel="stylesheet" href="site.css">', 'page.html', fetchBlob,
    )).querySelector('style').textContent;

    expect(css).not.toContain('img/data:');
    expect(css).toContain(`url(data:image/png;base64,${btoa('ONE')})`);
    expect(css).toContain(`url(data:image/png;base64,${btoa('TWO')})`);
  });

  it('keeps a stylesheet media query, and leaves alternate stylesheets as links', async () => {
    const fetchBlob = files({ 'print.css': 'p { color: black }', 'dark.css': 'p { color: white }' });
    const html = `<link rel="stylesheet" media="print" href="print.css">
      <link rel="alternate stylesheet" title="Dark" href="dark.css">`;

    const doc = parse(await inlineHtmlAssets(html, 'page.html', fetchBlob));

    expect(doc.querySelector('style').getAttribute('media')).toBe('print');
    expect(doc.querySelector('link').getAttribute('href')).toBe('dark.css');
    expect(fetchBlob).not.toHaveBeenCalledWith('dark.css');
  });

  it('escapes a closing tag inside inlined script so it cannot end the element early', async () => {
    const fetchBlob = files({ 'app.js': 'const s = "</script><b>x</b>";' });

    const doc = parse(await inlineHtmlAssets('<script src="app.js"></script>', 'page.html', fetchBlob));

    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelector('b')).toBeNull();
  });
});
