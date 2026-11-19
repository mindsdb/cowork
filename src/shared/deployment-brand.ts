// A deployment brand: the product name, style, theme, logo and icons that a
// web build reads at run time from its own origin, with the platform UI on or
// off. One build then serves every deployment, and a deployment changes its
// brand by serving different files at these paths. Cowork ships stock files
// there (src/renderer/public/brand/), so a deployment that serves nothing of
// its own looks stock. Desktop never loads either file.

/** The brand's config: a classic script that sets `window[BRAND_GLOBAL]`. */
export const BRAND_SCRIPT_PATH = '/brand/brand.js';

/** The brand's stylesheet, loaded after the bundle's own CSS. */
export const BRAND_STYLESHEET_PATH = '/brand/brand.css';

/** The global the brand's config sets. */
export const BRAND_GLOBAL = 'COWORK_DEPLOYMENT_BRAND';

/** The longest product name in Unicode code points, after trimming. */
export const PRODUCT_NAME_MAX_LENGTH = 64;

/**
 * Puts the brand's name in the tab while the head parses, before the bundle
 * downloads, so the tab never shows the stock name first. It applies the same
 * rule as `parseDeploymentBrand` in lib/deploymentBrand.ts; a test runs both
 * over one table so the two can't drift.
 */
export const TITLE_SNIPPET =
  `(function(){var b=window.${BRAND_GLOBAL};` +
  `var n=b&&typeof b==='object'&&typeof b.productName==='string'?b.productName.trim():'';` +
  `if(n&&Array.from(n).length<=${PRODUCT_NAME_MAX_LENGTH})document.title=n;})();`;

const TITLE_END = '</title>';
const HEAD_END = '</head>';
const TITLE_START = '<title>';
const ICON = '<link rel="icon" type="image/svg+xml" href="/minds-icon.svg" />';
const TOUCH_ICON = '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />';
const BRAND_SHELL_START = '<!-- cowork-deployment-brand:start -->';
const BRAND_SHELL_END = '<!-- cowork-deployment-brand:end -->';

/**
 * Marks the stock title, comment and icons as one region a deployment server
 * can replace before sending the page. Without a replacement they stay stock.
 * The blocking config script and title line follow the region, before the
 * bundle; the stylesheet goes last in the head, after the bundle's CSS.
 * The script must stay a blocking classic script: the style list is built
 * when the bundle loads, so a brand that arrived later would miss it.
 *
 * Refuses missing, duplicate or reordered anchors and existing markers, so a
 * changed template fails the build instead of marking the wrong content.
 */
export function withDeploymentBrand(html: string): string {
  if (html.includes(BRAND_SHELL_START) || html.includes(BRAND_SHELL_END)) {
    throw new Error('The web page must not already contain deployment brand markers.');
  }
  let previous = -1;
  for (const anchor of ['<head>', TITLE_START, TITLE_END, ICON, TOUCH_ICON, HEAD_END]) {
    if (html.split(anchor).length !== 2) {
      throw new Error(`The web page needs exactly one ${anchor} to take the deployment brand.`);
    }
    const position = html.indexOf(anchor);
    if (position <= previous) {
      throw new Error('The web page needs its head, title and icons in order to take the deployment brand.');
    }
    previous = position;
  }

  return html
    .replace(TITLE_START, `${BRAND_SHELL_START}\n    ${TITLE_START}`)
    .replace(
      TOUCH_ICON,
      `${TOUCH_ICON}\n    ${BRAND_SHELL_END}\n    <script src="${BRAND_SCRIPT_PATH}"></script>\n    <script>${TITLE_SNIPPET}</script>`,
    )
    .replace(HEAD_END, `  <link rel="stylesheet" href="${BRAND_STYLESHEET_PATH}" />\n  ${HEAD_END}`);
}
