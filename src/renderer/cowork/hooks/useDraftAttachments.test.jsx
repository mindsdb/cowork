// ENG-4622: drafted attachments (pasted images included) survive switching
// threads and reloading, per draft key, like the draft text does.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const STORAGE_KEY = 'anton.composerDrafts.attachments';

// Stands in for IndexedDB; shared across "reloads" like the real database.
function memoryBackend() {
  const files = new Map();
  return {
    files,
    get: async (key) => files.get(key),
    put: async (key, blob) => { files.set(key, blob); },
    delete: async (key) => { files.delete(key); },
    keys: async () => [...files.keys()],
  };
}

// A reload: fresh modules, with only localStorage and the backend left.
async function load(backend) {
  vi.resetModules();
  const store = await import('../lib/draftAttachments');
  store.__resetDraftAttachmentsForTests(backend);
  const hook = await import('./useDraftAttachments');
  const draftStore = await import('../lib/draftStore');
  return { ...store, ...hook, draftStore };
}

const image = (name = 'clipboard_1.png', bytes = [1, 2, 3]) => ({
  id: `local-${name}`,
  source: 'file',
  pendingFile: new File([new Uint8Array(bytes)], name, { type: 'image/png' }),
  name,
  mime: 'image/png',
  size: bytes.length,
});

const notionPage = { id: 'notion-1', source: 'notion', name: 'Roadmap', pageId: 'abc' };

const mount = (useDraftAttachments, key) => renderHook(
  ({ k }) => useDraftAttachments(k),
  { initialProps: { k: key } },
);

