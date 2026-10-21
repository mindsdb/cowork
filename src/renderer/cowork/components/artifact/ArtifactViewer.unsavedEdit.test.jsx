/*
 * Closing the viewer resets the workspace, and the reset drops any draft that
 * was never saved. With unsaved Edit text, the Close button and Esc ask first:
 * "Keep editing" leaves the viewer open with the text, and "Discard changes"
 * closes it and drops the text. With nothing unsaved, both close at once.
 *
 * The workspace hook, the modal and the confirm dialog are the real ones, so
 * the draft lives where the app keeps it and Esc goes through the dialog's own
 * dismissal.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  artifactServeUrl: () => '',
  mountArtifactPreview: vi.fn(),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn() }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  canUseArtifactWorkspace: () => true,
  loadArtifactSource: vi.fn(),
  saveArtifactSource: vi.fn(),
  loadArtifactRevisions: vi.fn(async () => ({ revisions: [] })),
  loadArtifactDraftText: vi.fn(),
  loadArtifactDraftDocument: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    isWeb: false,
    isLocalApiOrigin: () => true,
    getApiOrigin: () => 'http://127.0.0.1:26866',
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));
vi.mock('./publish/usePublish', () => ({
  usePublish: () => ({ publishedUrl: '', accessMode: 'public', artifactKey: '', busy: false }),
}));
vi.mock('./comments', () => ({
  useArtifactComments: () => ({
    threads: [], viewer: null, unreadCount: 0,
    create: vi.fn(), reply: vi.fn(), setStatus: vi.fn(),
    editThread: vi.fn(), deleteThread: vi.fn(), editReply: vi.fn(),
    deleteReply: vi.fn(), markRead: vi.fn(),
  }),
  useArtifactCommentLayer: () => ({ exitMode: vi.fn() }),
}));
vi.mock('./ArtifactViewerHeader', () => ({
  ArtifactViewerHeader: ({ workspace, onClose }) => (
    <div>
      <button type="button" onClick={() => workspace.setMode('edit')}>Edit</button>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  ),
}));
vi.mock('./ArtifactViewerBody', async () => {
  const { ArtifactSourceEditor } = await vi.importActual('./workspace/ArtifactSourceEditor');
  return {
    ArtifactViewerBody: ({ workspace }) => (workspace.mode === 'edit' && workspace.source ? (
      <ArtifactSourceEditor
        source={workspace.source}
        value={workspace.draft}
        onChange={workspace.setDraft}
        onSave={(content) => workspace.save('Edited artifact', content)}
      />
    ) : null),
  };
});

import { ArtifactViewer } from './ArtifactViewer';
import { previewArtifact } from '../../api';
import { loadArtifactSource, saveArtifactSource } from '../../lib/artifactWorkspaceApi';

const SAVED_TEXT = 'Saved line';
const TYPED_TEXT = ' and an unsaved edit';
const EDITED_TEXT = `${SAVED_TEXT}${TYPED_TEXT}`;

const ARTIFACT = {
  id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
  title: 'Notes',
  type: 'document',
  ext: '.txt',
  path: '/artifacts/notes/notes.txt',
  canonicalPath: '/artifacts/notes/notes.txt',
};

const REVISION = { id: 'rev-1', number: 1 };

function savedSource() {
  return {
    artifactId: ARTIFACT.id,
    path: 'notes.txt',
    content: SAVED_TEXT,
    revision: REVISION,
    revisions: [],
    capabilities: { role: 'owner', canPreview: true, canComment: true, canEdit: true },
  };
}

/* Mirrors how hosts wire the viewer: `open` is their state, and onClose clears it. */
function Host() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Reopen</button>
      <ArtifactViewer open={open} artifact={ARTIFACT} onClose={() => setOpen(false)} />
    </>
  );
}

let user;

const editor = () => screen.queryByLabelText('Edit notes.txt');
const discardPrompt = () => screen.queryByRole('dialog', { name: 'Discard changes?' });

async function openEditor() {
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  return screen.findByLabelText('Edit notes.txt');
}

