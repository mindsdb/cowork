// ENG-4684: an artifact the agent marked `display: "inline"` shows its live
// page in the body of its chat card, under the card's usual head and actions.
// Every other artifact keeps the row card. The frame itself (sandbox, height,
// theme, lazy mount) is ArtifactInlinePreview.test.jsx's business.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const loadHtmlPreview = vi.fn();
const loadHtmlRevision = vi.fn();
vi.mock('../components/artifact/htmlPreviewSource', () => ({
  loadHtmlPreview: (...a) => loadHtmlPreview(...a),
  loadHtmlRevision: (...a) => loadHtmlRevision(...a),
  usesDraftLink: () => false,
  withdrawDraftLinks: vi.fn(async () => false),
}));

const deleted = vi.fn(() => false);
vi.mock('../lib/artifactsStore', () => ({
  useArtifactLiveness: (card, opts) => deleted(card, opts),
  useArtifactCardBySlug: () => null,
  setArtifactsScope: vi.fn(),
  revalidate: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: true,
    isWeb: false,
    isMac: () => true,
    getPlatform: () => 'darwin',
    getApiOrigin: () => 'http://127.0.0.1:26866',
    isLocalApiOrigin: () => true,
    openPath: vi.fn(),
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: true,
  isWeb: false,
}));

import ChatView, { ArtifactCard, artifactStepToCard } from './ChatView';
import { initialStreamState, reduceStream } from '../lib/responseStreamAdapter';

const step = (overrides = {}) => ({
  id: 'artifact-revenue',
  label: 'Revenue by month',
  badge: 'Artifact',
  status: 'completed',
  data: {
    title: 'Revenue by month',
    file_path: '/proj/.anton/artifacts/revenue/index.html',
    path: '/proj/.anton/artifacts/revenue/index.html',
    ext: '.html',
    action: 'html-app',
    slug: 'revenue',
    ...overrides,
  },
});

const card = (overrides) => artifactStepToCard(step(overrides), '/proj');

// Every observed card is in view at once: the lazy mount is tested with
// the preview itself.
class InViewObserver {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IntersectionObserver', InViewObserver);
  deleted.mockReturnValue(false);
  loadHtmlPreview.mockResolvedValue({ kind: 'static', url: '', doc: '<p>chart</p>', port: null, expiresAt: null });
  loadHtmlRevision.mockResolvedValue({ doc: '<p>chart then</p>' });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('ArtifactCard inline mode', () => {
  it('shows the live page inside the card for an inline HTML artifact, keeping its actions', async () => {
    const onOpen = vi.fn();
    render(<ArtifactCard artifact={card({ display: 'inline' })} onOpen={onOpen} />);

    const frame = await screen.findByTitle('Revenue by month');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    // A group around a live page, not a button.
    expect(screen.getByRole('group', { name: 'Revenue by month' })).toBeInTheDocument();

    // Preview still opens it full size in the viewer.
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ title: 'Revenue by month', display: 'inline' }));
  });

  it('opens the viewer on the place the live page is at', async () => {
    const onOpen = vi.fn();
    render(<ArtifactCard artifact={card({ display: 'inline' })} onOpen={onOpen} />);
    const frame = await screen.findByTitle('Revenue by month');
    // The preview shim's view report, from the card's own frame.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          source: 'anton-preview', type: 'view', hash: '#q3', scrollX: 0, scrollY: 120,
          inputs: [{ type: 'click', path: 'button:2', label: 'Q3' }], heading: 'Q3',
        },
      }));
    });

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Revenue by month' }),
      { view: expect.objectContaining({ hash: '#q3', scrollY: 120, inputs: [{ type: 'click', path: 'button:2', label: 'Q3' }] }) },
    );
    // The title opens it the same way.
    await userEvent.click(screen.getByRole('button', { name: /Revenue by month/ }));
    expect(onOpen).toHaveBeenLastCalledWith(expect.anything(), { view: expect.objectContaining({ hash: '#q3' }) });
  });

  it('reads the flag nested under metadata too', async () => {
    render(<ArtifactCard artifact={card({ metadata: { display: 'inline' } })} onOpen={vi.fn()} />);
    expect(await screen.findByTitle('Revenue by month')).toBeInTheDocument();
  });

  it('keeps the row card for an artifact without the flag', async () => {
    render(<ArtifactCard artifact={card()} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Revenue by month/ })).toBeInTheDocument();
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
    await waitFor(() => expect(loadHtmlPreview).not.toHaveBeenCalled());
  });

  it('keeps the row card for an inline artifact that is not an HTML page', () => {
    render(<ArtifactCard
      artifact={card({ display: 'inline', file_path: '/proj/.anton/artifacts/revenue/data.csv', path: '/proj/.anton/artifacts/revenue/data.csv', ext: '.csv' })}
      onOpen={vi.fn()}
    />);
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
  });

  it('keeps the row card for an inline fullstack app, which needs the viewer', () => {
    render(<ArtifactCard artifact={card({ display: 'inline', type: 'fullstack-stateless-app' })} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
  });

  it('shows no live page for a deleted artifact', () => {
    deleted.mockReturnValue(true);
    render(<ArtifactCard artifact={card({ display: 'inline' })} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
  });
});

