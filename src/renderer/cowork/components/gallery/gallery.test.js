import { describe, expect, it, vi } from 'vitest';
import { readGalleryManifest, fetchGalleryManifest, galleryManifestUrl } from './galleryManifest';
import { filterGallery, matchesQuery, ALL_CATEGORIES } from './galleryFilter';
import { galleryOffered, opensByItself, readGallerySettled, markGallerySettled, runMinutes, firstRunPreviewRequested, takeFirstRunPreview, clearFirstRunPreview } from './galleryRules';

const CONSOLE = 'https://console.example.test';
const LIST_URL = `${CONSOLE}/gallery-examples/manifest.json`;

const entry = (over) => ({
  category: 'Sales and research',
  badge: 'Brief and email',
  description: 'A brief and a first email.',
  needs: 'Nothing',
  thumbnail: '/gallery-examples/thumbs/x.webp',
  answer: { blocks: [{ type: 'paragraph', text: 'Done.' }] },
  run: { model: 'MindsHub Air', seconds: 187 },
  ...over,
});

const RAW = {
  version: 1,
  sections: [
    { category: 'Sales and research', line: 'Learn about a company.', ids: ['research-a-prospect-and-draft-outreach'] },
    { category: 'Your documents', line: 'Bring a file.', ids: ['turn-a-bank-statement-into-a-spreadsheet'] },
    { category: 'Plans and dashboards', line: 'Plans.', ids: ['build-a-project-rollout-timeline'] },
  ],
  startHere: ['research-a-prospect-and-draft-outreach', 'build-a-project-rollout-timeline'],
  entries: [
    entry({ id: 'research-a-prospect-and-draft-outreach', mode: 'wide-research', title: 'Research a prospect and draft outreach' }),
    entry({
      id: 'turn-a-bank-statement-into-a-spreadsheet', mode: 'spreadsheet', title: 'Turn a bank statement into a spreadsheet',
      category: 'Your documents', badge: 'Workbook', description: 'One transaction per row.',
      files: [{ label: 'The workbook', name: 'statement.xlsx', what: 'Rows', href: '/gallery-examples/statement.xlsx' }],
    }),
    entry({
      id: 'build-a-project-rollout-timeline', mode: 'visualization', title: 'Plan a project rollout timeline',
      category: 'Plans and dashboards', badge: 'Live app', answer: undefined,
      example: { src: '/gallery-examples/rollout-timeline.html', viewUrl: 'https://view.example.test/view/a/b', noun: 'app' },
    }),
  ],
};

const read = (raw = RAW) => readGalleryManifest(raw, LIST_URL);