/* Leaves focus in the editor, where a person's Esc starts. */
async function typeUnsavedText() {
  await user.type(await openEditor(), TYPED_TEXT);
  expect(editor()).toHaveValue(EDITED_TEXT);
  expect(editor()).toHaveFocus();
}

const clickClose = () => user.click(screen.getByRole('button', { name: 'Close' }));
const pressEscape = () => user.keyboard('{Escape}');

describe('ArtifactViewer with unsaved Edit text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
    previewArtifact.mockResolvedValue({ content: SAVED_TEXT, truncated: false });
    loadArtifactSource.mockImplementation(async () => savedSource());
    saveArtifactSource.mockImplementation(async (_artifact, { content }) => ({
      ...savedSource(),
      content,
      revision: { id: 'rev-2', number: 2 },
    }));
  });

  describe.each([
    ['the Close button', clickClose],
    ['Esc', pressEscape],
  ])('%s', (_name, close) => {
    it('asks before closing', async () => {
      render(<Host />);
      await typeUnsavedText();

      await close();

      expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
      expect(editor()).toHaveValue(EDITED_TEXT);
    });

    it('keeps the viewer open with the text when the prompt is cancelled', async () => {
      render(<Host />);
      await typeUnsavedText();
      await close();

      await user.click(await screen.findByRole('button', { name: 'Keep editing' }));

      await waitFor(() => expect(discardPrompt()).toBeNull());
      expect(editor()).toHaveValue(EDITED_TEXT);
    });

    it('closes and discards the text when the prompt is confirmed', async () => {
      render(<Host />);
      await typeUnsavedText();
      await close();

      await user.click(await screen.findByRole('button', { name: 'Discard changes' }));

      await waitFor(() => expect(editor()).toBeNull());
      expect(discardPrompt()).toBeNull();
      expect(saveArtifactSource).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Reopen' }));
      expect(await openEditor()).toHaveValue(SAVED_TEXT);
    });

    it('closes at once when nothing is unsaved', async () => {
      render(<Host />);
      await openEditor();

      await close();

      await waitFor(() => expect(editor()).toBeNull());
      expect(discardPrompt()).toBeNull();
    });

    it('closes at once after the text is saved', async () => {
      render(<Host />);
      await typeUnsavedText();
      await user.click(screen.getByRole('button', { name: /Save/ }));
      await screen.findByText('Saved');

      await close();

      await waitFor(() => expect(editor()).toBeNull());
      expect(discardPrompt()).toBeNull();
      expect(saveArtifactSource).toHaveBeenCalledWith(
        ARTIFACT,
        expect.objectContaining({ content: EDITED_TEXT, expectedRevisionId: REVISION.id }),
      );
    });
  });

  it('asks before a click outside the viewer closes it', async () => {
    render(<Host />);
    await typeUnsavedText();

    /* The viewport that centers the viewer: a click on it lands outside the viewer. */
    await user.click(screen.getByRole('dialog').parentElement);

    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    expect(editor()).toHaveValue(EDITED_TEXT);
  });

  it('keeps the text when Esc dismisses the prompt itself', async () => {
    render(<Host />);
    await typeUnsavedText();
    await pressEscape();
    await screen.findByRole('dialog', { name: 'Discard changes?' });

    await pressEscape();

    await waitFor(() => expect(discardPrompt()).toBeNull());
    expect(editor()).toHaveValue(EDITED_TEXT);
  });

  it('does not bring back a prompt the host closed the viewer under', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<ArtifactViewer open artifact={ARTIFACT} onClose={onClose} />);
    await typeUnsavedText();
    await clickClose();
    await screen.findByRole('dialog', { name: 'Discard changes?' });

    rerender(<ArtifactViewer open={false} artifact={ARTIFACT} onClose={onClose} />);
    rerender(<ArtifactViewer open artifact={ARTIFACT} onClose={onClose} />);

    expect(await openEditor()).toHaveValue(SAVED_TEXT);
    expect(discardPrompt()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
