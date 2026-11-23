// DocModal opens full screen or at the artifact viewer's size, as the viewer
// does, and shares the remembered choice with it. Its panel rail adds tabs and
// opens the doc's comments.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('./docApi');
// The doc's comments as the rail and inbox see them; off unless a test turns them on.
const comments = vi.hoisted(() => ({ current: null }));
vi.mock('./useDocComments', () => ({ useDocComments: () => comments.current }));
vi.mock('../ui/Modal', async (importOriginal) => ({
  ...(await importOriginal()),
  Modal: ({ children, fullBleed }) => <div data-testid="modal" data-full-bleed={fullBleed ? 'true' : 'false'}>{children}</div>,
}));

import DocModal from './DocModal';
import * as api from './docApi';
import { host } from '../../../platform/host';
import { LAYOUT_STORAGE_KEY } from '../artifact/useViewerLayout';
import { OriginChatContext } from '../../lib/originChat';

const doc = {
  schema: 'cowork.doc/1',
  id: 'a1',
  title: 'Vendor shortlist',
  rev: 1,
  updated_at: new Date().toISOString(),
  tabs: [{ id: 't_1', title: 'Vendor shortlist', blocks: [{ id: 'b_1', type: 'paragraph', text: 'Acme', v: 1 }] }],
};

const artifact = { id: 'a1', projectId: 'p1', title: 'Vendor shortlist' };
const modal = () => screen.getByTestId('modal');
const pane = () => screen.getByRole('region', { name: 'Vendor shortlist' });

async function renderModal() {
  const view = render(<DocModal artifact={artifact} onClose={() => {}} />);
  await screen.findByRole('textbox', { name: 'Title' });
  return view;
}

const commentsOff = () => ({
  enabled: false, threads: [], viewer: null, capabilities: null, error: '', expired: false, unreadCount: 0,
  markRead: vi.fn(), create: vi.fn(), reply: vi.fn(), setStatus: vi.fn(), editThread: vi.fn(),
  deleteThread: vi.fn(), loadImage: vi.fn(),
});

beforeEach(() => {
  window.localStorage.clear();
  comments.current = commentsOff();
  api.resetDocApi();
  api.fetchDoc.mockResolvedValue({ doc, capabilities: { canEdit: true } });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('DocModal', () => {
  it('opens full screen, and leaves and goes back to it from the button and from Ctrl+Shift+Enter', async () => {
    await renderModal();
    expect(modal()).toHaveAttribute('data-full-bleed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(modal()).toHaveAttribute('data-full-bleed', 'false');
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(modal()).toHaveAttribute('data-full-bleed', 'true');
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument();
  });

  it('opens at the size the artifact viewer was last left at', async () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ maximized: false }));
    const first = await renderModal();
    expect(modal()).toHaveAttribute('data-full-bleed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    first.unmount();

    await renderModal();
    expect(modal()).toHaveAttribute('data-full-bleed', 'true');
  });

  it('keeps close at the end of the line, after full screen', async () => {
    await renderModal();
    const controls = document.querySelector('.doc-header__window-controls');
    const labels = within(controls).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Exit full screen', 'Close doc']);
  });

  it('is the window title bar on a Mac only while full screen', async () => {
    const wasElectron = host.isElectron;
    host.isElectron = true;
    const isMac = vi.spyOn(host, 'isMac').mockReturnValue(true);
    try {
      await renderModal();
      expect(pane()).toHaveAttribute('data-corner', 'window');
      expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+Enter');

      fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
      expect(pane()).not.toHaveAttribute('data-corner');
    } finally { host.isElectron = wasElectron; isMac.mockRestore(); }
  });
});

