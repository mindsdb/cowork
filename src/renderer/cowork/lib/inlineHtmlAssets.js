/*
 * Inlines an HTML file's relative assets so it renders from `srcdoc`, where the
 * page's own requests can't carry the Bearer token.
 *
 * Covers <link rel="stylesheet">, <script src>, <img src> and `url(...)` inside
 * the inlined CSS. Known limitations, which only an authenticated iframe `src`
 * would fix:
 *   - files the page loads at runtime (`fetch`, `import()`, CSS `@import`),
 *     and the `import`s of an inlined module script;
 *   - `srcset`, and `url(...)` in `style` attributes or <style> blocks;
 *   - external scripts and images the app's CSP blocks, since `srcdoc`
 *     inherits it.
 */

import { DRAFT_FRAGMENT_GUARD_SCRIPT } from '../components/artifact/artifactPreviewUtils';

// Big enough for a report's images, small enough to keep `srcdoc` sane.
const ASSET_MAX_BYTES = 5 * 1024 * 1024;
// Everything inlined, counting each copy of a repeated asset; past it, the
// rest stays un-inlined rather than freezing the tab.
const INLINE_TOTAL_MAX_CHARS = 50 * 1024 * 1024;
// Fetches in flight at once, so the budget is seen before most downloads start.
const MAX_PARALLEL_READS = 6;

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

// Anything with a scheme, protocol-relative, rooted, or a fragment is left alone.
const isRelative = (ref) => !!ref && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(ref.trim());

// `ref` resolved against `fromPath`, as a project-relative path. The base is
// encoded so a `#`, `?` or `%` in a folder or file name stays part of the path.
// A bare `%` (`growth_100%.png`) can't be decoded, so it stays literal.
const resolvePath = (ref, fromPath) => {
  const base = `file:///${fromPath.split('/').map(encodeURIComponent).join('/')}`;
  const path = new URL(ref.trim(), base).pathname.slice(1);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// The chat workspace a project path sits in, or null for a shared file; the
// same split cowork-server's preview mount makes.
const workspaceOf = (path) => (path.startsWith('conversations/') ? path.split('/')[1] : null);

/**
 * @param {string} html the file's markup
 * @param {string} filePath its project-relative path, to resolve refs against
 * @param {(path: string) => Promise<Response>} fetchFile reads a project file,
 *   its body unread
 * @param {{ baseUrl?: string, maxInlineChars?: number, signal?: AbortSignal }} [options]
 *   `baseUrl` is the file's absolute URL, to base anything left un-inlined on
 *   its folder; `signal` stops reads that haven't started
 * @returns {Promise<string>} the markup with what could be inlined, inlined
 */
export async function inlineHtmlAssets(
  html,
  filePath,
  fetchFile,
  { baseUrl, maxInlineChars = INLINE_TOTAL_MAX_CHARS, signal } = {},
) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // The iframe runs scripts, so <noscript> content never shows; don't fetch it.
  for (const el of doc.querySelectorAll('noscript')) el.remove();

  // The page's author may not be the viewer, and whatever is inlined, its
  // scripts can read. So, like the desktop preview mount, read only under the
  // file's own folder, and no chat workspace but the one the file sits in.
  // A `.` or `..` left after decoding (from `%2F..`) would only resolve once
  // the URL is fetched, after this check, so it is refused outright.
  const dir = filePath.slice(0, filePath.lastIndexOf('/') + 1);
  const mayRead = (path) => path.startsWith(dir)
    && !path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
    && (workspaceOf(path) === null || workspaceOf(path) === workspaceOf(filePath));

  let budget = maxInlineChars;
  const spend = (text) => {
    if (text.length > budget) throw new Error('Inline budget spent');
    budget -= text.length;
    return text;
  };

  // The budget is charged once an asset is inlined, so the reads in flight can
  // overshoot it by up to MAX_PARALLEL_READS assets.
  let active = 0;
  const waiting = [];
  // A finished read hands its slot straight to the next waiting one, so a new
  // caller can't take it in between.
  const withSlot = async (task) => {
    if (active < MAX_PARALLEL_READS) active += 1;
    else await new Promise((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };

  // An asset that fails or is too big is left as it was; the page loses only it.
  // Each path is read once, however many tags use it.
  const reads = new Map();
  const read = (path) => {
    if (!reads.has(path)) {
      reads.set(path, withSlot(async () => {
        if (!mayRead(path)) throw new Error(`${path} is outside the preview's folder`);
        if (signal?.aborted) throw new Error('Preview closed');
        if (budget <= 0) throw new Error('Inline budget spent');
        const tooLarge = new Error(`${path} is too large to inline`);
        const response = await fetchFile(path);
        // Refuse on the header, before the body downloads, as readInlineText does.
        const length = Number(response.headers?.get('Content-Length'));
        if (length > ASSET_MAX_BYTES || length > budget) {
          response.body?.cancel().catch(() => {});
          throw tooLarge;
        }
        const blob = await response.blob();
        if (blob.size > ASSET_MAX_BYTES) throw tooLarge;
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
      const css = spend(await inlineCssUrls(await (await read(path)).text(), path));
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
      const js = spend(await (await read(resolvePath(src, filePath))).text());
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
      img.setAttribute('src', spend(await readDataUrl(resolvePath(src, filePath))));
      // A browser prefers `srcset`, whose relative entries would go un-authed.
      img.removeAttribute('srcset');
    })());
  }
  await Promise.allSettled(jobs);

  // The base and fragment guard artifact drafts use, added through the DOM so
  // text inside an inlined file can't pass for a page's own <base>.
  let baseDir = '';
  try { baseDir = baseUrl ? new URL('.', baseUrl).href : ''; } catch { /* relative: no base */ }
  // Only a base with an href decides resolution; `<base target>` alone doesn't.
  if (baseDir && !doc.querySelector('base[href]')) {
    const base = doc.createElement('base');
    base.setAttribute('href', baseDir);
    const guard = doc.createElement('script');
    guard.textContent = DRAFT_FRAGMENT_GUARD_SCRIPT;
    doc.head.prepend(base, guard);
  }

  // Keep the original doctype: a legacy one keeps the page in quirks mode.
  const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : '';
  return `${doctype}${doc.documentElement.outerHTML}`;
}
