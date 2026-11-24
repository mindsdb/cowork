import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useHomeGallery } from './useHomeGallery';
import { readGallerySettled } from './galleryRules';

const { trackGalleryShown, trackGalleryClosed, trackGalleryExampleStarted, trackGalleryUnavailable } = vi.hoisted(() => ({
  trackGalleryShown: vi.fn(),
  trackGalleryClosed: vi.fn(),
  trackGalleryExampleStarted: vi.fn(),
  trackGalleryUnavailable: vi.fn(),
}));
vi.mock('../../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackGalleryShown, trackGalleryClosed, trackGalleryExampleStarted, trackGalleryUnavailable,
}));

const LIST = {
  version: 1,
  sections: [{ category: 'Games', line: '', ids: ['celestial-merge-2048'] }],
  startHere: [],
  entries: [{
    id: 'celestial-merge-2048', mode: 'games', title: 'Make a merge puzzle game', category: 'Games',
    thumbnail: '/gallery-examples/thumbs/c.webp', example: { src: '/gallery-examples/c.html' },
  }],
};

const respond = (body, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

const mount = (props) => renderHook((p) => useHomeGallery({
  onHome: true, tasks: [], tasksStatus: 'ready', consoleUrl: 'https://console.example.test', offered: true, ...p,
}), { initialProps: props });

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', respond(LIST));
  for (const fn of [trackGalleryShown, trackGalleryClosed, trackGalleryExampleStarted, trackGalleryUnavailable]) fn.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('useHomeGallery', () => {
  it('opens by itself for an account with no tasks, once the list has loaded', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.manifest.entries).toHaveLength(1);
    expect(result.current.focusSearch).toBe(false);
    expect(trackGalleryShown).toHaveBeenCalledWith('auto');
    expect(result.current.welcome).toBe(true);
  });

  it('waits for the task list before deciding, and stays shut for an account with tasks', async () => {
    const { result, rerender } = mount({ tasksStatus: 'loading' });
    await waitFor(() => expect(result.current.manifest).not.toBeNull());
    expect(result.current.open).toBe(false);
    rerender({ tasksStatus: 'ready', tasks: [{ id: 't1' }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.open).toBe(false);
    expect(trackGalleryShown).not.toHaveBeenCalled();
  });

  it('never opens by itself again once folded, in this browser', async () => {
    const first = mount();
    await waitFor(() => expect(first.result.current.open).toBe(true));
    act(() => first.result.current.hide('button'));
    expect(first.result.current.open).toBe(false);
    expect(trackGalleryClosed).toHaveBeenCalledWith('button');
    expect(readGallerySettled()).toBe(true);
    first.unmount();

    const second = mount();
    await waitFor(() => expect(second.result.current.manifest).not.toBeNull());
    expect(second.result.current.open).toBe(false);
  });

  it('starting an example hands it over, folds the column and records both', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.open).toBe(true));
    const entry = result.current.manifest.entries[0];
    act(() => result.current.start(entry));
    expect(result.current.pick.entry).toBe(entry);
    expect(result.current.open).toBe(false);
    expect(trackGalleryExampleStarted).toHaveBeenCalledWith('celestial-merge-2048');
    expect(trackGalleryClosed).toHaveBeenCalledWith('started');
  });

  it('opens from the button with the search focused', async () => {
    window.localStorage.setItem('anton.gallery.settled', '1');
    const { result } = mount();
    await waitFor(() => expect(result.current.manifest).not.toBeNull());
    act(() => result.current.show('button'));
    expect(result.current.open).toBe(true);
    expect(result.current.focusSearch).toBe(true);
    expect(trackGalleryShown).toHaveBeenCalledWith('button');
    expect(result.current.welcome).toBe(false);
  });

  it('records a list that cannot load, does not open by itself, and tries again when opened', async () => {
    vi.stubGlobal('fetch', respond(LIST, false));
    const { result } = mount();
    await waitFor(() => expect(result.current.failure).toBe('http'));
    expect(trackGalleryUnavailable).toHaveBeenCalledWith('http');
    expect(result.current.open).toBe(false);

    vi.stubGlobal('fetch', respond(LIST));
    act(() => result.current.show('checklist'));
    await waitFor(() => expect(result.current.manifest).not.toBeNull());
    expect(result.current.failure).toBeNull();
  });

  it('is available only once the list has loaded, so the checklist keeps its examples list otherwise', async () => {
    vi.stubGlobal('fetch', respond(LIST, false));
    const failing = mount();
    expect(failing.result.current.available).toBe(false);
    await waitFor(() => expect(failing.result.current.failure).toBe('http'));
    expect(failing.result.current.available).toBe(false);
    failing.unmount();

    vi.stubGlobal('fetch', respond(LIST));
    const loading = mount({ tasks: [{ id: 't1' }] });
    await waitFor(() => expect(loading.result.current.available).toBe(true));
  });

  it('records a failed read only when someone was waiting on the list', async () => {
    vi.stubGlobal('fetch', respond(LIST, false));
    const { result } = mount({ tasks: [{ id: 't1' }] });
    await waitFor(() => expect(result.current.failure).toBe('http'));
    await new Promise((r) => setTimeout(r, 20));
    expect(trackGalleryUnavailable).not.toHaveBeenCalled();

    // Opening it reads again; that read, which someone waited on, is recorded.
    act(() => result.current.show('button'));
    await waitFor(() => expect(trackGalleryUnavailable).toHaveBeenCalledTimes(1));
    expect(trackGalleryUnavailable).toHaveBeenCalledWith('http');
  });

  it('does nothing where the gallery is not offered', async () => {
    const fetchSpy = respond(LIST);
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = mount({ offered: false });
    act(() => result.current.show('button'));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it('reads the list only once Home is shown', async () => {
    const fetchSpy = respond(LIST);
    vi.stubGlobal('fetch', fetchSpy);
    const { rerender } = mount({ onHome: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    rerender({ onHome: true });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });
});
