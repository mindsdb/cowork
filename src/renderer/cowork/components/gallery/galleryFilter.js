// Search and category tabs over the gallery's examples. Pure, so what a query
// finds is tested without the column.

export const ALL_CATEGORIES = 'all';

// Plain words people use for what a mode makes, so "excel" or "deck" finds the
// examples even when no title says it.
const MODE_WORDS = {
  slides: 'slides presentation deck powerpoint pptx',
  website: 'website page landing site web',
  apps: 'app tool tracker generator',
  spreadsheet: 'spreadsheet excel xlsx csv sheet table workbook',
  visualization: 'chart dashboard visualization diagram graph',
  'wide-research': 'research report brief email',
  games: 'game play',
};

const fold = (value) => String(value || '')
  .toLocaleLowerCase()
  .normalize('NFKD')
  .replace(/\p{M}/gu, '');

const words = (query) => fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function searchableText(entry) {
  return fold([
    entry.title, entry.description, entry.badge, entry.category, entry.needs,
    MODE_WORDS[entry.mode?.id] || '',
  ].join(' '));
}

/** Whether every word of the query appears in the example, as a word start. */
export function matchesQuery(entry, query) {
  const wanted = words(query);
  if (!wanted.length) return true;
  const haystack = ` ${searchableText(entry).replace(/[^\p{L}\p{N}]+/gu, ' ')}`;
  return wanted.every((word) => haystack.includes(` ${word}`));
}

/** The examples in the order the console lists them: by section, then any left over. */
export function orderedEntries(manifest) {
  const byId = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  const ordered = manifest.sections.flatMap((section) => section.ids.map((id) => byId.get(id)).filter(Boolean));
  const listed = new Set(ordered.map((entry) => entry.id));
  return [...ordered, ...manifest.entries.filter((entry) => !listed.has(entry.id))];
}

/**
 * What the column lists for a query and a tab: the matching examples, how many
 * match in each category (so a tab can say it has none), and whether to show
 * Start here (only on the untouched All tab).
 */
export function filterGallery(manifest, { query = '', category = ALL_CATEGORIES } = {}) {
  const matching = orderedEntries(manifest).filter((entry) => matchesQuery(entry, query));
  const counts = { [ALL_CATEGORIES]: matching.length };
  for (const section of manifest.sections) counts[section.category] = 0;
  for (const entry of matching) counts[entry.category] = (counts[entry.category] || 0) + 1;
  const list = category === ALL_CATEGORIES ? matching : matching.filter((entry) => entry.category === category);
  const searching = words(query).length > 0;
  const startHere = !searching && category === ALL_CATEGORIES
    ? manifest.startHere.map((id) => manifest.entries.find((entry) => entry.id === id)).filter(Boolean)
    : [];
  return { list, counts, startHere, searching };
}
