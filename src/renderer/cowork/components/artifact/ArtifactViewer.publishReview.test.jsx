/*
 * A change to a published artifact from the quick edit bar (ENG-4409): the
 * viewer opens the comparison of before and after, and the change goes live
 * only when the owner picks Publish this change. Keep as draft leaves the
 * published page as it was; Undo is the bar's own. An unpublished artifact
 * behaves as before. The comparison's own buttons are covered in
 * ArtifactComparison.test.jsx; here it is a stand-in that draws the actions
 * the viewer hands it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const reviewState = vi.hoisted(() => ({ setComparison: null }));
const workspaceMock = vi.hoisted(() => ({
  supported: true,
  mode: 'preview',
  setMode: vi.fn(),
  source: null,
  dirty: false,
  currentRevision: { id: 'r1' },
  revisions: [],
  capabilities: { role: 'owner', canEdit: true, canQuickEdit: true },
  capabilitiesFromServer: true,
  commentsReady: false,
  status: 'ready',
  error: '',
  conflict: null,
  repair: null,
  load: vi.fn(async () => {}),
  save: vi.fn(),
  draft: '',
  discard: vi.fn(),
  compareRevision: vi.fn(),
  reviewPublish: vi.fn(),
  refreshRepair: vi.fn(),
  addressWithAgent: vi.fn(),
  cancelRepair: vi.fn(),
}));

const workspaceApi = vi.hoisted(() => ({
  loadArtifactDraftDocument: vi.fn(),
  loadArtifactDraftText: vi.fn(),
  streamQuickEdit: vi.fn(),
  undoQuickEdit: vi.fn(),
  loadArtifactRevisions: vi.fn(async () => ({ revisions: [{ id: 'r1' }] })),
}));

const publishMock = vi.hoisted(() => ({
  url: '',
  orgMode: false,
  phase: 'idle',
  error: '',
  update: vi.fn(async () => true),
  refresh: vi.fn(async () => {}),
}));

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  artifactServeUrl: vi.fn(),
  submitArtifactCheck: vi.fn(),
  sendablePicks: (model, reasoningEffort) => ({ sendsPicks: true, model: null, reasoningEffort: reasoningEffort || null }),
}));
vi.mock('../../lib/artifactCheck', async (importOriginal) => ({
  ...(await importOriginal()),
  answerArtifactCheck: vi.fn(async () => true),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
vi.mock('../../lib/artifactWorkspaceApi', () => workspaceApi);
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: true,
    isMac: () => false,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'https://cowork.example',
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));
vi.mock('./publish/usePublish', () => ({
  usePublish: () => ({
    publishedUrl: publishMock.url,
    accessMode: 'public',
    artifactKey: 'artifact/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    orgMode: publishMock.orgMode,
    phase: publishMock.phase,
    busy: publishMock.phase !== 'idle',
    error: publishMock.error,
    modified: false,
    update: publishMock.update,
    refresh: publishMock.refresh,
  }),
}));
vi.mock('./publish/PublishMenu', () => ({ PublishMenu: () => null }));
vi.mock('./comments', () => ({
  useArtifactComments: () => ({
    threads: [], viewer: null, unreadCount: 0,
    create: vi.fn(), reply: vi.fn(), setStatus: vi.fn(),
    editThread: vi.fn(), deleteThread: vi.fn(), editReply: vi.fn(),
    deleteReply: vi.fn(), markRead: vi.fn(),
  }),
  useArtifactCommentLayer: () => ({
    mode: false, anchorStates: {}, onIframeLoad: vi.fn(), exitMode: vi.fn(),
    toggleMode: vi.fn(), focus: vi.fn(), hlOn: vi.fn(), hlOff: vi.fn(),
  }),
  CommentsPanel: () => null,
  CommentsToolbar: () => null,
}));
// The workspace's comparison is real state here, so opening and closing the
// review renders.
vi.mock('./workspace/useArtifactWorkspace', async () => {
  const { useState } = await import('react');
  return {
    useArtifactWorkspace: () => {
      const [comparison, setComparison] = useState(null);
      reviewState.setComparison = setComparison;
      return { ...workspaceMock, comparison, setComparison };
    },
  };
});
vi.mock('./workspace/ArtifactComparison', () => ({
  ArtifactComparison: ({ comparison, publishReview }) => (comparison?.kind === 'publish' ? (
    <div role="dialog" aria-label="Review">
      <span>{`${comparison.before.id} → ${comparison.after.id}`}</span>
      {publishReview.error && <span role="alert">{publishReview.error}</span>}
      {publishReview.onUndo && <button type="button" onClick={publishReview.onUndo}>Undo</button>}
      <button type="button" onClick={publishReview.onKeepDraft}>Keep as draft</button>
      <button type="button" onClick={publishReview.onPublish}>Publish this change</button>
    </div>
  ) : null),
}));
vi.mock('./workspace/TextSelectionComment', () => ({ TextSelectionComment: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div data-testid="modal">{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';
import { ChatTranscriptContext } from '../../lib/chatTranscriptContext';

const artifact = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  projectId: 'proj-1',
  slug: 'launch-brief',
  title: 'Launch brief',
  type: 'html-app',
  ext: '.html',
  path: '/artifacts/launch/index.html',
  canonicalPath: '/artifacts/launch/index.html',
  draftUrl: '/api/v1/artifacts/drafts/proj-1/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa/index.html',
  capabilities: { role: 'owner', canEdit: true },
};

const applied = {
  type: 'done', status: 'applied', summary: 'Made the title blue.',
  revisionId: 'r2', previousRevisionId: 'r1', changed: ['index.html'], check: null,
  editId: 'qe-edit-1', undoable: true, ms: 900,
};
const plays = (...events) => async (_artifact, _body, { onEvent }) => {
  events.forEach((event) => onEvent(event));
};

const bar = () => screen.getByRole('textbox', { name: 'Ask for a change' });
const thread = () => screen.getByRole('region', { name: 'Quick edit' });
function ask(text) {
  fireEvent.change(bar(), { target: { value: text } });
  fireEvent.keyDown(bar(), { key: 'Enter' });
}

// The workspace opens the review the way the real hook does once both
// revisions are read.
function reviewOpens() {
  workspaceMock.reviewPublish.mockImplementation(async (before, after, review = {}) => {
    reviewState.setComparison({ kind: 'publish', before: { id: before }, after: { id: after }, review });
    return true;
  });
}

function renderViewer(props = {}) {
  return render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} conversationId="conv-1" {...props} />);
}

describe('ArtifactViewer: a quick edit to a published artifact', () => {
  beforeEach(() => {
    publishMock.url = 'https://pages.example/launch-brief';
    publishMock.orgMode = false;
    publishMock.phase = 'idle';
    publishMock.error = '';
    publishMock.update.mockReset().mockResolvedValue(true);
    publishMock.refresh.mockClear();
    workspaceMock.load.mockClear();
    workspaceMock.reviewPublish.mockReset();
    reviewOpens();
    workspaceApi.loadArtifactDraftDocument.mockResolvedValue({
      content: '<html><body>Hi</body></html>', contentType: 'text/html', isHtml: true,
    });
    workspaceApi.streamQuickEdit.mockReset().mockImplementation(plays(applied));
    workspaceApi.undoQuickEdit.mockReset();
    workspaceApi.loadArtifactRevisions.mockReset().mockResolvedValue({ revisions: [{ id: 'r1' }] });
  });

  it('opens the comparison of the edit, and publishes nothing on its own', async () => {
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    const review = await screen.findByRole('dialog', { name: 'Review' });
    expect(within(review).getByText('r1 → r2')).toBeInTheDocument();
    expect(workspaceMock.reviewPublish).toHaveBeenCalledWith('r1', 'r2', { replyId: expect.any(String) });
    expect(publishMock.refresh).toHaveBeenCalled();
    expect(publishMock.update).not.toHaveBeenCalled();
  });

  it('publishes the change to the same link, then says Published', async () => {
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    fireEvent.click(await screen.findByRole('button', { name: 'Publish this change' }));

    expect(await screen.findByText('Published')).toBeInTheDocument();
    expect(publishMock.update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Review' })).toBeNull();
  });

  it('keeps the review open with the reason when publishing fails', async () => {
    publishMock.update.mockImplementation(async () => {
      publishMock.error = 'Update failed: offline';
      return false;
    });
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    fireEvent.click(await screen.findByRole('button', { name: 'Publish this change' }));

    const review = screen.getByRole('dialog', { name: 'Review' });
    expect(await within(review).findByRole('alert')).toHaveTextContent('Update failed: offline');
    expect(screen.queryByText('Published')).toBeNull();
  });

  it('keeps the change as a draft: the published page stays as it was', async () => {
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');
    publishMock.refresh.mockClear();

    fireEvent.click(await screen.findByRole('button', { name: 'Keep as draft' }));

    expect(screen.queryByRole('dialog', { name: 'Review' })).toBeNull();
    expect(publishMock.update).not.toHaveBeenCalled();
    // The Share control learns the draft is ahead of the published page.
    expect(publishMock.refresh).toHaveBeenCalled();
  });

  it("undoes the edit through the bar's own undo", async () => {
    workspaceApi.undoQuickEdit.mockResolvedValue({ editId: 'qe-edit-1', revision: { id: 'r3' } });
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    fireEvent.click(await within(await screen.findByRole('dialog', { name: 'Review' })).findByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review' })).toBeNull());
    expect(workspaceApi.undoQuickEdit).toHaveBeenCalledWith(artifact, 'qe-edit-1', { expectedRevisionId: 'r2' });
    expect(await within(thread()).findByText('Undone.')).toBeInTheDocument();
    expect(publishMock.update).not.toHaveBeenCalled();
  });

  it('offers no Undo when the server kept none', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays({ ...applied, undoable: false }));
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    const review = await screen.findByRole('dialog', { name: 'Review' });
    expect(within(review).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('changes nothing for an unpublished artifact', async () => {
    publishMock.url = '';
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    expect(await within(thread()).findByText('Made the title blue.')).toBeInTheDocument();
    await waitFor(() => expect(workspaceMock.load).toHaveBeenCalled());
    expect(workspaceMock.reviewPublish).not.toHaveBeenCalled();
    expect(publishMock.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Review' })).toBeNull();
  });

  it('leaves MindsHub mode alone, where every change is published for you', async () => {
    publishMock.orgMode = true;
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    expect(await within(thread()).findByText('Made the title blue.')).toBeInTheDocument();
    await waitFor(() => expect(workspaceMock.load).toHaveBeenCalled());
    expect(workspaceMock.reviewPublish).not.toHaveBeenCalled();
  });

  describe('when the agent made the change', () => {
    const PROMPT = 'Add Q3 sales\n\n(About the artifact `launch-brief`.)';
    const user = { role: 'user', content: PROMPT };
    function renderInChat(messages) {
      const ui = (msgs) => (
        <ChatTranscriptContext.Provider value={{ conversationId: 'conv-1', messages: msgs }}>
          <ArtifactViewer open artifact={artifact} onClose={vi.fn()} conversationId="conv-1" onAddressWithAgent={vi.fn(async () => true)} />
        </ChatTranscriptContext.Provider>
      );
      const view = render(ui(messages));
      return { ...view, update: (msgs) => view.rerender(ui(msgs)) };
    }

    it('opens the review when the turn the bar handed off lands its change', async () => {
      workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'done', status: 'agent', summary: '' }));
      workspaceApi.loadArtifactRevisions.mockResolvedValue({ revisions: [{ id: 'r9' }, { id: 'r1' }] });
      const view = renderInChat([]);
      await screen.findByTitle('Launch brief');
      ask('Add Q3 sales');
      await within(thread()).findByText('Sent to the chat.');

      view.update([user, { role: '_streaming', content: 'Working', steps: [] }]);
      view.update([user, { role: 'assistant', content: 'Added a Q3 column.' }]);

      const review = await screen.findByRole('dialog', { name: 'Review' });
      expect(within(review).getByText('r1 → r9')).toBeInTheDocument();
      // An agent change has no quick edit undo.
      expect(within(review).queryByRole('button', { name: 'Undo' })).toBeNull();
      expect(publishMock.update).not.toHaveBeenCalled();
    });

    it('opens nothing for a chat turn the bar did not start', async () => {
      workspaceApi.loadArtifactRevisions.mockResolvedValue({ revisions: [{ id: 'r9' }, { id: 'r1' }] });
      const view = renderInChat([]);
      await screen.findByTitle('Launch brief');

      view.update([user, { role: '_streaming', content: 'Working', steps: [] }]);
      view.update([user, { role: 'assistant', content: 'Added a Q3 column.' }]);

      await waitFor(() => expect(workspaceMock.load).toHaveBeenCalled());
      expect(workspaceMock.reviewPublish).not.toHaveBeenCalled();
    });
  });
});
