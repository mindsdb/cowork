// The artifacts open on screen, for the voice call's operator (operator.js
// describeScreen), so "what's in that document?" can be answered. An open
// artifact viewer registers a reader while it shows one; the operator reads
// each artifact's title, type and the start of its visible text when it
// describes the screen. The text is the artifact's, written by anyone, so the
// server keeps it as data like the rest of the snapshot.

export const MAX_ARTIFACT_EXCERPT_CHARS = 2000;
// Lines short enough that the server's per-line cap never cuts the excerpt.
const EXCERPT_LINE_CHARS = 200;
const MAX_ARTIFACTS = 2;

const readers = new Map();
let nextKey = 0;

/**
 * Registers `read`, which returns `{ title, type, text }` for an artifact on
 * screen now (or null), until the returned function is called.
 *
 * @param {() => ({ title?: string, type?: string, text?: string } | null)} read
 * @returns {() => void}
 */
export function showArtifactOnScreen(read) {
  nextKey += 1;
  const key = nextKey;
  readers.set(key, read);
  return () => { readers.delete(key); };
}

/** The artifacts on screen now, the latest opened first. */
export function artifactsOnScreen() {
  const out = [];
  [...readers.values()].reverse().forEach((read) => {
    let artifact = null;
    try { artifact = read(); } catch { artifact = null; }
    if (artifact) out.push(artifact);
  });
  return out.slice(0, MAX_ARTIFACTS);
}

/** The start of `text` as one run of words, at most `max` characters. */
export function artifactExcerpt(text, max = MAX_ARTIFACT_EXCERPT_CHARS) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The visible text of an HTML document, without its scripts and styles. */
export function htmlText(html) {
  if (!html || typeof DOMParser !== 'function') return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
  // A space after each element, so a heading and the paragraph after it stay two words.
  doc.body?.querySelectorAll('*').forEach((el) => el.append(' '));
  return doc.body?.textContent || '';
}

/** The snapshot's lines for the artifacts on screen: a heading and the excerpt, in short lines. */
export function describeArtifacts(artifacts) {
  const lines = [];
  (artifacts || []).forEach((a) => {
    const excerpt = artifactExcerpt(a.text);
    const type = a.type ? ` (${a.type})` : '';
    lines.push(`Open artifact: "${a.title || 'Untitled'}"${type}. ${excerpt ? 'The start of its visible text:' : 'No text of it can be read.'}`);
    for (let i = 0; i < excerpt.length; i += EXCERPT_LINE_CHARS) lines.push(`| ${excerpt.slice(i, i + EXCERPT_LINE_CHARS)}`);
  });
  return lines;
}
