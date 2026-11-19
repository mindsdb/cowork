/*
 * Cleaning for the nodes docx-preview builds, before they enter the preview
 * frame's document. docx-preview copies link targets as the file writes them,
 * and builds CSS from style, font and VML values without escaping, so a
 * hostile file can carry a javascript: link or a url() aimed at any host. The
 * frame's policy refuses every load but data: and blob:, and cleaning removes
 * the targets as well, so no click or style in the preview tries a URL at all.
 */

/* Elements that embed another document, run script, change how the frame
   resolves URLs, or rewrite an attribute after cleaning (the SVG animation
   elements). docx-preview makes none of them with renderAltChunks off. */
const DROPPED_ELEMENTS = [
  'iframe', 'frame', 'frameset', 'object', 'embed', 'portal', 'fencedframe', 'script', 'link', 'meta', 'base',
  'animate', 'animateMotion', 'animateTransform', 'set',
].join(', ');

/* Attributes, other than href and src, that name a URL to load or open. */
const URL_ATTRIBUTES = new Set(['srcset', 'poster', 'ping', 'action', 'formaction', 'background', 'data']);

/* An image source the frame may load. Before the scheme it allows only what
   the URL parser strips, the control characters and space up to U+0020. A
   wider \s would also allow a no-break space or a byte order mark, which
   the parser keeps, so it would read the source as a path on the frame's
   own origin. */
const INLINE_SOURCE = /^[\x00-\x20]*(?:data|blob):/i;

