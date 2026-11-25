/*
 * The viewer on Live Artifacts hands a message to the agent without leaving
 * the page (ENG-4560): it stays open while the turn runs in the artifact's
 * chat, and "Open in chat" reaches the chat through the page.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  host: {
    isWeb: true, isElectron: false, isMac: () => false, openExternal: vi.fn(async () => {}),
    getApiOrigin: () => 'https://cowork.example',
  },
}));

vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn(),
  artifactServeUrl: () => '',
  openArtifactFile: vi.fn(),
  authFetch: vi.fn(),
}));
vi.mock('../../platform/host', () => ({ host: mocks.host }));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: vi.fn() }) }));
// Stands in for the viewer's chat bar handing a message over.
vi.mock('../components/artifact', () => ({
  ArtifactViewer: ({ open, artifact, onAddressWithAgent, onOpenConversation }) => (open ? (
    <div data-testid="artifact-viewer">
      {artifact.title}
      <button
        type="button"
        onClick={() => onAddressWithAgent({ artifact, prompt: 'fix it', conversationId: 'chat-1', inBackground: true })}
      >
        hand off
      </button>
      <button type="button" onClick={() => onOpenConversation('chat-1')}>open in chat</button>
    </div>
  ) : null),
}));

import ArtifactsView from './ArtifactsView';

const ID = '66666666666666666666666666666666';
const card = {
  id: ID,
  path: '/proj/.anton/artifacts/brief/index.html',
  title: 'Launch brief',
  type: 'html-app',
  ext: '.html',
  mtime: 2000,
  draftUrl: `/api/v1/artifacts/drafts/proj-1/${ID}/index.html`,
  serveUrl: '',
  publishedUrl: '',
  capabilities: { role: 'owner', canEdit: true },
};

describe('handing a message to the agent from the viewer on Live Artifacts', () => {
  it('keeps the viewer open, and opens the chat only when asked', async () => {
    const onAddressWithAgent = vi.fn(async () => true);
    const onOpenConversation = vi.fn();
    render(
      <ArtifactsView
        artifacts={[card]}
        onAddressWithAgent={onAddressWithAgent}
        onOpenConversation={onOpenConversation}
      />,
    );
    fireEvent.click(screen.getByText('Launch brief'));
    const viewer = await screen.findByTestId('artifact-viewer');

    fireEvent.click(screen.getByRole('button', { name: 'hand off' }));
    await vi.waitFor(() => expect(onAddressWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'chat-1', inBackground: true }),
    ));
    expect(viewer).toBeInTheDocument();
    expect(onOpenConversation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'open in chat' }));
    expect(onOpenConversation).toHaveBeenCalledWith('chat-1');
  });
});