// ENG-4684: one live copy per artifact. An earlier card the agent updated
// later folds to a line that opens to the page.
describe('ArtifactCard superseded inline card', () => {
  it('renders the plain card, with no frame until "Preview this version" opens its revision', async () => {
    const user = userEvent.setup();
    render(<ArtifactCard artifact={card({ display: 'inline', revisionId: 'rev-3' })} onOpen={vi.fn()} inlineSuperseded />);
    expect(screen.getByRole('button', { name: 'This was updated. See the latest version below.' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Preview this version' });
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
    expect(loadHtmlRevision).not.toHaveBeenCalled();

    await user.click(toggle);
    const frame = await screen.findByTitle('Revenue by month');
    expect(frame.getAttribute('srcdoc')).toBe('<p>chart then</p>');
    expect(loadHtmlRevision).toHaveBeenCalledWith(expect.objectContaining({ revisionId: 'rev-3' }));
    expect(loadHtmlPreview).not.toHaveBeenCalled();
  });

  it('opens to the revision the card was made at, under either key', async () => {
    const user = userEvent.setup();
    render(<ArtifactCard artifact={card({ display: 'inline', revision_id: 'rev-3' })} onOpen={vi.fn()} inlineSuperseded />);
    await user.click(screen.getByRole('button', { name: 'Preview this version' }));
    const frame = await screen.findByTitle('Revenue by month');
    expect(frame.getAttribute('srcdoc')).toBe('<p>chart then</p>');
    expect(loadHtmlRevision).toHaveBeenCalledWith(expect.objectContaining({ revisionId: 'rev-3' }));
    expect(loadHtmlPreview).not.toHaveBeenCalled();
  });

  // The bug: with no revision the button loaded the draft, so an earlier
  // reply's card showed the latest page under "Preview this version".
  it('offers no "Preview this version" without a revision, and never frames the latest page', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ArtifactCard artifact={card({ display: 'inline' })} onOpen={onOpen} inlineSuperseded />);
    expect(screen.getByTestId('artifact-inline-superseded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview this version' })).toBeNull();
    // The ordinary Preview opens the viewer, which says what version it shows.
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('artifact-inline-preview')).toBeNull();
    expect(loadHtmlPreview).not.toHaveBeenCalled();
    expect(loadHtmlRevision).not.toHaveBeenCalled();
  });

  it("keeps the stream event's revisionId through the step to the version preview", async () => {
    const user = userEvent.setup();
    // As the server sends it (camelCase), and as a reload replays it.
    const first = reduceStream(initialStreamState(), {
      type: 'response.artifact_created',
      artifact: {
        slug: 'revenue', title: 'Revenue by month', type: 'html-app', display: 'inline', revisionId: 'rev-1',
        path: '/proj/.anton/artifacts/revenue/index.html',
      },
    }).steps[0];
    render(<ArtifactCard artifact={artifactStepToCard(first, '/proj')} onOpen={vi.fn()} inlineSuperseded />);
    await user.click(screen.getByRole('button', { name: 'Preview this version' }));
    await screen.findByTitle('Revenue by month');
    expect(loadHtmlRevision).toHaveBeenCalledWith(expect.objectContaining({ revisionId: 'rev-1' }));
  });

  it('keeps the row card for a superseded artifact that is not inline', () => {
    render(<ArtifactCard artifact={card()} onOpen={vi.fn()} inlineSuperseded />);
    expect(screen.queryByTestId('artifact-inline-superseded')).toBeNull();
    expect(screen.getByRole('button', { name: /Revenue by month/ })).toBeInTheDocument();
  });
});