/* The namespace of SVG elements, an SVG <image> among them. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/* A CSS function that loads a resource, whatever its argument. */
const CSS_LOADS = /(?:url|image-set|image|src)\(/i;

/* A CSS url() of a data: URL, which loads nothing from a host. */
const CSS_DATA_URL = /url\(\s*["']?\s*data:[^)]*\)/gi;

/* An SVG paint or clip reference to an element in the same document. */
const FRAGMENT_REFERENCE = /url\(\s*["']?#[^)]*\)/gi;

/* A custom property value that is one unquoted url() of a data: or blob: URL
   and nothing else, such as the picture bullet docx-preview writes from the
   blob: URL render.ts gives the file's numbering image. */
const ONLY_CSS_INLINE_URL = /^url\((?:data|blob):[^()"'\\\s]*\)$/i;

/* A function whose value the browser keeps as written until it substitutes it
   in the live document. */
const CSS_SUBSTITUTION = /(?:var|env|attr)\(/i;

/* A var() of a custom property with no fallback, as docx-preview writes for
   theme colors and theme fonts. */
const BARE_VAR = /var\(\s*--[\w-]+\s*\)/gi;

/* A quoted CSS string, escapes included. A raw line break ends a CSS string,
   so a match never spans one. */
const CSS_STRING = /"(?:[^"\\\n\r\f]|\\[\s\S])*"|'(?:[^'\\\n\r\f]|\\[\s\S])*'/g;

/* Rule types docx-preview writes: style rules, @font-face and @media. Any
   other rule in its CSS came from the file, so it goes. */
function isKeptRule(rule: CSSRule): rule is CSSStyleRule | CSSFontFaceRule | CSSMediaRule {
  return rule instanceof CSSStyleRule || rule instanceof CSSFontFaceRule || rule instanceof CSSMediaRule;
}

/* An SVG <image>. docx-preview draws a VML picture as one, with the
   picture's blob: URL from render.ts as its href. */
function isSvgImage(element: Element): boolean {
  return element.namespaceURI === SVG_NAMESPACE && element.localName === 'image';
}

function loadsInCss(value: string): boolean {
  return CSS_LOADS.test(value.replace(CSS_DATA_URL, ''));
}

/*
 * Whether a property's value could spell a url() once the browser substitutes
 * it. A value that holds var(), env() or attr() keeps its text as written,
 * escapes and comments included, so an escaped url name such as \75rl( passes
 * loadsInCss and still loads in the frame. Such a value may hold bare
 * var(--name) references and no other function. Any value goes that holds a
 * comment or a backslash outside its quoted strings, which also covers an
 * escaped function name such as v\61r(. A value the browser parsed keeps a
 * backslash only inside a string, such as the tab after a list number
 * (content: "1.\9 "), and keeps no comment.
 */
function substitutesUnsafely(value: string): boolean {
  const outsideStrings = value.replace(CSS_STRING, '""');
  if (outsideStrings.includes('\\') || outsideStrings.includes('/*')) return true;
  return CSS_SUBSTITUTION.test(outsideStrings) && outsideStrings.replace(BARE_VAR, '').includes('(');
}

/*
 * Removes each declaration that would load a resource from a host. A custom
 * property keeps only plain tokens, or a lone url() of a data: or blob: URL,
 * since the browser keeps its text as written and a var() can place it where
 * a url() loads. Any other property goes when its value loads, or could load
 * once the browser substitutes it (substitutesUnsafely).
 *
 * A shorthand that holds a var() also keeps its text as written, escapes
 * included, and the browser reports each of its longhands as ''. Those
 * longhands go too when the block's text holds a backslash or still loads
 * something.
 */
function cleanDeclarations(style: CSSStyleDeclaration): void {
  const names = Array.from({ length: style.length }, (_, index) => style.item(index));
  for (const name of names) {
    const value = style.getPropertyValue(name);
    const loads = name.startsWith('--')
      ? /[\\(]/.test(value) && !ONLY_CSS_INLINE_URL.test(value.trim())
      : loadsInCss(value) || substitutesUnsafely(value);
    if (loads) style.removeProperty(name);
  }
  const pending = Array.from({ length: style.length }, (_, index) => style.item(index))
    .filter((name) => !name.startsWith('--') && style.getPropertyValue(name) === '');
  if (pending.length > 0 && (style.cssText.includes('\\') || loadsInCss(style.cssText))) {
    for (const name of pending) style.removeProperty(name);
  }
}

interface RuleList { cssRules: CSSRuleList; deleteRule(index: number): void }

function cleanRules(list: RuleList): void {
  for (let index = list.cssRules.length - 1; index >= 0; index -= 1) {
    const rule = list.cssRules[index];
    if (!isKeptRule(rule)) {
      list.deleteRule(index);
      continue;
    }
    if (!(rule instanceof CSSMediaRule)) cleanDeclarations(rule.style);
    if ('cssRules' in rule) cleanRules(rule);
  }
}

/*
 * The style sheet text with every rule and declaration that loads from a host
 * removed. The browser parses the text into a constructed sheet, which never
 * loads anything and ignores @import, so cleaning reads the CSS the way the
 * frame would and writes back the browser's own serialization.
 */
export function cleanStyleSheetText(text: string): string {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  cleanRules(sheet);
  return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
}

function cleanAttributes(element: Element): void {
  for (const attribute of [...element.attributes]) {
    const name = attribute.localName.toLowerCase();
    let keep: boolean;
    if (name === 'href') keep = attribute.value.startsWith('#') || (isSvgImage(element) && INLINE_SOURCE.test(attribute.value));
    else if (name === 'src') keep = INLINE_SOURCE.test(attribute.value);
    else if (name === 'style') keep = true;
    else if (name.startsWith('on') || URL_ATTRIBUTES.has(name)) keep = false;
    /* An SVG paint attribute such as fill or stroke is read as CSS, where an
       escape like u\72l( still spells url( and CSS_LOADS misses it. So any
       other attribute goes when its value holds a backslash, as a custom
       property does. */
    else keep = !attribute.value.includes('\\') && !loadsInCss(attribute.value.replace(FRAGMENT_REFERENCE, ''));
    if (!keep) element.removeAttributeNode(attribute);
  }
  if (!element.hasAttribute('style')) return;
  /* HTML, SVG and MathML elements parse their style attribute. The cleaned
     declarations replace the attribute's text, so it keeps only what the
     browser parsed. An element of any other namespace has no declarations to
     clean, so it loses the attribute. */
  const { style } = element as Element & Partial<ElementCSSInlineStyle>;
  if (style) cleanDeclarations(style);
  if (style?.cssText) element.setAttribute('style', style.cssText);
  else element.removeAttribute('style');
}

/*
 * Cleans everything inside container: drops embedding and script elements,
 * removes every href but an in-page #fragment or an SVG image's data: or
 * blob: source (xlink:href too, matched by local name), every src that isn't
 * data: or blob:, every event handler and every other attribute that names a
 * URL to load, and every CSS rule or declaration, in <style> text or a style
 * attribute, that loads from a host.
 */
export function cleanRenderedNodes(container: Element): void {
  for (const element of container.querySelectorAll(DROPPED_ELEMENTS)) element.remove();
  for (const style of container.querySelectorAll('style')) {
    style.textContent = cleanStyleSheetText(style.textContent ?? '');
  }
  for (const element of container.querySelectorAll('*')) cleanAttributes(element);
}

/*
 * Stops every link activation inside root in the capture phase, before the
 * link sees it. A #fragment link scrolls to its target inside root instead, so
 * the frame's URL never changes.
 *
 * The frame runtime's stayInFrame (runtime/frame.ts) cancels link clicks at
 * the document as well, and its listener runs first. This one is the
 * renderer's own layer, as the Word preview's design asks, so links stay
 * inert whatever the runtime's guard does. It looks the id up as written,
 * with no percent-decoding, because docx-preview writes a bookmark's name
 * verbatim both as the target's id and after the '#' of the link to it.
 */
export function keepLinksInPage(root: HTMLElement): void {
  const hold = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter') return;
    const link = event.target instanceof Element ? event.target.closest('a, area') : null;
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (href?.startsWith('#')) {
      const target = root.ownerDocument.getElementById(href.slice(1));
      if (target && root.contains(target)) target.scrollIntoView();
    }
  };
  for (const type of ['click', 'auxclick', 'keydown']) root.addEventListener(type, hold, true);
}
