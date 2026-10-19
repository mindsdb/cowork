import { describe, expect, it, vi } from 'vitest';

import { inlineHtmlAssets } from './inlineHtmlAssets';

/* A response as fetchAuthenticatedResponse hands it back: headers in, body unread. */
const response = (blob, headers = {}) => ({
  headers: new Headers(headers),
  blob: vi.fn(async () => blob),
  body: { cancel: vi.fn(async () => {}) },
});

const files = (map) => vi.fn(async (path) => {
  if (!(path in map)) throw Object.assign(new Error('missing'), { status: 404 });
  return response(new Blob([map[path]], { type: path.endsWith('.png') ? 'image/png' : 'text/plain' }));
});

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

describe('inlineHtmlAssets', () => {
  it('inlines a sibling stylesheet, script and image, resolved against the file', async () => {
    const fetchFile = files({
      'reports/style.css': 'p { color: green }',
      'reports/js/app.js': 'window.ok = 1;',
      'reports/img/logo.png': 'PNG',
    });
    const html = `<!doctype html><html><head><link rel="stylesheet" href="style.css">
      <script src="./js/app.js"></script></head><body><img src="img/logo.png"></body></html>`;

    const doc = parse(await inlineHtmlAssets(html, 'reports/q3.html', fetchFile));

    expect(doc.querySelector('link')).toBeNull();
    expect(doc.querySelector('style').textContent).toBe('p { color: green }');
    expect(doc.querySelector('script').hasAttribute('src')).toBe(false);
    expect(doc.querySelector('script').textContent).toBe('window.ok = 1;');
    expect(doc.querySelector('img').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('inlines relative url() refs inside the stylesheet, relative to the stylesheet', async () => {
    const fetchFile = files({
      'css/site.css': 'body { background: url("../img/bg.png") }',
      'img/bg.png': 'PNG',
    });

    const doc = parse(await inlineHtmlAssets(
      '<link rel="stylesheet" href="css/site.css">', 'page.html', fetchFile,
    ));

    expect(doc.querySelector('style').textContent).toMatch(/url\("data:image\/png;base64,[^"]+"\)/);
  });

  it('leaves external, rooted and data refs alone and never fetches them', async () => {
    const fetchFile = files({});
    const html = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/x.css">
      <script src="//cdn.example.com/a.js"></script><img src="/abs.png"><img src="data:image/png;base64,AA==">`;

    const doc = parse(await inlineHtmlAssets(html, 'page.html', fetchFile));

    expect(fetchFile).not.toHaveBeenCalled();
    expect(doc.querySelector('link').getAttribute('href')).toBe('https://cdn.jsdelivr.net/x.css');
    expect(doc.querySelector('script').getAttribute('src')).toBe('//cdn.example.com/a.js');
  });

  it('keeps the page when an asset is missing, losing only that asset', async () => {
    const fetchFile = files({ 'app.js': 'window.ok = 1;' });

    const doc = parse(await inlineHtmlAssets(
      '<link rel="stylesheet" href="gone.css"><script src="app.js"></script>', 'page.html', fetchFile,
    ));

    expect(doc.querySelector('link').getAttribute('href')).toBe('gone.css');
    expect(doc.querySelector('script').textContent).toBe('window.ok = 1;');
  });

  it('moves deferred scripts after the body, in order, since an inline script ignores defer', async () => {
    const fetchFile = files({ 'a.js': 'a();', 'b.js': 'b();' });
    const html = `<head><script src="a.js" defer></script>
      <script src="https://cdn.jsdelivr.net/lib.js" defer></script><script src="b.js" defer></script></head>
      <body><div id="chart"></div></body>`;

    const doc = parse(await inlineHtmlAssets(html, 'page.html', fetchFile));

    expect(doc.head.querySelector('script')).toBeNull();
    const scripts = [...doc.body.querySelectorAll('script')];
    expect(scripts.map((s) => s.getAttribute('src') || s.textContent))
      .toEqual(['a();', 'https://cdn.jsdelivr.net/lib.js', 'b();']);
    expect(scripts.some((s) => s.hasAttribute('defer'))).toBe(false);
    expect(doc.body.firstElementChild.id).toBe('chart');
  });

  it('rewrites each url() on its own, so one ref never rewrites a longer one containing it', async () => {
    const fetchFile = files({
      'site.css': '.a { background: url(bg.png) } .b { background: url(img/bg.png) }',
      'bg.png': 'ONE',
      'img/bg.png': 'TWO',
    });

    const css = parse(await inlineHtmlAssets(
      '<link rel="stylesheet" href="site.css">', 'page.html', fetchFile,
    )).querySelector('style').textContent;

    expect(css).not.toContain('img/data:');
    expect(css).toContain(`url(data:image/png;base64,${btoa('ONE')})`);
    expect(css).toContain(`url(data:image/png;base64,${btoa('TWO')})`);
  });

  it('keeps a stylesheet media query, and leaves alternate stylesheets as links', async () => {
    const fetchFile = files({ 'print.css': 'p { color: black }', 'dark.css': 'p { color: white }' });
    const html = `<link rel="stylesheet" media="print" href="print.css">
      <link rel="alternate stylesheet" title="Dark" href="dark.css">`;

    const doc = parse(await inlineHtmlAssets(html, 'page.html', fetchFile));

    expect(doc.querySelector('style').getAttribute('media')).toBe('print');
    expect(doc.querySelector('link').getAttribute('href')).toBe('dark.css');
    expect(fetchFile).not.toHaveBeenCalledWith('dark.css');
  });

  it('resolves refs in a folder whose name holds #, ? or %', async () => {
    const fetchFile = files({ 'Q3 #2/style.css': 'a {}', '50% off?/app.js': 'go();' });

    const css = parse(await inlineHtmlAssets(
      '<link rel="stylesheet" href="style.css">', 'Q3 #2/report.html', fetchFile,
    ));
    const js = parse(await inlineHtmlAssets('<script src="app.js"></script>', '50% off?/x.html', fetchFile));

    expect(css.querySelector('style').textContent).toBe('a {}');
    expect(js.querySelector('script').textContent).toBe('go();');
  });

  it('reads an asset once however many tags use it', async () => {
    const fetchFile = files({ 'ok.png': 'PNG' });

    const doc = parse(await inlineHtmlAssets(
      '<img src="ok.png"><img src="ok.png"><img src="./ok.png">', 'page.html', fetchFile,
    ));

    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect([...doc.querySelectorAll('img')].every((img) => img.src.startsWith('data:image/png'))).toBe(true);
  });

  /* happy-dom's parser doesn't model the state `<!--` then `<script` puts a real
     browser in, so this pins the escape itself. */
  it('escapes <!-- in inlined script so a later <script cannot swallow the page', async () => {
    const fetchFile = files({ 'lib.js': 'const t = "<!--<script>";' });

    const out = await inlineHtmlAssets('<script src="lib.js"></script>', 'page.html', fetchFile);

    expect(out).toContain('const t = "<\\x21--<script>";');
    expect(out).not.toContain('<!--');
  });

  it('keeps a legacy doctype rather than switching the page to standards mode', async () => {
    const legacy = '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">';

    const out = await inlineHtmlAssets(`${legacy}<html><body>old</body></html>`, 'page.html', files({}));

    expect(out.startsWith(legacy)).toBe(true);
  });

  /* The page's author may not be the viewer, and its scripts can read whatever
     is inlined, so reads stay where the desktop preview mount keeps them. */
  it('never reads above the file folder', async () => {
    const fetchFile = files({ 'secrets.env': 'KEY=1', 'reports/ok.png': 'PNG' });

    const doc = parse(await inlineHtmlAssets(
      '<img src="../secrets.env"><img src="ok.png">', 'reports/page.html', fetchFile,
    ));

    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(fetchFile).toHaveBeenCalledWith('reports/ok.png');
    expect(doc.querySelector('img').getAttribute('src')).toBe('../secrets.env');
  });

  it('never reads into a chat workspace the file does not sit in', async () => {
    const fetchFile = files({
      'conversations/theirs/notes.png': 'PNG',
      'conversations/mine/style.css': 'a {}',
    });

    await inlineHtmlAssets('<img src="conversations/theirs/notes.png">', 'page.html', fetchFile);
    await inlineHtmlAssets('<img src="theirs/notes.png">', 'conversations/door.html', fetchFile);
    const own = parse(await inlineHtmlAssets(
      '<link rel="stylesheet" href="style.css">', 'conversations/mine/page.html', fetchFile,
    ));

    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(own.querySelector('style').textContent).toBe('a {}');
  });

  /* `%2F..` survives URL resolution and only collapses once the request URL is
     fetched, which could reach another workspace or project. */
  it('refuses a path that still holds a dot segment after decoding', async () => {
    const fetchFile = files({});

    await inlineHtmlAssets(
      '<img src="x%2F..%2F..%2F..%2F..%2F..%2FQ%2Ffiles-raw%2Fsecret.txt"><img src="x%2F.%2Fy.png">',
      'conversations/a/report.html',
      fetchFile,
    );

    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('stops inlining once the total budget is spent, counting each copy', async () => {
    const fetchFile = files({ 'logo.png': 'PNG' });
    const once = (await inlineHtmlAssets('<img src="logo.png">', 'page.html', fetchFile)).match(/data:[^"]+/)[0];

    const doc = parse(await inlineHtmlAssets(
      '<img src="logo.png"><img src="logo.png"><img src="logo.png">', 'page.html', fetchFile,
      { maxInlineChars: once.length * 2 },
    ));

    const srcs = [...doc.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(srcs.filter((src) => src.startsWith('data:'))).toHaveLength(2);
    expect(srcs).toContain('logo.png');
  });

  it('adds the base when the page has only a <base target>', async () => {
    const doc = parse(await inlineHtmlAssets(
      '<html><head><base target="_blank"></head></html>', 'page.html', files({}),
      { baseUrl: 'https://cowork.test/api/v1/projects/acme/files-raw/page.html' },
    ));

    expect(doc.querySelector('base[href]')?.getAttribute('href'))
      .toBe('https://cowork.test/api/v1/projects/acme/files-raw/');
  });

  it('refuses an asset on its Content-Length, without downloading the body', async () => {
    const big = response(new Blob(['x']), { 'Content-Length': String(6 * 1024 * 1024) });
    const fetchFile = vi.fn(async () => big);

    const doc = parse(await inlineHtmlAssets('<img src="dump.png">', 'page.html', fetchFile));

    expect(big.blob).not.toHaveBeenCalled();
    expect(big.body.cancel).toHaveBeenCalled();
    expect(doc.querySelector('img').getAttribute('src')).toBe('dump.png');
  });

  it('stops fetching once the budget is spent', async () => {
    const fetchFile = files({ 'a.js': 'a();', 'b.png': 'PNG' });

    await inlineHtmlAssets('<script src="a.js"></script>', 'page.html', fetchFile, { maxInlineChars: 4 });
    await inlineHtmlAssets('<script src="a.js"></script><img src="b.png">', 'page.html', fetchFile, { maxInlineChars: 0 });

    expect(fetchFile).toHaveBeenCalledTimes(1);
  });

  it('keeps at most six reads in flight, so the budget is seen before most start', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchFile = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return response(new Blob(['PNG'], { type: 'image/png' }));
    });
    const html = Array.from({ length: 20 }, (_, i) => `<img src="${i}.png">`).join('');

    await inlineHtmlAssets(html, 'page.html', fetchFile);

    expect(fetchFile).toHaveBeenCalledTimes(20);
    expect(peak).toBe(6);
  });

  it('starts no reads once its signal is aborted', async () => {
    const fetchFile = files({ 'a.png': 'PNG' });
    const closed = new AbortController();
    closed.abort();

    await inlineHtmlAssets('<img src="a.png">', 'page.html', fetchFile, { signal: closed.signal });

    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('drops srcset once src is inlined, since a browser would prefer it', async () => {
    const doc = parse(await inlineHtmlAssets(
      '<img src="chart.png" srcset="chart@2x.png 2x">', 'page.html', files({ 'chart.png': 'PNG' }),
    ));

    expect(doc.querySelector('img').hasAttribute('srcset')).toBe(false);
  });

  it('reads a file whose name holds a bare % by its literal name, at any depth', async () => {
    const fetchFile = files({ 'growth_100%.png': 'PNG', 'my reports/growth_100%.png': 'PNG' });

    const root = parse(await inlineHtmlAssets('<img src="growth_100%.png">', 'page.html', fetchFile));
    const nested = parse(await inlineHtmlAssets('<img src="growth_100%.png">', 'my reports/page.html', fetchFile));

    expect(root.querySelector('img').getAttribute('src')).toMatch(/^data:image\/png/);
    expect(nested.querySelector('img').getAttribute('src')).toMatch(/^data:image\/png/);
  });

  it('keeps a stylesheet, without its images, when the images do not fit the budget', async () => {
    const fetchFile = files({ 'style.css': 'p { background: url(bg.png) }', 'bg.png': 'PNG'.repeat(100) });

    const doc = parse(await inlineHtmlAssets(
      '<link rel="stylesheet" href="style.css">', 'page.html', fetchFile, { maxInlineChars: 100 },
    ));

    expect(doc.querySelector('style').textContent).toBe('p { background: url(bg.png) }');
  });

  it('inlines scripts before images, so images cannot spend their budget', async () => {
    const fetchFile = files({ 'app.js': 'go();', 'big.png': 'PNG'.repeat(100) });

    const doc = parse(await inlineHtmlAssets(
      '<img src="big.png"><script src="app.js"></script>', 'page.html', fetchFile, { maxInlineChars: 10 },
    ));

    expect(doc.querySelector('script').textContent).toBe('go();');
    expect(doc.querySelector('img').getAttribute('src')).toBe('big.png');
  });

  it('drops a <picture>\'s sources once its <img> is inlined', async () => {
    const doc = parse(await inlineHtmlAssets(
      '<picture><source srcset="hero.webp"><img src="hero.png"></picture>', 'page.html', files({ 'hero.png': 'PNG' }),
    ));

    expect(doc.querySelector('source')).toBeNull();
    expect(doc.querySelector('img').getAttribute('src')).toMatch(/^data:image\/png/);
  });

  it('skips <noscript> content, which a scripted iframe never shows', async () => {
    const fetchFile = files({ 'big.png': 'PNG' });

    const doc = parse(await inlineHtmlAssets('<noscript><img src="big.png"></noscript>', 'page.html', fetchFile));

    expect(fetchFile).not.toHaveBeenCalled();
    expect(doc.querySelector('noscript')).toBeNull();
  });

  it('adds a base on the file folder and a fragment guard, unless the page has its own base', async () => {
    const fetchFile = files({ 'lib.js': 'const tag = "<base href=x>";' });
    const baseUrl = 'https://cowork.test/api/v1/projects/acme/files-raw/reports/q3.html';

    const ours = parse(await inlineHtmlAssets(
      '<html><head><script src="lib.js"></script></head></html>', 'reports/q3.html', fetchFile, { baseUrl },
    ));
    const theirs = parse(await inlineHtmlAssets(
      '<html><head><base href="https://elsewhere.test/"></head></html>', 'reports/q3.html', fetchFile, { baseUrl },
    ));

    expect(ours.head.firstElementChild.getAttribute('href'))
      .toBe('https://cowork.test/api/v1/projects/acme/files-raw/reports/');
    expect(ours.head.children[1].textContent).toContain("addEventListener('click'");
    expect(theirs.querySelectorAll('base')).toHaveLength(1);
    expect(theirs.querySelector('base').getAttribute('href')).toBe('https://elsewhere.test/');
  });

  it('escapes a closing tag inside inlined script so it cannot end the element early', async () => {
    const fetchFile = files({ 'app.js': 'const s = "</script><b>x</b>";' });

    const doc = parse(await inlineHtmlAssets('<script src="app.js"></script>', 'page.html', fetchFile));

    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelector('b')).toBeNull();
  });
});