describe('readGalleryManifest', () => {
  it('keeps examples Cowork can start, tied to its own sample', () => {
    const manifest = read();
    expect(manifest.entries.map((e) => e.id)).toEqual(RAW.entries.map((e) => e.id));
    const prospect = manifest.entries[0];
    expect(prospect.mode.id).toBe('wide-research');
    expect(prospect.sample.prompt).toMatch(/Fernhill Freight/);
  });

  it('leaves out an example Cowork has no prompt for, wherever it is named', () => {
    const raw = {
      ...RAW,
      startHere: ['not-a-cowork-sample', ...RAW.startHere],
      sections: [...RAW.sections, { category: 'Games', line: '', ids: ['not-a-cowork-sample'] }],
      entries: [...RAW.entries, entry({ id: 'not-a-cowork-sample', mode: 'games', title: 'Unknown' })],
    };
    const manifest = read(raw);
    expect(manifest.entries.some((e) => e.id === 'not-a-cowork-sample')).toBe(false);
    expect(manifest.startHere).not.toContain('not-a-cowork-sample');
    expect(manifest.sections.map((s) => s.category)).not.toContain('Games');
  });

  it('resolves files against the console and refuses any on another site', () => {
    const raw = {
      ...RAW,
      entries: RAW.entries.map((e, i) => (i === 1
        ? { ...e, files: [...e.files, { label: 'x', name: 'x', href: 'https://elsewhere.test/x.xlsx' }] }
        : e)),
    };
    const statement = read(raw).entries[1];
    expect(statement.thumbnail).toBe(`${CONSOLE}/gallery-examples/thumbs/x.webp`);
    expect(statement.files.map((f) => f.href)).toEqual([`${CONSOLE}/gallery-examples/statement.xlsx`]);
  });

  it('drops an example whose picture is not on the console', () => {
    const raw = { ...RAW, entries: [{ ...RAW.entries[0], thumbnail: 'https://elsewhere.test/x.webp' }, ...RAW.entries.slice(1)] };
    expect(read(raw).entries.map((e) => e.id)).not.toContain('research-a-prospect-and-draft-outreach');
  });

  it('opens a live example only over https', () => {
    const timeline = read().entries[2];
    expect(timeline.example.src).toBe(`${CONSOLE}/gallery-examples/rollout-timeline.html`);
    expect(timeline.example.viewUrl).toBe('https://view.example.test/view/a/b');
    const raw = { ...RAW, entries: RAW.entries.map((e, i) => (i === 2 ? { ...e, example: { ...e.example, viewUrl: 'javascript:alert(1)' } } : e)) };
    expect(read(raw).entries[2].example.viewUrl).toBeNull();
  });

  it('leaves out an example published only for the other surface, and keeps it where it runs', () => {
    const raw = { ...RAW, entries: RAW.entries.map((e, i) => (i === 0 ? { ...e, surfaces: ['desktop'] } : e)) };
    const first = RAW.entries[0].id;
    expect(readGalleryManifest(raw, LIST_URL, { surface: 'web' })?.entries.map((e) => e.id) ?? []).not.toContain(first);
    expect(readGalleryManifest(raw, LIST_URL, { surface: 'desktop' }).entries.map((e) => e.id)).toContain(first);
    expect(readGalleryManifest(RAW, LIST_URL, { surface: 'web' }).entries.map((e) => e.id)).toContain(first);
  });

  it('files an example no section names under its own category', () => {
    const raw = { ...RAW, sections: RAW.sections.slice(0, 1) };
    const manifest = read(raw);
    expect(manifest.sections.map((s) => s.category)).toEqual(['Sales and research', 'Your documents', 'Plans and dashboards']);
  });

  it.each([
    ['a newer version', { ...RAW, version: 2 }],
    ['no entries', { ...RAW, entries: undefined }],
    ['nothing Cowork can start', { ...RAW, entries: [entry({ id: 'nope', mode: 'games', title: 'Nope' })] }],
    ['not a list at all', null],
  ])('shows nothing for %s', (_name, raw) => {
    expect(read(raw)).toBeNull();
  });
});

describe('fetchGalleryManifest', () => {
  const respond = (body, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

  it('reads the list from the console without credentials', async () => {
    const fetchImpl = respond(RAW);
    const result = await fetchGalleryManifest(`${CONSOLE}/`, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(LIST_URL, { credentials: 'omit', cache: 'no-cache' });
    expect(result.manifest.entries).toHaveLength(3);
  });

  it.each([
    ['network', async () => { throw new Error('offline'); }],
    ['http', respond(RAW, false)],
    ['invalid', vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } }))],
    ['invalid', respond({ version: 9 })],
    ['empty', respond({ ...RAW, entries: [] })],
  ])('names the failure: %s', async (failure, fetchImpl) => {
    expect(await fetchGalleryManifest(CONSOLE, fetchImpl)).toEqual({ failure });
  });

  it('builds the address from the console url', () => {
    expect(galleryManifestUrl('https://c.test///')).toBe('https://c.test/gallery-examples/manifest.json');
  });
});

describe('filterGallery', () => {
  const manifest = read();

  it('lists everything in section order with Start here on the untouched All tab', () => {
    const result = filterGallery(manifest);
    expect(result.list.map((e) => e.id)).toEqual([
      'research-a-prospect-and-draft-outreach', 'turn-a-bank-statement-into-a-spreadsheet', 'build-a-project-rollout-timeline',
    ]);
    expect(result.startHere.map((e) => e.id)).toEqual(manifest.startHere);
    expect(result.counts).toEqual({ [ALL_CATEGORIES]: 3, 'Sales and research': 1, 'Your documents': 1, 'Plans and dashboards': 1 });
  });

  it('finds examples by the words people use for what a mode makes', () => {
    const result = filterGallery(manifest, { query: 'Excel' });
    expect(result.list.map((e) => e.id)).toEqual(['turn-a-bank-statement-into-a-spreadsheet']);
    expect(result.searching).toBe(true);
    expect(result.startHere).toEqual([]);
    expect(result.counts['Sales and research']).toBe(0);
  });

  it('needs every word, each at the start of a word', () => {
    expect(matchesQuery(manifest.entries[0], 'prospect email')).toBe(true);
    expect(matchesQuery(manifest.entries[0], 'prospect spreadsheet')).toBe(false);
    expect(matchesQuery(manifest.entries[0], 'rospect')).toBe(false);
  });

  it('ignores case, accents and punctuation', () => {
    expect(matchesQuery(manifest.entries[2], '  TÍMELINE!! ')).toBe(true);
  });

  it('narrows to one tab, and searches within it', () => {
    expect(filterGallery(manifest, { category: 'Your documents' }).list.map((e) => e.id))
      .toEqual(['turn-a-bank-statement-into-a-spreadsheet']);
    expect(filterGallery(manifest, { category: 'Your documents', query: 'timeline' }).list).toEqual([]);
  });
});

