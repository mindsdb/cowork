// Quick edits in the chat transcript (ENG-4227): a message sent from the
// artifact viewer's bar shows the user's words with the artifact as a pill,
// and the server's quick-edit group message shows as one card.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: true,
    isMac: () => false,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));
const CARD = vi.hoisted(() => ({
  id: 'a1', slug: 'mindshub-explainer-a8c2272e', title: 'MindsHub explainer', type: 'html-app', ext: '.html',
  path: '/artifacts/mindshub-explainer/index.html',
}));
vi.mock('../lib/artifactsStore', async (importOriginal) => ({
  ...(await importOriginal()),
  useArtifactCardBySlug: (slug) => (slug === CARD.slug ? CARD : null),
}));
// The viewer the pill opens is covered elsewhere; here it only shows which artifact.
vi.mock('../components/artifact/ArtifactViewer', () => ({
  ArtifactViewer: ({ open, artifact }) => (open ? <div role="dialog" aria-label={`Viewer for ${artifact?.title}`} /> : null),
}));

import ChatView from './ChatView';

const PROMPT = 'hi\n\n(About the artifact `mindshub-explainer-a8c2272e`.)';
const taskWith = (messages) => ({ id: 'conv-qe', title: 'Chat', status: 'idle', messages });

describe('ChatView quick edits', () => {
  it("shows the bar's message without its suffix, with the artifact as a pill that opens it", async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith([
      { id: 'u1', role: 'user', content: PROMPT },
      { id: 'a1', role: 'assistant', content: 'Hello.' },
    ])} />);

    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.queryByText(/About the artifact/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open MindsHub explainer' }));
    expect(screen.getByRole('dialog', { name: 'Viewer for MindsHub explainer' })).toBeInTheDocument();
  });

  it('names an unknown artifact by its slug, without opening anything', () => {
    render(<ChatView task={taskWith([{ id: 'u1', role: 'user', content: 'hi\n\n(About the artifact `gone-1`.)' }])} />);
    expect(screen.getByText('gone-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open gone-1/ })).toBeNull();
  });

  it('renders a quick-edit group as one card, without a turn toolbar or agent label', () => {
    render(<ChatView task={taskWith([
      { id: 'u0', role: 'user', content: 'make a deck' },
      { id: 'a0', role: 'assistant', content: 'Made it.' },
      {
        id: 'g1',
        role: 'assistant',
        harness: 'cowork-quick-edit',
        // Model-facing text, never shown.
        content: 'Changes made directly in the viewer of artifact.',
        quickEditGroup: {
          type: 'response.quick_edit_group',
          kind: 'quick_edit_group',
          artifactSlug: CARD.slug,
          artifactTitle: CARD.title,
          edits: [
            { editId: 'e1', request: 'blue title', summary: 'Made the title blue.', at: '2026-11-12T10:00:00Z' },
            { editId: 'e2', request: 'bigger', summary: 'Made it bigger.', at: '2026-11-12T10:02:00Z', undone: true },
          ],
        },
      },
    ])} />);

    const card = screen.getByRole('region', { name: 'Edited in the viewer' });
    expect(within(card).getByText('2 changes')).toBeInTheDocument();
    expect(within(card).getByText('Made the title blue.')).toBeInTheDocument();
    expect(within(card).getByText('Undone')).toBeInTheDocument();
    expect(screen.queryByText(/Changes made directly/)).toBeNull();
    expect(screen.queryByText(/cowork-quick-edit/i)).toBeNull();
  });

  it('updates the card when the group message gains an edit', () => {
    const group = (edits) => ({
      id: 'g1', role: 'assistant', harness: 'cowork-quick-edit', content: '',
      quickEditGroup: { type: 'response.quick_edit_group', kind: 'quick_edit_group', artifactSlug: CARD.slug, artifactTitle: CARD.title, edits },
    });
    const one = [{ editId: 'e1', request: 'blue', summary: 'Blue.' }];
    const view = render(<ChatView task={taskWith([group(one)])} />);
    expect(screen.getByText('1 change')).toBeInTheDocument();

    view.rerender(<ChatView task={taskWith([group([...one, { editId: 'e2', request: 'big', summary: 'Bigger.' }])])} />);
    expect(screen.getByText('2 changes')).toBeInTheDocument();
    expect(screen.getByText('Bigger.')).toBeInTheDocument();
  });

  it('folds an older request and note pair into a one-edit card', () => {
    render(<ChatView task={taskWith([
      { id: 'u1', role: 'user', content: 'make the title blue' },
      {
        id: 'n1',
        role: 'assistant',
        harness: 'cowork-quick-edit',
        content: 'I edited this artifact directly from its viewer (quick edit): Made the title blue.\nFiles changed: index.html.\nSaved as draft revision 2; not published.',
      },
    ])} />);

    const card = screen.getByRole('region', { name: 'Edited in the viewer' });
    expect(within(card).getByText('make the title blue')).toBeInTheDocument();
    expect(within(card).getByText('Made the title blue.')).toBeInTheDocument();
    expect(screen.getAllByText('make the title blue')).toHaveLength(1);
    expect(screen.queryByText(/I edited this artifact directly/)).toBeNull();
  });

  it('draws three adjacent older pairs as one card', () => {
    const pair = (n, ask, done, at) => [
      { id: `u${n}`, role: 'user', content: ask },
      { id: `n${n}`, role: 'assistant', harness: 'cowork-quick-edit', created_at: at, content: `I edited this artifact directly from its viewer (quick edit): ${done}\nSaved as draft revision ${n}; not published.` },
    ];
    render(<ChatView task={taskWith([
      ...pair(1, 'blue title', 'Made the title blue.', '2026-11-12T12:08:00'),
      ...pair(2, 'bigger', 'Made it bigger.', '2026-11-12T12:12:00'),
      ...pair(3, 'bold', 'Made it bold.', '2026-11-12T12:13:00'),
    ])} />);

    const cards = screen.getAllByRole('region', { name: 'Edited in the viewer' });
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText('3 changes')).toBeInTheDocument();
    expect(within(cards[0]).getAllByRole('listitem')).toHaveLength(3);
  });

  it('draws an older pair and the next server group as one card with the pill', () => {
    render(<ChatView task={taskWith([
      { id: 'u1', role: 'user', content: 'blue title' },
      { id: 'n1', role: 'assistant', harness: 'cowork-quick-edit', content: 'I edited this artifact directly from its viewer (quick edit): Made the title blue.' },
      {
        id: 'g1', role: 'assistant', harness: 'cowork-quick-edit', content: 'model-facing',
        quickEditGroup: {
          type: 'response.quick_edit_group', kind: 'quick_edit_group', artifactSlug: CARD.slug, artifactTitle: CARD.title,
          edits: [{ editId: 'e2', request: 'bigger', summary: 'Made it bigger.' }],
        },
      },
    ])} />);

    const cards = screen.getAllByRole('region', { name: 'Edited in the viewer' });
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText('2 changes')).toBeInTheDocument();
    expect(within(cards[0]).getByRole('button', { name: 'Open MindsHub explainer' })).toBeInTheDocument();
  });

  it('puts the pill inside the request bubble, under the text', () => {
    render(<ChatView task={taskWith([{ id: 'u1', role: 'user', content: PROMPT }])} />);
    const bubble = screen.getByText('hi').closest('.user-turn-bubble');
    expect(within(bubble).getByRole('button', { name: 'Open MindsHub explainer' })).toBeInTheDocument();
  });
});

