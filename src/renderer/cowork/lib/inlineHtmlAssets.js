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

// Anything with a scheme, protocol-relative, rooted, or a fragment is left alone.
const isRelative = (ref) => !!ref && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(ref.trim());

// `ref` resolved against `fromPath`, as a project-relative path.
const resolvePath = (ref, fromPath) =>
  decodeURIComponent(new URL(ref.trim(), `file:///${fromPath}`).pathname.slice(1));

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
  const read = async (path) => {
    const blob = await fetchBlob(path);
    if (blob.size > ASSET_MAX_BYTES) throw new Error(`${path} is too large to inline`);
    return blob;
  };

  const inlineCssUrls = async (css, cssPath) => {
    const refs = [...new Set([...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]
      .map((m) => m[2]).filter(isRelative))];
    const found = await Promise.allSettled(
      refs.map(async (ref) => [ref, await toDataUrl(await read(resolvePath(ref, cssPath)))]),
    );
    return found.reduce((out, r) => (r.status === 'fulfilled'
      ? out.split(r.value[0]).join(r.value[1])
      : out), css);
  };

  const jobs = [];
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const href = link.getAttribute('href');
    if (!isRelative(href)) continue;
    jobs.push((async () => {
      const path = resolvePath(href, filePath);
      const css = await inlineCssUrls(await (await read(path)).text(), path);
      const style = doc.createElement('style');
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
      script.textContent = js.replace(/<\/script/gi, '<\\/script');
    })());
  }
  for (const img of doc.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (!isRelative(src)) continue;
    jobs.push((async () => {
      img.setAttribute('src', await toDataUrl(await read(resolvePath(src, filePath))));
    })());
  }
  await Promise.allSettled(jobs);

  return `${doc.doctype ? '<!DOCTYPE html>' : ''}${doc.documentElement.outerHTML}`;
}
