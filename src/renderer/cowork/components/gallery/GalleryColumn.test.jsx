import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GalleryColumn from './GalleryColumn';
import { readGalleryManifest } from './galleryManifest';

const { trackGalleryExampleOpened, trackGallerySearched } = vi.hoisted(() => ({
  trackGalleryExampleOpened: vi.fn(),
  trackGallerySearched: vi.fn(),
}));
vi.mock('../../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackGalleryExampleOpened,
  trackGallerySearched,
}));

const CONSOLE = 'https://console.example.test';
const entry = (over) => ({
  category: 'Sales and research', badge: 'Brief and email', description: 'A brief and a first email.', needs: 'Nothing',
  thumbnail: '/gallery-examples/thumbs/x.webp', answer: { blocks: [{ type: 'paragraph', text: 'The brief is done.' }] },
  run: { model: 'MindsHub Air', seconds: 187 }, ...over,
});
const manifest = readGalleryManifest({
  version: 1,
  sections: [
    { category: 'Sales and research', line: '', ids: ['research-a-prospect-and-draft-outreach'] },
    { category: 'Your documents', line: '', ids: ['turn-a-bank-statement-into-a-spreadsheet'] },
    { category: 'Plans and dashboards', line: '', ids: ['build-a-project-rollout-timeline'] },
  ],
  startHere: ['build-a-project-rollout-timeline'],
  entries: [
    entry({ id: 'research-a-prospect-and-draft-outreach', mode: 'wide-research', title: 'Research a prospect and draft outreach' }),
    entry({
      id: 'turn-a-bank-statement-into-a-spreadsheet', mode: 'spreadsheet', title: 'Turn a bank statement into a spreadsheet',
      category: 'Your documents', badge: 'Workbook', needs: 'Nothing, or your statement',
      files: [{ label: 'The workbook', name: 's.xlsx', what: 'One row per transaction', href: '/gallery-examples/s.xlsx' }],
    }),
    entry({
      id: 'build-a-project-rollout-timeline', mode: 'visualization', title: 'Plan a project rollout timeline',
      category: 'Plans and dashboards', badge: 'Live app', answer: undefined,
      example: { src: '/gallery-examples/rollout.html', viewUrl: 'https://view.example.test/v/1', noun: 'app' },
    }),
  ],
}, `${CONSOLE}/gallery-examples/manifest.json`);

const setup = (props = {}) => {
  const handlers = { onHide: vi.fn(), onStart: vi.fn(), onOwnWork: vi.fn(), openExternal: vi.fn(), onRetry: vi.fn() };
  render(<GalleryColumn manifest={manifest} {...handlers} {...props} />);
  return { ...handlers, user: userEvent.setup() };
};

const rows = () => screen.getAllByRole('button').filter((b) => /Research a prospect|bank statement|rollout timeline/.test(b.textContent));

beforeEach(() => {
  trackGalleryExampleOpened.mockClear();
  trackGallerySearched.mockClear();
});

