// The console Gallery's use cases, read from the list the console publishes
// with every build (`/gallery-examples/manifest.json`). The console is the one
// place an example is described; Cowork owns only the prompt it sends, so an
// entry is shown only when Cowork has a sample with the same mode and id.
// That also lets either repo ship first: a new example appears once both have
// it, and one Cowork has never heard of is simply left out.

import { findSample } from '../../lib/consoleHandoff';

export const GALLERY_MANIFEST_VERSION = 1;

export function galleryManifestUrl(consoleUrl) {
  return `${String(consoleUrl || '').replace(/\/+$/, '')}/gallery-examples/manifest.json`;
}

const text = (value) => (typeof value === 'string' ? value : '');

// Every file the list names must come from the console that published it, so
// a list served by the console can never point the column at another site.
function consoleAsset(path, base) {
  if (typeof path !== 'string' || !path) return null;
  try {
    const url = new URL(path, base);
    return url.origin === new URL(base).origin ? url.toString() : null;
  } catch {
    return null;
  }
}

// The published copy of a live example, opened in the person's browser.
function publishedPage(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// A nested list that is not an array reads as empty, so one malformed answer
// cannot stop the whole list from loading.
const arrayOf = (value) => (Array.isArray(value) ? value : []);

const BLOCK_TYPES = new Set(['heading', 'paragraph', 'list', 'table']);

function readAnswer(answer) {
  if (!answer || !Array.isArray(answer.blocks)) return null;
  const blocks = answer.blocks
    .filter((block) => block && BLOCK_TYPES.has(block.type))
    .map((block) => {
      if (block.type === 'list') {
        return { type: 'list', ordered: Boolean(block.ordered), items: arrayOf(block.items).map(text).filter(Boolean) };
      }
      if (block.type === 'table') {
        const columns = arrayOf(block.columns).map(text);
        const rows = arrayOf(block.rows).filter(Array.isArray).map((row) => row.map(text));
        return { type: 'table', columns, rows };
      }
      return { type: block.type, text: text(block.text) };
    });
  const draft = answer.draft && text(answer.draft.text)
    ? { label: text(answer.draft.label), text: text(answer.draft.text) }
    : null;
  if (!blocks.length && !draft) return null;
  return { blocks, draft, note: text(answer.note) };
}

function readFile(file, base) {
  const href = consoleAsset(file?.href, base);
  if (!href) return null;
  return { label: text(file.label), name: text(file.name), what: text(file.what), href };
}

// How the column starts an example (galleryRules.js); anything else is no action.
const START_ACTIONS = ['send', 'fill'];

// The console publishes `surfaces` only for an example that runs on one of
// them; omitted means both.
const runsOn = (raw, surface) => !surface || !Array.isArray(raw.surfaces) || raw.surfaces.includes(surface);

function readEntry(raw, base, surface) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.mode !== 'string' || !text(raw.title)) return null;
  if (!runsOn(raw, surface)) return null;
  const found = findSample(raw.mode, raw.id);
  if (!found) return null;
  const thumbnail = consoleAsset(raw.thumbnail, base);
  const page = raw.example ? consoleAsset(raw.example.src, base) : null;
  const example = page
    ? { src: page, viewUrl: publishedPage(raw.example.viewUrl), noun: text(raw.example.noun), background: text(raw.example.background) }
    : null;
  const answer = readAnswer(raw.answer);
  if (!thumbnail || (!example && !answer)) return null;
  const seconds = Number(raw.run?.seconds);
  return {
    id: raw.id,
    mode: found.mode,
    sample: found.sample,
    title: text(raw.title),
    description: text(raw.description),
    badge: text(raw.badge),
    category: text(raw.category),
    needs: text(raw.needs),
    start: START_ACTIONS.includes(raw.start) ? raw.start : null,
    thumbnail,
    example,
    answer,
    files: (Array.isArray(raw.files) ? raw.files : []).map((file) => readFile(file, base)).filter(Boolean),
    sampleInput: raw.sampleInput ? readFile(raw.sampleInput, base) : null,
    model: text(raw.run?.model),
    seconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
  };
}

/**
 * The published list as the column uses it, or null when there is nothing to
 * show: a version this build does not know, a malformed list, or no example
 * Cowork can start. `base` is the address the list was read from; `surface`
 * ('web' or 'desktop') leaves out examples published for the other one.
 */
export function readGalleryManifest(raw, base, { surface = null } = {}) {
  if (!raw || raw.version !== GALLERY_MANIFEST_VERSION || !Array.isArray(raw.entries)) return null;
  const seen = new Set();
  const entries = [];
  for (const item of raw.entries) {
    const entry = readEntry(item, base, surface);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  if (!entries.length) return null;
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((section) => ({
      category: text(section?.category),
      line: text(section?.line),
      ids: (Array.isArray(section?.ids) ? section.ids : []).filter((id) => seen.has(id)),
    }))
    .filter((section) => section.category && section.ids.length);
  // An entry no section names still belongs somewhere: under its own category,
  // after the published ones.
  const placed = new Set(sections.flatMap((section) => section.ids));
  for (const entry of entries) {
    if (placed.has(entry.id)) continue;
    let section = sections.find((s) => s.category === entry.category);
    if (!section) {
      section = { category: entry.category || 'More', line: '', ids: [] };
      sections.push(section);
    }
    section.ids.push(entry.id);
    placed.add(entry.id);
  }
  const startHere = (Array.isArray(raw.startHere) ? raw.startHere : []).filter((id) => seen.has(id));
  return { entries, sections, startHere };
}

/**
 * Reads the list from the console. Answers `{ manifest }`, or `{ failure }`
 * naming why there is none, so the column can say it cannot load and the
 * reason can be recorded. Never sends credentials: the list is public.
 */
export async function fetchGalleryManifest(consoleUrl, fetchImpl = globalThis.fetch, { surface = null } = {}) {
  const url = galleryManifestUrl(consoleUrl);
  let response;
  try {
    response = await fetchImpl(url, { credentials: 'omit', cache: 'no-cache' });
  } catch {
    return { failure: 'network' };
  }
  if (!response?.ok) return { failure: 'http' };
  let raw;
  try {
    raw = await response.json();
  } catch {
    return { failure: 'invalid' };
  }
  const manifest = readGalleryManifest(raw, url, { surface });
  return manifest ? { manifest } : { failure: raw?.version === GALLERY_MANIFEST_VERSION ? 'empty' : 'invalid' };
}
