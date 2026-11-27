// Folding the column unmounts it (the app draws it only while open), so
// reopening must come back to the same search, tab and opened example.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GalleryColumn from './GalleryColumn';
import { useHomeGallery } from './useHomeGallery';

vi.mock('../../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackGalleryShown: vi.fn(), trackGalleryClosed: vi.fn(), trackGalleryExampleOpened: vi.fn(),
  trackGallerySearched: vi.fn(), trackGalleryUnavailable: vi.fn(), trackGalleryExampleStarted: vi.fn(),
}));

const entry = (id, mode, title, category) => ({
  id, mode, title, category, thumbnail: '/gallery-examples/thumbs/x.webp', needs: 'Nothing',
  answer: { blocks: [{ type: 'paragraph', text: 'Done.' }] },
});
const LIST = {
  version: 1,
  sections: [
    { category: 'Games', line: '', ids: ['celestial-merge-2048', 'classic-snake-game'] },
    { category: 'Plans and dashboards', line: '', ids: ['build-a-project-rollout-timeline'] },
  ],
  startHere: [],
  entries: [
    entry('celestial-merge-2048', 'games', 'Make a merge puzzle game', 'Games'),
    entry('classic-snake-game', 'games', 'Make a snake game with a twist', 'Games'),
    entry('build-a-project-rollout-timeline', 'visualization', 'Plan a project rollout timeline', 'Plans and dashboards'),
  ],
};

// The app's shape: the column exists only while the gallery is open.
function Home() {
  const gallery = useHomeGallery({
    onHome: true, tasks: [], tasksStatus: 'ready', consoleUrl: 'https://console.example.test', offered: true, preview: false,
  });
  return (
    <>
      <button type="button" onClick={() => gallery.show('button')}>Reopen</button>
      {gallery.open && (
        <GalleryColumn
          manifest={gallery.manifest}
          onHide={gallery.hide}
          onStart={gallery.start}
          place={gallery.place}
          onPlaceChange={gallery.setPlace}
        />
      )}
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => LIST })));
});
afterEach(() => vi.unstubAllGlobals());

describe('folding and reopening the gallery', () => {
  it('returns to the same tab, search and opened example', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await waitFor(() => expect(screen.getByRole('searchbox')).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: /^Games/ }));
    await user.type(screen.getByRole('searchbox'), 'snake');
    await user.click(screen.getAllByRole('button').find((b) => /snake game/.test(b.textContent)));
    expect(screen.getByRole('heading', { name: 'Make a snake game with a twist' })).toBeInTheDocument();

    // The example view's close (the list's sits hidden beneath it).
    await user.click(screen.getAllByRole('button', { name: 'Hide the gallery' })[0]);
    expect(screen.queryByRole('heading', { name: 'Make a snake game with a twist' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    expect(screen.getByRole('heading', { name: 'Make a snake game with a twist' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Results for “snake”/ }));
    expect(screen.getByRole('searchbox')).toHaveValue('snake');
    expect(screen.getByRole('tab', { name: /^Games/ })).toHaveAttribute('aria-selected', 'true');
  });
});