describe('GalleryColumn list', () => {
  it('shows Start here, then every example, with tabs that count them', () => {
    setup();
    expect(screen.getByText('Start here')).toBeInTheDocument();
    expect(rows().map((b) => b.textContent)).toEqual([
      expect.stringContaining('Plan a project rollout timeline'),
      expect.stringContaining('Research a prospect'),
      expect.stringContaining('bank statement'),
      expect.stringContaining('Plan a project rollout timeline'),
    ]);
    expect(screen.getByRole('tab', { name: 'All 3' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Your documents 1' })).toBeInTheDocument();
  });

  it('searches as the person types, says how many match, and records the search once it settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search examples' }), 'excel');
    expect(screen.getByText('1 example matches')).toBeInTheDocument();
    expect(screen.queryByText('Start here')).not.toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Sales and research 0' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(trackGallerySearched).toHaveBeenCalledTimes(1);
    expect(trackGallerySearched).toHaveBeenCalledWith(5, 1);
    vi.useRealTimers();
  });

  it('greets the person on the first run, and offers ideas when reopened', () => {
    const { unmount } = render(<GalleryColumn manifest={manifest} onHide={vi.fn()} onStart={vi.fn()} welcome />);
    expect(screen.getByRole('heading', { name: 'Welcome to Cowork' })).toBeInTheDocument();
    expect(screen.getByText(/^Not sure where to start\?/)).toBeInTheDocument();
    unmount();

    render(<GalleryColumn manifest={manifest} onHide={vi.fn()} onStart={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Use Case Gallery' })).toBeInTheDocument();
    expect(screen.getByText(/^Running out of ideas\?/)).toBeInTheDocument();
  });

  it('narrows to a tab', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Your documents 1' }));
    expect(rows().map((b) => b.textContent)).toEqual([expect.stringContaining('bank statement')]);
  });

  it('says when nothing matches', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('folds with the close button and with Escape', async () => {
    const { user, onHide } = setup();
    await user.click(screen.getByRole('button', { name: 'Hide the gallery' }));
    expect(onHide).toHaveBeenLastCalledWith('button');
    screen.getByRole('searchbox').focus();
    await user.keyboard('{Escape}');
    expect(onHide).toHaveBeenLastCalledWith('escape');
  });

  it('says the examples cannot load, and offers to try again', async () => {
    const { user, onRetry } = setup({ manifest: null, failure: 'network' });
    expect(screen.getByText("The examples can't load right now.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('GalleryColumn example', () => {
  it('opens an example, steps through the list, and goes back to the same search', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('searchbox'), 'a');
    await user.click(rows()[0]);
    expect(trackGalleryExampleOpened).toHaveBeenLastCalledWith('research-a-prospect-and-draft-outreach', 'search');
    expect(screen.getByRole('heading', { name: 'Research a prospect and draft outreach' })).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous example' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next example' }));
    expect(screen.getByRole('heading', { name: 'Turn a bank statement into a spreadsheet' })).toBeInTheDocument();
    expect(trackGalleryExampleOpened).toHaveBeenLastCalledWith('turn-a-bank-statement-into-a-spreadsheet', 'step');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('heading', { name: 'Plan a project rollout timeline' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Results for “a”/ }));
    expect(screen.getByRole('searchbox')).toHaveValue('a');
  });

  it('shows a written result with what Cowork made and starts from it', async () => {
    const { user, onStart } = setup();
    await user.click(rows()[1]);
    expect(screen.getByText('The brief is done.')).toBeInTheDocument();
    expect(screen.getByText(/Built with MindsHub Air · About 3 minutes/)).toBeInTheDocument();
    expect(screen.getByText('Runs it now on sample data, as a new task.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try this example' }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'research-a-prospect-and-draft-outreach' }));
  });

  it('only fills the box for an example that can take the person\'s file', async () => {
    const { user, onStart } = setup();
    await user.click(rows()[2]);
    expect(screen.queryByRole('button', { name: 'Try this example' })).not.toBeInTheDocument();
    expect(screen.getByText('Puts the message in the box. Nothing runs until you press Send.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start from this example' }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'turn-a-bank-statement-into-a-spreadsheet' }));
  });

  it('opens a live example in the browser and frames nothing', async () => {
    const { user, openExternal } = setup();
    await user.click(rows()[0]);
    expect(document.querySelector('iframe')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open it in your browser' }));
    expect(openExternal).toHaveBeenCalledWith('https://view.example.test/v/1');
  });

  it('offers the own-work start only for examples that take a file, and downloads from the console', async () => {
    const { user, onOwnWork, openExternal } = setup();
    await user.click(rows()[2]);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(openExternal).toHaveBeenCalledWith(`${CONSOLE}/gallery-examples/s.xlsx`);
    await user.click(screen.getByRole('button', { name: 'Use my own file' }));
    expect(onOwnWork).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Previous example' }));
    expect(screen.queryByRole('button', { name: 'Use my own file' })).not.toBeInTheDocument();
  });

  it('draws a written result as chat draws an answer, keeping its text literal', async () => {
    const { user } = setup({ manifest: readGalleryManifest({
      version: 1, sections: [{ category: 'Your documents', line: '', ids: ['summarize-a-document-and-draft-my-reply'] }], startHere: [],
      entries: [entry({
        id: 'summarize-a-document-and-draft-my-reply', mode: 'wide-research', title: 'Summarize a document', category: 'Your documents',
        answer: { blocks: [
          { type: 'heading', text: 'Summary' },
          { type: 'table', columns: ['Term', 'Current'], rows: [['Price', '$4.80/lb'], ['Pipe | cell', '—']] },
          { type: 'paragraph', text: 'About ~$420/month, or ~$5,000/year, with *no* change.' },
          { type: 'list', ordered: true, items: ['Decide by Friday.'] },
        ] },
      })],
    }, `${CONSOLE}/gallery-examples/manifest.json`) });
    await user.click(screen.getAllByRole('button').find((b) => /Summarize a document/.test(b.textContent)));
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Term', 'Current']);
    expect(within(table).getByRole('cell', { name: 'Pipe | cell' })).toBeInTheDocument();
    expect(screen.getByText('About ~$420/month, or ~$5,000/year, with *no* change.')).toBeInTheDocument();
    expect(document.querySelector('del, s, .katex, em')).toBeNull();
    expect(within(screen.getByRole('list')).getByText('Decide by Friday.')).toBeInTheDocument();
  });

  it('jumps to a category from the breadcrumb', async () => {
    const { user } = setup();
    await user.click(rows()[2]);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    await user.click(within(crumbs).getByRole('button', { name: 'Your documents' }));
    expect(screen.getByRole('tab', { name: 'Your documents 1' })).toHaveAttribute('aria-selected', 'true');
  });
});