describe('useDraftAttachments', () => {
  let backend;

  beforeEach(() => {
    localStorage.clear();
    backend = memoryBackend();
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
  });

  it('keeps each thread its own attachments when the key switches', async () => {
    const { useDraftAttachments } = await load(backend);
    const composer = mount(useDraftAttachments, 'task-a');
    act(() => composer.result.current[1]([image()]));

    composer.rerender({ k: 'task-b' });
    expect(composer.result.current[0]).toEqual([]);

    composer.rerender({ k: 'task-a' });
    expect(composer.result.current[0].map((a) => a.name)).toEqual(['clipboard_1.png']);
  });

  it('counts a pasted image as work started, so the organization landing waits', async () => {
    const { useDraftAttachments } = await load(backend);
    const work = await import('../lib/documentWork');
    work.__resetWorkStartedForTests();
    const composer = mount(useDraftAttachments, 'new');
    expect(work.hasWorkStarted()).toBe(false);
    act(() => composer.result.current[1]([image()]));
    expect(work.hasWorkStarted()).toBe(true);
  });

  it('binds the setter to the key it was created with', async () => {
    const { useDraftAttachments, getDraftAttachments } = await load(backend);
    const composer = mount(useDraftAttachments, 'task-a');
    act(() => composer.result.current[1]([image()]));
    const clearA = composer.result.current[1];

    // A send from A that finishes after the user moved to B clears A only.
    composer.rerender({ k: 'task-b' });
    act(() => composer.result.current[1]([image('b.png')]));
    act(() => clearA([]));

    expect(getDraftAttachments('task-a')).toEqual([]);
    expect(getDraftAttachments('task-b').map((a) => a.name)).toEqual(['b.png']);
  });

  it('restores pasted images and references after a reload', async () => {
    const first = await load(backend);
    first.setDraftAttachments('task-a', [image(), notionPage]);
    await first.__flushDraftAttachmentsForTests();

    const reloaded = await load(backend);
    const composer = mount(reloaded.useDraftAttachments, 'task-a');
    // References are back at once; file bytes arrive from IndexedDB.
    expect(composer.result.current[0].map((a) => a.id)).toEqual(['notion-1']);
    await waitFor(() => expect(composer.result.current[0].map((a) => a.id)).toEqual(['local-clipboard_1.png', 'notion-1']));

    const [restored] = composer.result.current[0];
    expect(restored.pendingFile).toBeInstanceOf(File);
    expect(restored.pendingFile.name).toBe('clipboard_1.png');
    expect(new Uint8Array(await restored.pendingFile.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('deletes stored bytes once the draft is sent or the chip removed', async () => {
    const store = await load(backend);
    store.setDraftAttachments('task-a', [image('a.png'), image('b.png')]);
    await store.__flushDraftAttachmentsForTests();
    expect(backend.files.size).toBe(2);

    store.setDraftAttachments('task-a', [image('b.png')]);
    await store.__flushDraftAttachmentsForTests();
    expect([...backend.files.keys()]).toEqual([`${STORAGE_KEY}\nlocal-b.png`]);

    store.clearDraftAttachments('task-a');
    await store.__flushDraftAttachmentsForTests();
    expect(backend.files.size).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('carries attachments over when a tmp- task gets its server id', async () => {
    const { draftStore, getDraftAttachments, setDraftAttachments } = await load(backend);
    setDraftAttachments('tmp-1', [image()]);
    draftStore.moveDraft('tmp-1', 'conv-1');
    expect(getDraftAttachments('tmp-1')).toEqual([]);
    expect(getDraftAttachments('conv-1').map((a) => a.name)).toEqual(['clipboard_1.png']);
  });

  it('forgets every draft on an organization switch', async () => {
    const store = await load(backend);
    store.setDraftAttachments('new', [image()]);
    await store.__flushDraftAttachmentsForTests();

    store.draftStore.clearDraftsForOrganizationSwitch();
    await waitFor(() => expect(backend.files.size).toBe(0));
    expect(store.getDraftAttachments('new')).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('deletes bytes whose index an account purge removed', async () => {
    const first = await load(backend);
    first.setDraftAttachments('new', [image()]);
    await first.__flushDraftAttachmentsForTests();
    backend.files.set('anton.composerDrafts.attachments:other-account\nlocal-x', new Blob(['x']));

    // accountLocalState drops every `anton.composerDrafts*` key.
    localStorage.clear();
    const reloaded = await load(backend);
    await reloaded.__flushDraftAttachmentsForTests();
    await waitFor(() => expect(backend.files.size).toBe(0));
    expect(reloaded.getDraftAttachments('new')).toEqual([]);
  });

  it('keeps an oversized file in memory without storing its bytes', async () => {
    const store = await load(backend);
    const big = image('big.png');
    Object.defineProperty(big.pendingFile, 'size', { value: 60 * 1024 * 1024 });
    store.setDraftAttachments('new', [big, notionPage]);
    await store.__flushDraftAttachmentsForTests();

    expect(backend.files.size).toBe(0);
    expect(store.getDraftAttachments('new')).toHaveLength(2);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(saved.drafts).toEqual([['new', [notionPage]]]);
  });

  it('keeps files still loading when the page closes mid-restore', async () => {
    const first = await load(backend);
    first.setDraftAttachments('new', [image()]);
    await first.__flushDraftAttachmentsForTests();

    // Another draft is saved before the first one's bytes are back.
    const second = await load(backend);
    second.setDraftAttachments('task-b', [notionPage]);
    window.dispatchEvent(new Event('pagehide'));

    const third = await load(backend);
    await third.__flushDraftAttachmentsForTests();
    expect(third.getDraftAttachments('new').map((a) => a.name)).toEqual(['clipboard_1.png']);
    expect(third.getDraftAttachments('task-b')).toEqual([notionPage]);
  });

  it('keeps another tab\'s saved files when this tab saves and reloads', async () => {
    const tab1 = await load(backend);
    tab1.setDraftAttachments('task-a', [image('x.png')]);
    await tab1.__flushDraftAttachmentsForTests();

    // A second tab saves a different draft, then reloads.
    const tab2 = await load(backend);
    tab2.setDraftAttachments('task-b', [notionPage]);
    await tab2.__flushDraftAttachmentsForTests();
    const tab2Reloaded = await load(backend);
    await tab2Reloaded.__flushDraftAttachmentsForTests();

    const tab1Reloaded = await load(backend);
    await tab1Reloaded.__flushDraftAttachmentsForTests();
    expect(tab1Reloaded.getDraftAttachments('task-a').map((a) => a.name)).toEqual(['x.png']);
    expect(tab1Reloaded.getDraftAttachments('task-b')).toEqual([notionPage]);
  });

  it('does not let a tab overwrite a draft another tab changed since', async () => {
    const tab1 = await load(backend);
    tab1.setDraftAttachments('new', [image('sent.png')]);
    await tab1.__flushDraftAttachmentsForTests();
    tab1.clearDraftAttachments('new');
    await tab1.__flushDraftAttachmentsForTests();

    // Tab 2 drafts on Home; tab 1 then saves an unrelated draft.
    const tab2 = await load(backend);
    tab2.setDraftAttachments('new', [image('tab2.png')]);
    await tab2.__flushDraftAttachmentsForTests();
    tab1.setDraftAttachments('task-a', [notionPage]);
    await tab1.__flushDraftAttachmentsForTests();

    const reloaded = await load(backend);
    await reloaded.__flushDraftAttachmentsForTests();
    expect(reloaded.getDraftAttachments('new').map((a) => a.name)).toEqual(['tab2.png']);
    expect(reloaded.getDraftAttachments('task-a')).toEqual([notionPage]);
  });

  it('forgets what it read once an account purge removes the index', async () => {
    const first = await load(backend);
    first.setDraftAttachments('new', [image(), notionPage]);
    await first.__flushDraftAttachmentsForTests();

    const reloaded = await load(backend);
    expect(reloaded.getDraftAttachments('new')).toEqual([notionPage]);
    localStorage.clear();
    reloaded.reloadDraftAttachmentsAfterPurge();
    await reloaded.__flushDraftAttachmentsForTests();

    expect(reloaded.getDraftAttachments('new')).toEqual([]);
    await waitFor(() => expect(backend.files.size).toBe(0));
  });

  it('adds late-restored files to a draft changed meanwhile', async () => {
    const first = await load(backend);
    first.setDraftAttachments('new', [image('old.png')]);
    await first.__flushDraftAttachmentsForTests();

    // A file added before the saved one is back keeps both.
    const reloaded = await load(backend);
    reloaded.setDraftAttachments('new', [image('fresh.png')]);
    await reloaded.__flushDraftAttachmentsForTests();

    expect(reloaded.getDraftAttachments('new').map((a) => a.name)).toEqual(['fresh.png', 'old.png']);
    expect(backend.files.size).toBe(2);
  });

  it('does not bring drafts back when an organization switch lands mid-restore', async () => {
    const first = await load(backend);
    first.setDraftAttachments('new', [image()]);
    await first.__flushDraftAttachmentsForTests();

    const reloaded = await load(backend);
    reloaded.getDraftAttachments('new');
    reloaded.draftStore.clearDraftsForOrganizationSwitch();
    await reloaded.__flushDraftAttachmentsForTests();

    expect(reloaded.getDraftAttachments('new')).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(backend.files.size).toBe(0));
  });

  it('drops files still loading when their thread is deleted', async () => {
    const first = await load(backend);
    first.setDraftAttachments('task-a', [image()]);
    await first.__flushDraftAttachmentsForTests();

    const reloaded = await load(backend);
    reloaded.clearDraftAttachments('task-a');
    await reloaded.__flushDraftAttachmentsForTests();

    expect(reloaded.getDraftAttachments('task-a')).toEqual([]);
    await waitFor(() => expect(backend.files.size).toBe(0));
  });
});