describe('galleryOffered', () => {
  it.each([
    [{ isWeb: false, platformUi: true, isMobileShell: false }, true],
    [{ isWeb: true, platformUi: true, isMobileShell: false }, true],
    [{ isWeb: true, platformUi: false, isMobileShell: false }, false],
    [{ isWeb: true, platformUi: true, isMobileShell: true }, false],
  ])('%o → %s', (surface, expected) => {
    expect(galleryOffered(surface)).toBe(expected);
  });
});

describe('opensByItself', () => {
  const base = { offered: true, hasManifest: true, tasksStatus: 'ready', taskCount: 0, settled: false };

  it('opens for an account with no tasks yet', () => {
    expect(opensByItself(base)).toBe(true);
  });

  it.each([
    ['not offered here', { offered: false }],
    ['no examples to show', { hasManifest: false }],
    ['tasks still loading', { tasksStatus: 'loading' }],
    ['the task list failed', { tasksStatus: 'failed' }],
    ['the account has tasks', { taskCount: 2 }],
    ['already folded or used', { settled: true }],
  ])('stays shut when %s', (_name, over) => {
    expect(opensByItself({ ...base, ...over })).toBe(false);
  });
});

describe('gallery settled flag', () => {
  it('is remembered', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    expect(readGallerySettled(storage)).toBe(false);
    markGallerySettled(storage);
    expect(readGallerySettled(storage)).toBe(true);
  });

  it('reads as not settled when storage throws, and never throws itself', () => {
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readGallerySettled(storage)).toBe(false);
    expect(() => markGallerySettled(storage)).not.toThrow();
  });
});

describe('runMinutes', () => {
  it('rounds to whole minutes, never below one', () => {
    expect(runMinutes(20)).toBe(1);
    expect(runMinutes(187)).toBe(3);
    expect(runMinutes(null)).toBeNull();
  });
});

describe('firstRunPreviewRequested', () => {
  it.each([
    ['?gallery=first-run', 'https://api-pr-cowork-1568.dev.mindshub.ai', true],
    ['?x=1&gallery=first-run', 'https://api.staging.mindshub.ai', true],
    ['?gallery=first-run', 'https://api.mindshub.ai', false],
    ['?gallery=first-run', 'https://api.mindshub.ai/', false],
    ['?gallery=other', 'https://api.staging.mindshub.ai', false],
    ['', 'https://api.staging.mindshub.ai', false],
  ])('%s on %s → %s', (search, apiBase, expected) => {
    expect(firstRunPreviewRequested({ search, apiBase })).toBe(expected);
  });
});

describe('takeFirstRunPreview', () => {
  const memory = () => {
    const store = new Map();
    return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  };
  const STAGING = 'https://api.staging.mindshub.ai';

  it('remembers the request across the sign-in redirect, which drops the query, until it is shown', () => {
    const storage = memory();
    expect(takeFirstRunPreview({ search: '?gallery=first-run', apiBase: STAGING, storage })).toBe(true);
    expect(takeFirstRunPreview({ search: '', apiBase: STAGING, storage })).toBe(true);
    clearFirstRunPreview(storage);
    expect(takeFirstRunPreview({ search: '', apiBase: STAGING, storage })).toBe(false);
  });

  it('never honours it against production, even if a request was kept', () => {
    const storage = memory();
    storage.setItem('anton.gallery.firstRunPreview', '1');
    expect(takeFirstRunPreview({ search: '?gallery=first-run', apiBase: 'https://api.mindshub.ai', storage })).toBe(false);
  });

  it('falls back to the address when storage throws', () => {
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(takeFirstRunPreview({ search: '?gallery=first-run', apiBase: STAGING, storage })).toBe(true);
    expect(takeFirstRunPreview({ search: '', apiBase: STAGING, storage })).toBe(false);
  });
});
