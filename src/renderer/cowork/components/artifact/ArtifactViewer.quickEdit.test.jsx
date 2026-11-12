/*
 * The viewer's chat bar (ENG-4227). With quick edits on, Preview carries a bar
 * at the bottom; a request streams from POST .../quick-edits and ends one of
 * five ways (applied, noop, failed, agent, escalate). The stream itself is
 * mocked at streamQuickEdit, whose SSE parsing is covered in
 * artifactWorkspaceApi.test.js; the check answer is covered in
 * artifactCheck.test.js.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
  discard: vi.fn(),
  compareRevision: vi.fn(),
  refreshRepair: vi.fn(),
  addressWithAgent: vi.fn(),
  cancelRepair: vi.fn(),
}));

const workspaceApi = vi.hoisted(() => ({
  loadArtifactDraftDocument: vi.fn(),
  loadArtifactDraftText: vi.fn(),
  streamQuickEdit: vi.fn(),
  restoreArtifactRevision: vi.fn(),
}));
const answerArtifactCheck = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  artifactServeUrl: vi.fn(),
  submitArtifactCheck: vi.fn(),
}));
vi.mock('../../lib/artifactCheck', async (importOriginal) => ({
  ...(await importOriginal()),
  answerArtifactCheck,
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
    publishedUrl: '',
    accessMode: 'public',
    artifactKey: 'artifact/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    busy: false,
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
vi.mock('./workspace/useArtifactWorkspace', () => ({
  useArtifactWorkspace: () => workspaceMock,
}));
vi.mock('./workspace/ArtifactSourceEditor', () => ({ ArtifactSourceEditor: () => null }));
vi.mock('./workspace/ArtifactComparison', () => ({ ArtifactComparison: () => null }));
vi.mock('./workspace/TextSelectionComment', () => ({ TextSelectionComment: () => null }));
vi.mock('./workspace/ArtifactRevisionBar', () => ({ ArtifactRevisionBar: () => null }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }) => <div>{children}</div> }));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));

import { ArtifactViewer } from './ArtifactViewer';

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

const bar = () => screen.queryByRole('textbox', { name: 'Ask for a change' });
const thread = () => screen.getByRole('region', { name: 'Quick edit' });

function ask(text) {
  fireEvent.change(bar(), { target: { value: text } });
  fireEvent.keyDown(bar(), { key: 'Enter' });
}

// A stream that plays the given events and ends.
const plays = (...events) => async (_artifact, _body, { onEvent }) => {
  events.forEach((event) => onEvent(event));
};

const applied = {
  type: 'done', status: 'applied', summary: 'Made the title blue.',
  revisionId: 'r2', previousRevisionId: 'r1', changed: ['index.html'], check: null, ms: 900,
};

function renderViewer(props = {}) {
  return render(
    <ArtifactViewer open artifact={artifact} onClose={vi.fn()} conversationId="conv-1" {...props} />,
  );
}

describe('ArtifactViewer quick edit bar', () => {
  beforeEach(() => {
    workspaceMock.mode = 'preview';
    workspaceMock.dirty = false;
    workspaceMock.capabilities = { role: 'owner', canEdit: true, canQuickEdit: true };
    workspaceMock.load.mockClear();
    workspaceApi.loadArtifactDraftDocument.mockResolvedValue({
      content: '<html><body>Hi</body></html>', contentType: 'text/html', isHtml: true,
    });
    workspaceApi.streamQuickEdit.mockReset();
    workspaceApi.restoreArtifactRevision.mockReset();
    answerArtifactCheck.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('opens on Preview with the bar, and calls the code editor Source', async () => {
    renderViewer();
    await screen.findByTitle('Launch brief');

    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^Source/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Edit/ })).toBeNull();
    expect(bar()).toHaveAttribute('placeholder', 'Ask for a change…');
  });

  it('shows no bar without canQuickEdit, as before', async () => {
    workspaceMock.capabilities = { role: 'owner', canEdit: true };
    renderViewer();
    await screen.findByTitle('Launch brief');

    expect(bar()).toBeNull();
  });

  it('shows no bar to someone who cannot edit', async () => {
    workspaceMock.capabilities = { role: 'reviewer', canEdit: false, canQuickEdit: true };
    renderViewer();
    await screen.findByTitle('Launch brief');

    expect(bar()).toBeNull();
  });

  it('leaves Source to the code editor', async () => {
    workspaceMock.mode = 'edit';
    renderViewer();

    expect(bar()).toBeNull();
  });

  it('applies an edit: posts the request, reloads, and shows the summary with Undo', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays(
      { type: 'route', route: 'edit', confidence: 0.94, ms: 80 },
      { type: 'progress', stage: 'writing' },
      applied,
    ));
    renderViewer();
    await screen.findByTitle('Launch brief');

    ask('Make the title blue');

    expect(await within(thread()).findByText('Made the title blue.')).toBeInTheDocument();
    expect(within(thread()).getByText('Make the title blue')).toBeInTheDocument();
    const [target, body, opts] = workspaceApi.streamQuickEdit.mock.calls[0];
    expect(target).toBe(artifact);
    expect(body).toEqual({
      message: 'Make the title blue',
      history: [],
      expectedRevisionId: 'r1',
      conversationId: 'conv-1',
      forceRoute: null,
    });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(workspaceMock.load).toHaveBeenCalledTimes(1);
    expect(within(thread()).getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  it('sends the earlier messages as history and the new head as the expected revision', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays(applied));
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');
    await within(thread()).findByText('Made the title blue.');

    workspaceApi.streamQuickEdit.mockImplementation(plays({ ...applied, revisionId: 'r3', previousRevisionId: 'r2', summary: 'Made it bigger.' }));
    ask('Now make it bigger');
    await within(thread()).findByText('Made it bigger.');

    const body = workspaceApi.streamQuickEdit.mock.calls[1][1];
    expect(body.history).toEqual([
      { role: 'user', text: 'Make the title blue' },
      { role: 'assistant', text: 'Made the title blue.' },
    ]);
    expect(body.expectedRevisionId).toBe('r2');
    // Undo is for the newest edit only.
    expect(within(thread()).getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
  });

  it('undoes an applied edit through the revision restore', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays(applied));
    workspaceApi.restoreArtifactRevision.mockResolvedValue({ revision: { id: 'r4' }, content: '' });
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    fireEvent.click(await within(thread()).findByRole('button', { name: 'Undo' }));

    expect(await within(thread()).findByText('Undone.')).toBeInTheDocument();
    expect(workspaceApi.restoreArtifactRevision).toHaveBeenCalledWith(artifact, 'r1', 'r2');
    expect(workspaceMock.load).toHaveBeenCalledTimes(2);
    expect(within(thread()).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('says nothing changed on noop', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'done', status: 'noop', summary: '' }));
    renderViewer();
    await screen.findByTitle('Launch brief');

    ask('Make the title blue');

    expect(await within(thread()).findByText('Nothing changed.')).toBeInTheDocument();
    expect(workspaceMock.load).not.toHaveBeenCalled();
  });

  it('offers the agent after a failed edit, and asks again with forceRoute agent', async () => {
    const onAddressWithAgent = vi.fn(async () => true);
    workspaceApi.streamQuickEdit.mockImplementation(plays(
      { type: 'done', status: 'failed', summary: 'The chart kept breaking the page.' },
    ));
    renderViewer({ onAddressWithAgent });
    await screen.findByTitle('Launch brief');
    ask('Add a chart');

    await within(thread()).findByText(/The chart kept breaking the page\./);
    workspaceApi.streamQuickEdit.mockImplementation(plays(
      { type: 'route', route: 'agent', confidence: 1, ms: 0 },
      { type: 'done', status: 'agent', summary: '' },
    ));
    fireEvent.click(within(thread()).getByRole('button', { name: 'Ask the agent instead' }));

    await within(thread()).findByText(/Continued in chat\./);
    expect(workspaceApi.streamQuickEdit.mock.calls[1][1]).toMatchObject({ message: 'Add a chart', forceRoute: 'agent' });
    expect(onAddressWithAgent).toHaveBeenCalledTimes(1);
  });

  it.each(['agent', 'escalate'])('continues in the artifact chat on %s', async (status) => {
    const onAddressWithAgent = vi.fn(async () => true);
    const onClose = vi.fn();
    workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'done', status, summary: '' }));
    renderViewer({ onAddressWithAgent, onClose });
    await screen.findByTitle('Launch brief');

    ask('Add last quarter sales from the warehouse');

    await within(thread()).findByText(/Continued in chat\./);
    expect(onAddressWithAgent).toHaveBeenCalledWith({
      artifact,
      prompt: 'Add last quarter sales from the warehouse\n\n(About the artifact `launch-brief`.)',
      conversationId: 'conv-1',
    });
    fireEvent.click(within(thread()).getByRole('button', { name: 'Open chat' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('targets the chat that made the artifact when the viewer has none', async () => {
    const onAddressWithAgent = vi.fn(async () => true);
    const resolveRepairConversation = vi.fn(async () => 'origin-chat');
    workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'done', status: 'escalate', summary: '' }));
    renderViewer({ conversationId: null, onAddressWithAgent, resolveRepairConversation });
    await screen.findByTitle('Launch brief');

    ask('Pull the latest numbers');

    await within(thread()).findByText(/Continued in chat\./);
    expect(workspaceApi.streamQuickEdit.mock.calls[0][1].conversationId).toBe('origin-chat');
    expect(onAddressWithAgent.mock.calls[0][0].conversationId).toBe('origin-chat');
  });

  it('says so when the chat turn could not start', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'done', status: 'agent', summary: '' }));
    renderViewer({ onAddressWithAgent: vi.fn(async () => false) });
    await screen.findByTitle('Launch brief');

    ask('Pull the latest numbers');

    expect(await within(thread()).findByRole('alert')).toHaveTextContent("Couldn't continue in the chat.");
  });

  it('answers a check_request from the open preview', async () => {
    const request = { type: 'check_request', check_id: 'acheck:1', artifact_slug: 'launch-brief', timeout_s: 20 };
    workspaceApi.streamQuickEdit.mockImplementation(plays(request, applied));
    renderViewer();
    await screen.findByTitle('Launch brief');

    ask('Make the title blue');

    await within(thread()).findByText('Made the title blue.');
    expect(answerArtifactCheck).toHaveBeenCalledWith(request);
  });

  it('turns a 409 into words', async () => {
    workspaceApi.streamQuickEdit.mockRejectedValueOnce(Object.assign(new Error('RepairAlreadyPending'), {
      status: 409, detail: 'RepairAlreadyPending',
    }));
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    expect(await within(thread()).findByRole('alert'))
      .toHaveTextContent('Another change to this artifact is still running.');

    workspaceApi.streamQuickEdit.mockRejectedValueOnce(Object.assign(new Error('stale'), {
      status: 409, detail: { currentRevision: { id: 'r9' } },
    }));
    ask('Make the title blue');

    await within(thread()).findByText(/This artifact changed since you opened it\./);
    expect(workspaceMock.load).toHaveBeenCalled();
  });

  it('shows the error event the server sends', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'error', message: 'The editor is not available.' }));
    renderViewer();
    await screen.findByTitle('Launch brief');

    ask('Make the title blue');

    expect(await within(thread()).findByRole('alert')).toHaveTextContent('The editor is not available.');
  });

  it('disables send while an edit runs, and aborts it when the viewer closes', async () => {
    let signal;
    workspaceApi.streamQuickEdit.mockImplementation((_a, _b, opts) => {
      signal = opts.signal;
      return new Promise((resolve) => { opts.signal.addEventListener('abort', resolve); });
    });
    const view = renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');
    await waitFor(() => expect(signal).toBeDefined());

    fireEvent.change(bar(), { target: { value: 'And bigger' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(bar(), { key: 'Enter' });
    expect(workspaceApi.streamQuickEdit).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(<ArtifactViewer open={false} artifact={artifact} onClose={vi.fn()} conversationId="conv-1" />);
    });

    expect(signal.aborted).toBe(true);
  });

  it('aborts a running edit when the viewer unmounts', async () => {
    let signal;
    workspaceApi.streamQuickEdit.mockImplementation((_a, _b, opts) => {
      signal = opts.signal;
      return new Promise(() => {});
    });
    const view = renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');
    await waitFor(() => expect(signal).toBeDefined());

    view.unmount();

    expect(signal.aborted).toBe(true);
  });

  it('holds the bar while Source has unsaved text', async () => {
    workspaceMock.dirty = true;
    renderViewer();
    await screen.findByTitle('Launch brief');

    expect(bar()).toBeDisabled();
    expect(screen.getByText('Save or discard your Source changes to ask for a change here.')).toBeInTheDocument();
  });
});