describe('DocModal panel rail', () => {
  const twoTabs = {
    ...doc,
    tabs: [
      doc.tabs[0],
      { id: 't_2', title: 'Risks', blocks: [{ id: 'b_2', type: 'paragraph', text: 'Beta slips', v: 1 }] },
    ],
  };

  it('adds a tab from the rail, and nowhere on the page', async () => {
    api.postDocOps.mockResolvedValue({ doc: twoTabs, rev: 2, results: [] });
    await renderModal();
    const adds = screen.getAllByRole('button', { name: 'Add tab' });
    expect(adds).toHaveLength(1);
    expect(adds[0].closest('.artifact-mode-rail')).not.toBeNull();

    fireEvent.click(adds[0]);
    await waitFor(() => expect(api.postDocOps).toHaveBeenCalledWith('p1', 'a1', expect.objectContaining({
      ops: [{ op: 'add_tab', title: 'Untitled' }],
    })));
    // The new tab's list has no add of its own in a preview.
    expect(await screen.findByRole('tab', { name: 'Risks' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add tab' })).toHaveLength(1);
  });

  it('offers no Add tab to someone who cannot edit', async () => {
    api.fetchDoc.mockResolvedValue({ doc, capabilities: { canEdit: false } });
    render(<DocModal artifact={artifact} onClose={() => {}} />);
    await screen.findByText('Acme');
    expect(screen.queryByRole('button', { name: 'Add tab' })).toBeNull();
  });

  it('opens the comments, goes to the blocks a comment is on, and sends it to the agent', async () => {
    api.fetchDoc.mockResolvedValue({ doc: twoTabs, capabilities: { canEdit: true } });
    const thread = {
      id: 'th_1',
      status: 'open',
      created_at: new Date().toISOString(),
      selector: JSON.stringify({ type: 'doc-block', tab: 't_2', blocks: ['b_2'], quote: 'Beta' }),
      payload: { text: 'Say by how much', author: { user_id: 'u1', email: 'ann@example.com' }, replies: [] },
    };
    comments.current = {
      ...commentsOff(),
      enabled: true,
      threads: [thread],
      viewer: { user_id: 'u1', role: 'owner' },
      capabilities: { canResolve: true, canAddressWithAgent: true },
    };
    const onAskAgent = vi.fn();
    render(<DocModal artifact={artifact} onClose={() => {}} onAskAgent={onAskAgent} />);
    await screen.findByRole('tab', { name: 'Vendor shortlist' });

    fireEvent.click(screen.getByRole('button', { name: 'Comments, 1 open' }));
    const panel = await screen.findByTestId('viewer-side-panel');
    fireEvent.click(within(panel).getByText('Say by how much'));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Risks' })).toHaveAttribute('aria-selected', 'true'));
    expect(document.querySelector('[data-block-id="b_2"]')).toHaveClass('doc-block--selected');
    // The card opened to its thread, with a box to reply.
    expect(within(panel).getByRole('textbox', { name: 'Reply to this comment' })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Address with agent' }));
    await waitFor(() => expect(onAskAgent).toHaveBeenCalledWith({
      blockIds: ['b_2'],
      tabId: 't_2',
      request: 'Address this comment on the text “Beta”:\n> Say by how much',
      attachments: [],
    }));
  });

  const commentsOn = (more = {}) => ({
    ...commentsOff(),
    enabled: true,
    viewer: { user_id: 'u1', role: 'owner' },
    capabilities: { canResolve: true, canAddressWithAgent: true },
    create: vi.fn().mockResolvedValue(true),
    ...more,
  });
  const railButton = (name) => within(document.querySelector('.artifact-mode-rail')).getByRole('button', { name });
  const modeSwitch = () => screen.queryByRole('toolbar', { name: 'Comments toolbar' });

  it('opens the comments from the rail in comment mode: the page is read-only and a click comments on a block', async () => {
    comments.current = commentsOn();
    await renderModal();
    fireEvent.click(railButton(/^Comments/));

    expect(within(modeSwitch()).getByRole('button', { name: 'Comment' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('textbox', { name: 'Paragraph' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();

    fireEvent.click(screen.getByText('Acme'));
    const box = document.querySelector('.doc-ask input');
    fireEvent.change(box, { target: { value: 'Too vague' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(comments.current.create).toHaveBeenCalledWith(expect.objectContaining({
      selector: JSON.stringify({ type: 'doc-block', tab: 't_1', blocks: ['b_1'], quote: '' }),
      text: 'Too vague',
    })));
  });

  it('switches to Edit and back, and closing the comments leaves edit mode on', async () => {
    comments.current = commentsOn();
    await renderModal();
    fireEvent.click(railButton(/^Comments/));
    expect(screen.queryByRole('textbox', { name: 'Paragraph' })).toBeNull();

    fireEvent.click(within(modeSwitch()).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Paragraph' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Acme'));
    expect(document.querySelector('.doc-ask input')).toBeNull();

    fireEvent.click(within(modeSwitch()).getByRole('button', { name: 'Comment' }));
    expect(screen.queryByRole('textbox', { name: 'Paragraph' })).toBeNull();

    fireEvent.click(railButton(/^Comments/));
    expect(modeSwitch()).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Paragraph' })).toBeInTheDocument();
  });

  it('keeps a general comment on the whole doc in the inbox', async () => {
    comments.current = commentsOn();
    await renderModal();
    fireEvent.click(railButton(/^Comments/));
    const panel = await screen.findByTestId('viewer-side-panel');
    const box = within(panel).getByRole('textbox', { name: 'Add a comment' });
    fireEvent.change(box, { target: { value: 'Shorter, please' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(comments.current.create).toHaveBeenCalledWith(expect.objectContaining({
      selector: null, text: 'Shorter, please',
    })));
  });

  it('offers no Edit to someone who cannot edit, and a click still comments', async () => {
    api.fetchDoc.mockResolvedValue({ doc, capabilities: { canEdit: false } });
    comments.current = commentsOn();
    render(<DocModal artifact={artifact} onClose={() => {}} />);
    await screen.findByText('Acme');
    fireEvent.click(railButton(/^Comments/));
    expect(modeSwitch()).toBeNull();
    fireEvent.click(screen.getByText('Acme'));
    expect(document.querySelector('.doc-ask input')).not.toBeNull();
  });

  it('shows no Comments tab while the doc has no comments to reach', async () => {
    await renderModal();
    expect(screen.queryByRole('button', { name: /^Comments/ })).toBeNull();
  });

  describe('Open chat', () => {
    const ORIGIN = '3f6a1c8e-6b1d-4a2f-9a1e-2c7d5b0e4a11';
    const fromChat = { ...artifact, originConversationId: ORIGIN };
    const renderWithChats = async ({ status = 'ok', conversationId = null } = {}) => {
      const chats = { open: vi.fn(), check: vi.fn().mockResolvedValue(status) };
      const onClose = vi.fn();
      render(
        <OriginChatContext.Provider value={chats}>
          <DocModal artifact={fromChat} conversationId={conversationId} onClose={onClose} />
        </OriginChatContext.Provider>,
      );
      await screen.findByRole('textbox', { name: 'Title' });
      return { chats, onClose };
    };
    const rail = () => screen.getByRole('toolbar', { name: 'Viewer panels' });

    it('closes the doc and opens the chat it was made in', async () => {
      const { chats, onClose } = await renderWithChats();
      const button = within(rail()).getByRole('button', { name: 'Open chat' });
      await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));

      fireEvent.click(button);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(chats.open).toHaveBeenCalledWith(ORIGIN);
    });

    it('is absent inside the chat the doc was made in', async () => {
      const { chats } = await renderWithChats({ conversationId: ORIGIN });
      expect(within(rail()).queryByRole('button', { name: 'Open chat' })).toBeNull();
      expect(chats.check).not.toHaveBeenCalled();
    });
  });
});
