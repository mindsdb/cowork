/*
 * Inlines an HTML file's relative assets so it renders from `srcdoc`, where the
 * page's own requests can't carry the Bearer token.
 *
 * Covers <link rel="stylesheet">, <script src>, <img src> and `url(...)` inside
 * the inlined CSS. Known limitations, which only an authenticated iframe `src`
 * would fix:
 *   - files the page loads at runtime (`fetch`, `import()`, CSS `@import`);
 *   - `srcset`, and `url(...)` in `style` attributes or <style> blocks;
 *   - external scripts and images the app's CSP blocks, since `srcdoc`
 *     inherits it.
 */

// Big enough for a report's images, small enough to keep `srcdoc` sane.
const ASSET_MAX_BYTES = 5 * 1024 * 1024;

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

// Anything with a scheme, protocol-relative, rooted, or a fragment is left alone.
const isRelative = (ref) => !!ref && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(ref.trim());

// `ref` resolved against `fromPath`, as a project-relative path. The base is
// encoded so a `#`, `?` or `%` in a folder or file name stays part of the path.
const resolvePath = (ref, fromPath) => {
  const base = `file:///${fromPath.split('/').map(encodeURIComponent).join('/')}`;
  return decodeURIComponent(new URL(ref.trim(), base).pathname.slice(1));
};

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/**
 * @param {string} html the file's markup
 * @param {string} filePath its project-relative path, to resolve refs against
 * @param {(path: string) => Promise<Blob>} fetchBlob reads a project file
 * @returns {Promise<string>} the markup with what could be inlined, inlined
 */
export async function inlineHtmlAssets(html, filePath, fetchBlob) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // An asset that fails or is too big is left as it was; the page loses only it.
  // Each path is read once, however many tags use it.
  const reads = new Map();
  const read = (path) => {
    if (!reads.has(path)) {
      reads.set(path, fetchBlob(path).then((blob) => {
        if (blob.size > ASSET_MAX_BYTES) throw new Error(`${path} is too large to inline`);
        return blob;
      }));
    }
    return reads.get(path);
  };
  const dataUrls = new Map();
  const readDataUrl = (path) => {
    if (!dataUrls.has(path)) dataUrls.set(path, read(path).then(toDataUrl));
    return dataUrls.get(path);
  };

  const inlineCssUrls = async (css, cssPath) => {
    const refs = [...new Set([...css.matchAll(CSS_URL)].map((m) => m[2]).filter(isRelative))];
    const found = await Promise.allSettled(
      refs.map(async (ref) => [ref, await readDataUrl(resolvePath(ref, cssPath))]),
    );
    const inlined = new Map(found.filter((r) => r.status === 'fulfilled').map((r) => r.value));
    // Replace inside each `url()` only, so `bg.png` can't rewrite `img/bg.png`.
    return css.replace(CSS_URL, (whole, quote, ref) => (
      inlined.has(ref) ? `url(${quote}${inlined.get(ref)}${quote})` : whole));
  };

  // An inline script ignores `defer`: run deferred classic scripts after the
  // body, in order, as defer would.
  for (const script of doc.querySelectorAll('script[src][defer]:not([type="module"])')) {
    script.removeAttribute('defer');
    doc.body.append(script);
  }

  const jobs = [];
  // Alternate stylesheets are off until the user picks one, so they stay links.
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]:not([rel~="alternate"])')) {
    const href = link.getAttribute('href');
    if (!isRelative(href)) continue;
    jobs.push((async () => {
      const path = resolvePath(href, filePath);
      const css = await inlineCssUrls(await (await read(path)).text(), path);
      const style = doc.createElement('style');
      if (link.media) style.media = link.media;
      // A literal `</style` would end the element early.
      style.textContent = css.replace(/<\/style/gi, '<\\/style');
      link.replaceWith(style);
    })());
  }
  for (const script of doc.querySelectorAll('script[src]')) {
    const src = script.getAttribute('src');
    if (!isRelative(src)) continue;
    jobs.push((async () => {
      const js = await (await read(resolvePath(src, filePath))).text();
      script.removeAttribute('src');
      // `</script` would end the element early, and `<!--` then `<script` would
      // stop the real end tag ending it. `\x21` is `!` in both strings and regexes.
      script.textContent = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\x21--');
    })());
  }
  for (const img of doc.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (!isRelative(src)) continue;
    jobs.push((async () => {
      img.setAttribute('src', await readDataUrl(resolvePath(src, filePath)));
    })());
  }
  await Promise.allSettled(jobs);

  // Keep the original doctype: a legacy one keeps the page in quirks mode.
  const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : '';
  return `${doctype}${doc.documentElement.outerHTML}`;
}
