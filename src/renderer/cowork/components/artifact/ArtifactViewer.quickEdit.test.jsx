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
import userEvent from '@testing-library/user-event';

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
  undoQuickEdit: vi.fn(),
}));
const answerArtifactCheck = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  artifactServeUrl: vi.fn(),
  submitArtifactCheck: vi.fn(),
  // The rule every turn sends picks by (api.js), as it reads with platform UI on.
  sendablePicks: (model, reasoningEffort) => ({
    sendsPicks: true,
    model: model && model !== 'model-router' ? model : null,
    reasoningEffort: reasoningEffort || null,
  }),
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
import { ChatTranscriptContext } from '../../lib/chatTranscriptContext';
import { ModelPickerContext } from '../../lib/modelPickerContext';

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
  revisionId: 'r2', previousRevisionId: 'r1', changed: ['index.html'], check: null,
  editId: 'qe-edit-1', undoable: true, ms: 900,
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
    workspaceApi.undoQuickEdit.mockReset();
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
      model: null,
      reasoningEffort: null,
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

    workspaceApi.streamQuickEdit.mockImplementation(plays({
      ...applied, revisionId: 'r3', previousRevisionId: 'r2', editId: 'qe-edit-2', summary: 'Made it bigger.',
    }));
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

  it('undoes every file of an applied edit through its undo route', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays(applied));
    workspaceApi.undoQuickEdit.mockResolvedValue({
      editId: 'qe-edit-1', restored: ['index.html', 'app.js'], removed: ['chart.js'], revision: { id: 'r4' },
    });
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    fireEvent.click(await within(thread()).findByRole('button', { name: 'Undo' }));

    expect(await within(thread()).findByText('Undone.')).toBeInTheDocument();
    expect(workspaceApi.undoQuickEdit).toHaveBeenCalledWith(artifact, 'qe-edit-1', { expectedRevisionId: 'r2' });
    expect(workspaceMock.load).toHaveBeenCalledTimes(2);
    expect(within(thread()).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('sends a null expected revision when the edit left the tracked source alone', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays({ ...applied, revisionId: null }));
    workspaceApi.undoQuickEdit.mockResolvedValue({ editId: 'qe-edit-1', restored: ['app.js'], removed: [], revision: null });
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Fix the button');

    fireEvent.click(await within(thread()).findByRole('button', { name: 'Undo' }));

    await within(thread()).findByText('Undone.');
    expect(workspaceApi.undoQuickEdit).toHaveBeenCalledWith(artifact, 'qe-edit-1', { expectedRevisionId: null });
  });

  it('offers no Undo when the server kept none', async () => {
    workspaceApi.streamQuickEdit.mockImplementation(plays({ ...applied, editId: null, undoable: false }));
    renderViewer();
    await screen.findByTitle('Launch brief');

    ask('Make the title blue');

    await within(thread()).findByText('Made the title blue.');
    expect(within(thread()).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it.each([
    [{ status: 409, detail: { message: 'x', reason: 'files_changed', paths: ['app.js', 'style.css'] } },
      'app.js, style.css changed again since, so this change can\'t be undone here.', false],
    [{ status: 409, detail: { message: 'x', reason: 'already_undone' } }, 'This change was already undone.', true],
    [{ status: 409, detail: { message: 'x', reason: 'quick_edit_running' } },
      'Another change to this artifact is still running.', false],
    [{ status: 409, detail: { message: 'x', currentRevision: { id: 'r9' } } },
      'This artifact changed since you opened it.', false],
    [{ status: 404, detail: 'gone' }, 'This change can no longer be undone here.', true],
  ])('says why an undo was refused (%#)', async (refusal, text, settled) => {
    workspaceApi.streamQuickEdit.mockImplementation(plays(applied));
    workspaceApi.undoQuickEdit.mockRejectedValue(Object.assign(new Error('refused'), refusal));
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    fireEvent.click(await within(thread()).findByRole('button', { name: 'Undo' }));

    expect(await within(thread()).findByRole('alert')).toHaveTextContent(text);
    // Undo stays for a refusal that may pass later, and goes when nothing is left to undo.
    expect(within(thread()).queryByRole('button', { name: 'Undo' }) === null).toBe(settled);
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

    await within(thread()).findByText('Sent to the chat.');
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

    await within(thread()).findByText('Sent to the chat.');
    expect(onAddressWithAgent).toHaveBeenCalledWith({
      artifact,
      prompt: 'Add last quarter sales from the warehouse\n\n(About the artifact `launch-brief`.)',
      conversationId: 'conv-1',
    });
    fireEvent.click(within(thread()).getByRole('button', { name: 'Open in chat' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('targets the chat that made the artifact when the viewer has none', async () => {
    const onAddressWithAgent = vi.fn(async () => true);
    const resolveRepairConversation = vi.fn(async () => 'origin-chat');
    workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'done', status: 'escalate', summary: '' }));
    renderViewer({ conversationId: null, onAddressWithAgent, resolveRepairConversation });
    await screen.findByTitle('Launch brief');

    ask('Pull the latest numbers');

    await within(thread()).findByText('Sent to the chat.');
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

  describe('without a decisions model (quickEditDirect false)', () => {
    beforeEach(() => {
      workspaceMock.capabilities = { role: 'owner', canEdit: true, canQuickEdit: true, quickEditDirect: false };
    });

    it('invites questions too, and sends every message straight to the chat', async () => {
      const onAddressWithAgent = vi.fn(async () => true);
      renderViewer({ onAddressWithAgent });
      await screen.findByTitle('Launch brief');
      expect(bar()).toHaveAttribute('placeholder', 'Ask about or change this artifact…');

      ask('Why is revenue down?');

      await within(thread()).findByText('Sent to the chat.');
      expect(workspaceApi.streamQuickEdit).not.toHaveBeenCalled();
      expect(onAddressWithAgent).toHaveBeenCalledWith({
        artifact,
        prompt: 'Why is revenue down?\n\n(About the artifact `launch-brief`.)',
        conversationId: 'conv-1',
      });
    });
  });

  it('takes a route the server sent with its reason', async () => {
    const onAddressWithAgent = vi.fn(async () => true);
    workspaceApi.streamQuickEdit.mockImplementation(plays(
      { type: 'route', route: 'agent', confidence: 1, ms: 0, reason: 'no_decisions_model' },
      { type: 'done', status: 'agent', summary: '', editId: null, undoable: false },
    ));
    renderViewer({ onAddressWithAgent });
    await screen.findByTitle('Launch brief');

    ask('Make the title blue');

    await within(thread()).findByText('Sent to the chat.');
    expect(onAddressWithAgent).toHaveBeenCalledTimes(1);
  });

  it('turns a 409 into words', async () => {
    workspaceApi.streamQuickEdit.mockRejectedValueOnce(Object.assign(new Error('running'), {
      status: 409, detail: { message: 'running', reason: 'quick_edit_running' },
    }));
    renderViewer();
    await screen.findByTitle('Launch brief');
    ask('Make the title blue');

    expect(await within(thread()).findByRole('alert'))
      .toHaveTextContent('Another change to this artifact is still running.');

    workspaceApi.streamQuickEdit.mockRejectedValueOnce(Object.assign(new Error('pending'), {
      status: 409, detail: { message: 'pending', reason: 'repair_pending', repairId: 'rp1' },
    }));
    ask('Make the title blue');
    await within(thread()).findByText(/An agent suggestion for this artifact is waiting/);

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

  describe('model picker', () => {
    const catalog = {
      models: [
        { id: 'claude-sonnet', name: 'Claude Sonnet' },
        { id: 'fast-model', name: 'Fast model' },
      ],
      modelMeta: {
        modelProviders: {},
        modelEfforts: {
          'claude-sonnet': { efforts: ['low', 'medium', 'high'], default: 'high' },
        },
      },
    };
    const renderWithCatalog = (props = {}) => render(
      <ModelPickerContext.Provider value={catalog}>
        <ArtifactViewer open artifact={artifact} onClose={vi.fn()} conversationId="conv-1" {...props} />
      </ModelPickerContext.Provider>,
    );
    const modelPill = () => screen.getByRole('combobox', { name: 'Choose model' });

    it('shows the composer picker beside send, on Model Router with no effort pill', async () => {
      renderWithCatalog();
      await screen.findByTitle('Launch brief');

      expect(modelPill()).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull();
    });

    it('defaults to medium effort on a model that offers effort, and sends model and effort', async () => {
      workspaceApi.streamQuickEdit.mockImplementation(plays(applied));
      renderWithCatalog();
      await screen.findByTitle('Launch brief');

      const user = userEvent.setup();
      await user.click(modelPill());
      await user.click(await screen.findByRole('option', { name: /Claude Sonnet/ }));

      expect(await screen.findByRole('combobox', { name: 'Reasoning effort' })).toHaveTextContent(/Medium/);
      ask('Make the title blue');
      await within(thread()).findByText('Made the title blue.');
      expect(workspaceApi.streamQuickEdit.mock.calls[0][1]).toMatchObject({
        model: 'claude-sonnet',
        reasoningEffort: 'medium',
      });
    });

    it('shows no effort pill for a model without effort levels, and sends none', async () => {
      workspaceApi.streamQuickEdit.mockImplementation(plays(applied));
      renderWithCatalog();
      await screen.findByTitle('Launch brief');

      const user = userEvent.setup();
      await user.click(modelPill());
      await user.click(await screen.findByRole('option', { name: /Fast model/ }));

      expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull();
      ask('Make the title blue');
      await within(thread()).findByText('Made the title blue.');
      expect(workspaceApi.streamQuickEdit.mock.calls[0][1]).toMatchObject({ model: 'fast-model', reasoningEffort: null });
    });

    it('hides the picker when every message goes to the chat', async () => {
      workspaceMock.capabilities = { role: 'owner', canEdit: true, canQuickEdit: true, quickEditDirect: false };
      renderWithCatalog();
      await screen.findByTitle('Launch brief');

      expect(bar()).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Choose model' })).toBeNull();
    });
  });

  describe('Undo states', () => {
    it('shows the undo in progress, then undone', async () => {
      let finish;
      workspaceApi.streamQuickEdit.mockImplementation(plays(applied));
      workspaceApi.undoQuickEdit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      renderViewer();
      await screen.findByTitle('Launch brief');
      ask('Make the title blue');

      fireEvent.click(await within(thread()).findByRole('button', { name: 'Undo' }));

      const busy = await within(thread()).findByRole('button', { name: 'Undoing…' });
      expect(busy).toBeDisabled();
      expect(busy).toHaveAttribute('aria-busy', 'true');
      await act(async () => { finish({ editId: 'qe-edit-1', restored: [], removed: [], revision: null }); });
      expect(within(thread()).getByRole('status')).toHaveTextContent('Undone.');
      expect(within(thread()).queryByRole('button', { name: /Undo/ })).toBeNull();
    });
  });

  describe('mirroring the chat reply', () => {
    const PROMPT = 'Add last quarter sales\n\n(About the artifact `launch-brief`.)';
    function renderInChat(messages, props = {}) {
      const ui = (msgs) => (
        <ChatTranscriptContext.Provider value={{ conversationId: 'conv-1', messages: msgs }}>
          <ArtifactViewer open artifact={artifact} onClose={props.onClose || vi.fn()} conversationId="conv-1" {...props} />
        </ChatTranscriptContext.Provider>
      );
      const view = render(ui(messages));
      return { ...view, update: (msgs) => view.rerender(ui(msgs)) };
    }

    it('streams the agent reply into the bar from the chat state, with Open in chat', async () => {
      const onClose = vi.fn();
      const onAddressWithAgent = vi.fn(async () => true);
      workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'done', status: 'escalate', summary: '' }));
      // The same prompt asked earlier in this chat: the bar must read the reply to its own.
      const earlier = [
        { role: 'user', content: PROMPT },
        { role: 'assistant', content: 'An older answer.' },
      ];
      const view = renderInChat(earlier, { onAddressWithAgent, onClose });
      await screen.findByTitle('Launch brief');

      ask('Add last quarter sales');
      await within(thread()).findByText('Sent to the chat.');

      view.update([...earlier, { role: 'user', content: PROMPT }, { role: '_streaming', content: 'Pulling the sales', steps: [] }]);
      expect(await within(thread()).findByText(/Pulling the sales/)).toBeInTheDocument();
      expect(within(thread()).queryByText('An older answer.')).toBeNull();

      view.update([...earlier, { role: 'user', content: PROMPT }, { role: 'assistant', content: 'Added a Q3 sales column.' }]);
      expect(await within(thread()).findByText('Added a Q3 sales column.')).toBeInTheDocument();
      fireEvent.click(within(thread()).getByRole('button', { name: 'Open in chat' }));
      expect(onClose).toHaveBeenCalled();
    });

    it('says the chat needs an answer while the turn asks a question', async () => {
      workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'done', status: 'agent', summary: '' }));
      const view = renderInChat([], { onAddressWithAgent: vi.fn(async () => true) });
      await screen.findByTitle('Launch brief');
      ask('Add last quarter sales');
      await within(thread()).findByText('Sent to the chat.');

      view.update([
        { role: 'user', content: PROMPT },
        { role: '_streaming', content: '', steps: [{ badge: 'AskUser', status: 'in_progress', data: { answer: null } }] },
      ]);

      expect(await within(thread()).findByText('Needs your answer in the chat')).toBeInTheDocument();
      expect(within(thread()).getByRole('button', { name: 'Open in chat' })).toBeInTheDocument();
    });

    it("ignores another chat's messages", async () => {
      workspaceApi.streamQuickEdit.mockImplementation(plays({ type: 'done', status: 'agent', summary: '' }));
      render(
        <ChatTranscriptContext.Provider value={{ conversationId: 'other', messages: [{ role: 'user', content: PROMPT }, { role: 'assistant', content: 'Not this one.' }] }}>
          <ArtifactViewer open artifact={artifact} onClose={vi.fn()} conversationId="conv-1" onAddressWithAgent={vi.fn(async () => true)} />
        </ChatTranscriptContext.Provider>,
      );
      await screen.findByTitle('Launch brief');
      ask('Add last quarter sales');

      await within(thread()).findByText('Sent to the chat.');
      expect(within(thread()).queryByText('Not this one.')).toBeNull();
    });
  });
});
