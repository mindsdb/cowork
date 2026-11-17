/* User-visible copy built in src/shared (ENG-4149).

   Shared modules may also load in the Electron main process, which has no
   i18n runtime, so they never import the renderer's. A shared function that
   returns text the renderer shows takes a `Translate` instead: the renderer
   passes one bound to the namespace the function documents
   (`sharedTranslator('app')` from src/renderer/lib/i18n.ts), and without one
   the text comes out in English, formatted from the source catalog, so the
   catalog stays the only copy of the English.

   The English fallback formats the ICU subset these messages use: `{name}`,
   `{name, select, … other {…}}` and `{count, plural, one {…} other {…}}`
   with `#`. It has no dependencies, so the main process can load it. */

export type Translate = (key: string, vars?: Record<string, unknown>) => string;

type Catalog = { [key: string]: string | Catalog };

/** English from `catalog`, the source-language (en) JSON of one namespace. */
export function sourceTranslator(catalog: Catalog): Translate {
  return (key, vars = {}) => {
    let node: string | Catalog | undefined = catalog;
    for (const part of key.split('.')) {
      node = typeof node === 'object' ? node[part] : undefined;
    }
    return typeof node === 'string' ? formatMessage(node, vars) : key;
  };
}

const plural = new Intl.PluralRules('en');

/** Formats one ICU message. Exported for tests. */
export function formatMessage(message: string, vars: Record<string, unknown>, pound?: string): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const ch = message[i];
    if (ch === '#' && pound !== undefined) { out += pound; i += 1; continue; }
    if (ch !== '{') { out += ch; i += 1; continue; }
    const end = matchingBrace(message, i);
    out += formatArgument(message.slice(i + 1, end), vars, pound);
    i = end + 1;
  }
  return out;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  throw new Error(`Unbalanced braces in message: ${text}`);
}

function formatArgument(body: string, vars: Record<string, unknown>, pound?: string): string {
  const first = body.indexOf(',');
  if (first < 0) return String(vars[body.trim()] ?? '');
  const name = body.slice(0, first).trim();
  const rest = body.slice(first + 1);
  const second = rest.indexOf(',');
  const type = rest.slice(0, second).trim();
  const options = parseOptions(rest.slice(second + 1));
  const value = vars[name];
  if (type === 'plural') {
    const n = Number(value);
    const message = options[`=${n}`] ?? options[plural.select(n)] ?? options.other ?? '';
    return formatMessage(message, vars, String(n));
  }
  return formatMessage(options[String(value)] ?? options.other ?? '', vars, pound);
}

function parseOptions(text: string): Record<string, string> {
  const options: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const end = matchingBrace(text, open);
    options[text.slice(i, open).trim()] = text.slice(open + 1, end);
    i = end + 1;
  }
  return options;
}