describe('ArtifactCard inline Submit', () => {
  it("sends the page's submit to the card's handler with the artifact", async () => {
    const onInlineSubmit = vi.fn();
    render(<ArtifactCard artifact={card({ display: 'inline' })} onOpen={vi.fn()} onInlineSubmit={onInlineSubmit} />);
    const frame = await screen.findByTitle('Revenue by month');
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: { source: 'anton-preview', type: 'submit', state: { budget: 3 }, message: 'Go' },
      }));
    });
    expect(onInlineSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'revenue' }),
      { state: { budget: 3 }, message: 'Go' },
    );
  });
});

describe('ChatView inline artifacts across turns', () => {
  const liveFrames = () => [...document.querySelectorAll('iframe[title="Revenue by month"]')];
  const answer = (id, text) => ({
    id, role: 'assistant', content: text, steps: [step({ display: 'inline' })],
  });

  it('keeps one live frame, at the latest card, and folds the earlier one', async () => {
    render(<ChatView task={{
      id: 'conv-inline', title: 'Chat', status: 'idle', messages: [
        { id: 'u1', role: 'user', content: 'chart revenue' },
        answer('a1', 'Here it is.'),
        { id: 'u2', role: 'user', content: 'make it blue' },
        answer('a2', 'Made it blue.'),
      ],
    }} />);
    await waitFor(() => expect(liveFrames()).toHaveLength(1));
    expect(screen.getAllByTestId('artifact-inline-preview')).toHaveLength(1);
    expect(screen.getAllByTestId('artifact-inline-superseded')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'This was updated. See the latest version below.' })).toBeInTheDocument();
  });

  it('scrolls "updated below" to the live copy of the same artifact', async () => {
    const user = userEvent.setup();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<ChatView task={{
      id: 'conv-inline-scroll', title: 'Chat', status: 'idle', messages: [
        { id: 'u1', role: 'user', content: 'chart revenue' },
        answer('a1', 'Here it is.'),
        { id: 'u2', role: 'user', content: 'make it blue' },
        answer('a2', 'Made it blue.'),
      ],
    }} />);
    await waitFor(() => expect(liveFrames()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /See the latest version below/ }));
    expect(scrolled).toHaveBeenCalledTimes(1);
    const target = scrolled.mock.contexts[0];
    expect(target.contains(liveFrames()[0])).toBe(true);
  });

  it("sends a Submit as a chat turn: the quick-edit prompt plus the state's JSON", async () => {
    const onSend = vi.fn();
    render(<ChatView onSend={onSend} task={{
      id: 'conv-inline', title: 'Chat', status: 'idle', messages: [
        { id: 'u1', role: 'user', content: 'chart revenue' },
        answer('a1', 'Here it is.'),
      ],
    }} />);
    // The step row in the turn's work log carries the same title.
    await waitFor(() => expect(liveFrames()).toHaveLength(1));
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: liveFrames()[0].contentWindow,
        data: { source: 'anton-preview', type: 'submit', state: { budget: 3 } },
      }));
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      'Submitted from the inline artifact.\n\n(About the artifact `revenue`.)\n\n```json\n{\n  "budget": 3\n}\n```',
      [],
    );
  });
});
