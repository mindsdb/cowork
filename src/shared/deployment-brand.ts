// A deployment brand: the product name, style, theme, logo and icons that a
// web build with the platform UI off reads at run time from its own origin.
// One build then serves every deployment, and a deployment changes its brand
// by serving different files at these paths. Cowork ships stock files there
// (src/renderer/public/brand/), so a deployment that serves nothing of its own
// looks stock. Hosted web and desktop never load either file.

/** The brand's config: a classic script that sets `window[BRAND_GLOBAL]`. */
export const BRAND_SCRIPT_PATH = '/brand/brand.js';

/** The brand's stylesheet, loaded after the bundle's own CSS. */
export const BRAND_STYLESHEET_PATH = '/brand/brand.css';

/** The global the brand's config sets. */
export const BRAND_GLOBAL = 'COWORK_DEPLOYMENT_BRAND';

/** The longest product name a brand may set, after trimming. */
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
  `if(n&&n.length<=${PRODUCT_NAME_MAX_LENGTH})document.title=n;})();`;

const TITLE_END = '</title>';
const HEAD_END = '</head>';

/**
 * Adds the brand's tags to a web page: the config script and the title line
 * right after `<title>`, so both run before the bundle, and the stylesheet
 * last in the head, after the bundle's CSS. The script must stay a blocking
 * classic script: the style list is built when the bundle loads, so a brand
 * that arrived later would miss it.
 *
 * Throws when the page lacks exactly one `</title>` and one `</head>`, so a
 * reworked page fails the build instead of silently dropping the brand.
 */
export function withDeploymentBrand(html: string): string {
  for (const anchor of [TITLE_END, HEAD_END]) {
    if (html.split(anchor).length !== 2) {
      throw new Error(`The web page needs exactly one ${anchor} to take the deployment brand.`);
    }
  }
  return html
    .replace(
      TITLE_END,
      `${TITLE_END}\n    <script src="${BRAND_SCRIPT_PATH}"></script>\n    <script>${TITLE_SNIPPET}</script>`,
    )
    .replace(HEAD_END, `  <link rel="stylesheet" href="${BRAND_STYLESHEET_PATH}" />\n  ${HEAD_END}`);
}
