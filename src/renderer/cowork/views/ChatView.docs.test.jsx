// A doc in the chat: its card opens it beside the conversation, and a doc the
// agent creates mid-turn opens there by itself.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const conv = vi.hoisted(() => ({ handlers: null, reports: 0, realPane: false }));

vi.mock('../lib/artifactsStore', () => ({
  useArtifactLiveness: () => false,
  setArtifactsScope: vi.fn(),
  revalidate: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: false,
    isMac: () => false,
    getPlatform: () => 'linux',
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

vi.mock('../components/artifact', () => ({ ArtifactViewer: () => null }));

// The docs API as the pane's own tests see it, for the test that renders the
// real pane.
vi.mock('../components/doc/docApi');

// Reports what it shows, as the real pane does once its doc has loaded; the
// real pane where a test asks for it.
vi.mock('../components/doc/DocPane', async (importOriginal) => {
  const { useEffect } = await import('react');
  const { default: RealDocPane } = await importOriginal();
  function FakeDocPane({ artifactId, projectRef, onClose, onViewChange, onAskAgent }) {
    useEffect(() => {
      conv.reports += 1;
      onViewChange?.({ artifactId, projectId: projectRef, title: 'Vendor shortlist', tab: 't_1', rev: 1, mode: 'edit' });
    }, [artifactId, projectRef, onViewChange]);
    return (
      <div data-testid="doc-pane" data-artifact={artifactId} data-project={projectRef}>
        <button type="button" onClick={onClose}>Close doc</button>
        {onAskAgent && (
          <button type="button" onClick={() => onAskAgent({ blockIds: ['b_1'], quote: '  Acme   leads\non price ', request: 'Make it shorter', tabId: 't_1', mode: 'edit' })}>
            Edit with agent
          </button>
        )}
      </div>
    );
  }
  return { default: (props) => (conv.realPane ? <RealDocPane {...props} /> : <FakeDocPane {...props} />) };
});

// The rail lists the project's artifacts; here it only has to open a doc.
vi.mock('../components/rail/WorkingFolderLive', () => ({
  WorkingFolderLive: ({ onOpenDoc }) => (
    <button type="button" onClick={() => onOpenDoc?.({ id: 'ffffffffffffffffffffffffffffffff', title: 'Rail doc', format: 'doc', projectId: 'proj-1' })}>
      Rail doc
    </button>
  ),
}));

vi.mock('../components/doc/useConversationDocs', () => ({
  useConversationDocs: (_id, handlers) => { conv.handlers = handlers; conv.enabled = handlers.enabled; },
}));

import ChatView from './ChatView';
import { docContextFor } from '../lib/docViewContext';
import * as docApi from '../components/doc/docApi';

const DOC_ID = '33e65fe7f08743aba742e888db31ae1a';

const docStep = {
  id: 'artifact-vendor',
  label: 'Vendor shortlist',
  badge: 'Artifact',
  icon: 'sparkle',
  status: 'completed',
  data: {
    title: 'Vendor shortlist',
    file_path: '/proj/.anton/artifacts/vendor/doc.cdoc.json',
    path: '/proj/.anton/artifacts/vendor/doc.cdoc.json',
    primary: 'doc.cdoc.json',
    ext: '.json',
    action: 'document',
    kind: 'Doc',
    format: 'doc',
    id: DOC_ID,
    slug: 'vendor',
    projectId: 'proj-1',
    projectName: 'general',
  },
};

const task = (steps = [docStep]) => ({
  id: 'conv-a',
  title: 'Shortlist',
  status: 'active',
  messages: [
    { role: 'user', content: 'Write up the vendor shortlist as a doc' },
    { role: 'assistant', content: 'Done — the shortlist is in a doc.', steps },
  ],
});

beforeEach(() => { conv.handlers = null; conv.reports = 0; conv.realPane = false; docApi.resetDocApi(); });

describe('docs in the chat', () => {
  it('shows a doc card that opens the doc beside the chat', async () => {
    const user = userEvent.setup();
    render(<ChatView task={task()} />);
    expect(screen.queryByTestId('doc-pane')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const pane = screen.getByTestId('doc-pane');
    expect(pane.dataset.artifact).toBe(DOC_ID);
    expect(pane.dataset.project).toBe('proj-1');
    expect(screen.getByText('Doc · open beside the chat')).toBeInTheDocument();
  });

  it('follows the conversation\'s docs only while a turn runs', () => {
    const { rerender } = render(<ChatView task={task([])} />);
    expect(conv.enabled).toBe(false);
    const streaming = task([]);
    streaming.messages.push({ role: '_streaming', content: '', steps: [] });
    rerender(<ChatView task={streaming} />);
    expect(conv.enabled).toBe(true);
  });

  it('opens a doc the agent creates in this conversation, as it is created', () => {
    render(<ChatView task={task([])} />);
    act(() => conv.handlers.onCreated({ type: 'doc.created', artifactId: DOC_ID, title: 'Live doc', card: { projectId: 'proj-1' } }));
    expect(screen.getByTestId('doc-pane').dataset.artifact).toBe(DOC_ID);
  });

  it('does not reopen a doc the person closed when the agent edits it again', async () => {
    const user = userEvent.setup();
    render(<ChatView task={task([])} />);
    act(() => conv.handlers.onCreated({ type: 'doc.created', artifactId: DOC_ID, title: 'Live doc', card: { projectId: 'proj-1' } }));
    await user.click(screen.getByRole('button', { name: 'Close doc' }));
    act(() => conv.handlers.onUpdated({ type: 'doc.updated', artifactId: DOC_ID, title: 'Live doc' }));
    expect(screen.queryByTestId('doc-pane')).toBeNull();
    act(() => conv.handlers.onUpdated({ type: 'doc.updated', artifactId: 'ffffffffffffffffffffffffffffffff', title: 'Other' }));
    expect(screen.getByTestId('doc-pane').dataset.artifact).toBe('ffffffffffffffffffffffffffffffff');
  });
});

describe('the doc beside a turn that is running', () => {
  const liveDoc = (rev) => ({
    schema: 'cowork.doc/1', id: DOC_ID, title: 'Live doc', rev,
    tabs: [{ id: 't_1', title: 'Live doc', blocks: [{ id: 'b_1', type: 'paragraph', text: 'Lead', v: 1, by: 'agent' }] }],
  });

  it('says the agent is writing only while the agent writes this doc', async () => {
    // Found in review: any running turn marked the doc as being written, so a
    // question about something else animated it and hid "Not saved yet".
    conv.realPane = true;
    docApi.fetchDoc.mockResolvedValue({ doc: liveDoc(1), capabilities: { canEdit: true } });
    const running = task([]);
    running.messages.push({ role: '_streaming', content: '', steps: [] });
    render(<ChatView task={running} />);
    act(() => conv.handlers.onCreated({ type: 'doc.created', artifactId: DOC_ID, title: 'Live doc', card: { projectId: 'proj-1' } }));
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveTextContent('Live doc');
    expect(screen.queryByText('Agent is writing')).toBeNull();

    act(() => docApi.stream.handlers.onEvent({ type: 'doc.updated', by: 'agent', rev: 2, touched: { t_1: ['b_1'] }, doc: liveDoc(2) }));
    expect(screen.getByText('Agent is writing')).toBeInTheDocument();
  });
});

describe('a doc opened from the chat\'s Artifacts rail', () => {
  it('opens beside the chat, as from its card', () => {
    render(<ChatView task={task([])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rail doc' }));
    const pane = screen.getByTestId('doc-pane');
    expect(pane.dataset.artifact).toBe('ffffffffffffffffffffffffffffffff');
    expect(pane.dataset.project).toBe('proj-1');
    expect(docContextFor('conv-a')).toMatchObject({ artifactId: 'ffffffffffffffffffffffffffffffff' });
  });
});

describe('the doc beside one conversation', () => {
  it('reports its view once, not on every streamed word', async () => {
    const user = userEvent.setup();
    const live = (text) => {
      const t = task();
      t.messages.push({ role: '_streaming', content: text, steps: [] });
      return t;
    };
    const { rerender } = render(<ChatView task={live('The')} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(conv.reports).toBe(1);
    rerender(<ChatView task={live('The short')} />);
    rerender(<ChatView task={live('The shortlist is')} />);
    expect(conv.reports).toBe(1);
  });

  it('opens the first doc the agent edits when two edits arrive together', () => {
    render(<ChatView task={task([])} />);
    act(() => {
      conv.handlers.onUpdated({ type: 'doc.updated', artifactId: DOC_ID, title: 'First' });
      conv.handlers.onUpdated({ type: 'doc.updated', artifactId: 'ffffffffffffffffffffffffffffffff', title: 'Second' });
    });
    expect(screen.getByTestId('doc-pane').dataset.artifact).toBe(DOC_ID);
  });

  it('stops riding on that conversation\'s messages once the chat moves to another', async () => {
    // Found in review: the switch closed the pane, but the old conversation's
    // messages (a queued one, a Try again) kept carrying its doc.
    const user = userEvent.setup();
    const { rerender } = render(<ChatView task={task()} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(docContextFor('conv-a')).toMatchObject({ artifactId: DOC_ID });

    rerender(<ChatView task={{ ...task([]), id: 'conv-b' }} />);
    expect(screen.queryByTestId('doc-pane')).toBeNull();
    expect(docContextFor('conv-a')).toBeNull();
    // Nor does it land on the conversation the chat moved to.
    expect(docContextFor('conv-b')).toBeNull();
  });
});

describe('the divider beside the doc', () => {
  it('resizes the doc while dragged, and lets go when the pointer is lost', async () => {
    // Found in review: the drag listened on the window with no cancel and no
    // cleanup, so a cancelled touch or a lost capture left it dragging.
    const user = userEvent.setup();
    const { container } = render(<ChatView task={task()} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const area = container.querySelector('[style*="grid-template-columns"]');
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 200, right: 1200, width: 1000, top: 0, bottom: 800, height: 800 });
    const divider = screen.getByRole('separator', { name: 'Resize the doc' });
    divider.setPointerCapture ??= () => {};

    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 600 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 700 });
    expect(area.style.gridTemplateColumns).toContain(' 50%)');
    expect(divider.dataset.active).toBe('true');

    fireEvent.lostPointerCapture(divider, { pointerId: 1 });
    expect(divider.dataset.active).toBeUndefined();
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1000 });
    expect(area.style.gridTemplateColumns).toContain(' 50%)');
  });

  it('moves with the keyboard, and says where it is', async () => {
    // Found in review: it could only be dragged.
    const user = userEvent.setup();
    const { container } = render(<ChatView task={task()} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const area = container.querySelector('[style*="grid-template-columns"]');
    const divider = screen.getByRole('separator', { name: 'Resize the doc' });
    expect(divider).toHaveAttribute('aria-orientation', 'vertical');
    expect(divider).toHaveAttribute('aria-valuemin', '32');
    expect(divider).toHaveAttribute('aria-valuemax', '78');
    expect(divider).toHaveAttribute('aria-valuenow', '58');

    divider.focus();
    expect(divider).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(divider).toHaveAttribute('aria-valuenow', '62');
    expect(area.style.gridTemplateColumns).toContain(' 62%)');
    await user.keyboard('{ArrowRight}');
    expect(divider).toHaveAttribute('aria-valuenow', '60');
    await user.keyboard('{End}');
    expect(area.style.gridTemplateColumns).toContain(' 78%)');
    await user.keyboard('{Home}');
    expect(divider).toHaveAttribute('aria-valuenow', '32');
  });

  it('gives the chat its column transition back when the doc closes mid-drag', async () => {
    const user = userEvent.setup();
    const { container } = render(<ChatView task={task()} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const area = container.querySelector('[style*="grid-template-columns"]');
    const divider = screen.getByRole('separator', { name: 'Resize the doc' });
    divider.setPointerCapture ??= () => {};
    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 600 });
    expect(area.className).not.toContain('transition-[grid-template-columns]');
    await user.click(screen.getByRole('button', { name: 'Close doc' }));
    expect(area.className).toContain('transition-[grid-template-columns]');
  });
});

describe('Edit with agent from the doc beside the chat', () => {
  it('sends the request with its own message, naming the doc it was made in', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatView task={task()} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Edit with agent' }));
    expect(onSend).toHaveBeenCalledWith('> Acme leads on price\n\nMake it shorter', [], {
      docRequest: {
        artifactId: DOC_ID,
        projectId: 'proj-1',
        tab: 't_1',
        selection: { blockIds: ['b_1'], quote: '  Acme   leads\non price ' },
        request: 'Make it shorter',
      },
    });
    // Nothing parked for whichever message goes next.
    expect(docContextFor('conv-a')).not.toHaveProperty('request');
  });
});
