// Docs in the library open in the app's doc editor; outside the app, as their page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({ openArtifactFile: vi.fn() }));
vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn(),
  artifactServeUrl: vi.fn((a) => (a?.serveUrl ? `http://api.test${a.serveUrl}` : '')),
  openArtifactFile: (...a) => api.openArtifactFile(...a),
}));
const hostMock = vi.hoisted(() => ({ isWeb: false, isMac: () => true, isElectron: true, openExternal: vi.fn() }));
vi.mock('../../platform/host', () => ({ host: hostMock }));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: vi.fn() }) }));
// The doc editor itself is tested on its own; here it only has to be the thing that opens.
// It draws the real rail's actions (Open chat, ENG-4599).
vi.mock('../components/doc/DocPane', async () => {
  const { ViewerModeRail } = await import('../components/artifact/ViewerModeRail');
  return {
    default: ({ artifactId, title, onAskAgent, railActions = [] }) => (
      <div role="region" aria-label={`Doc editor: ${title}`} data-artifact={artifactId}>
        <ViewerModeRail label="Viewer panels" tabs={[]} actions={railActions} />
        {onAskAgent && (
          <button type="button" onClick={() => onAskAgent({ blockIds: ['b_1'], quote: 'Hire  two\nengineers', request: 'Make it three', tabId: 't_1', mode: 'edit' })}>
            Edit with agent
          </button>
        )}
      </div>
    ),
  };
});

import ArtifactsView from './ArtifactsView';
import { OriginChatContext } from '../lib/originChat';

const doc = {
  id: 'a1', title: 'Q4 Hiring Plan Tracker', format: 'doc', type: 'document', mtime: 1, projectId: 'p1',
  path: '/p/.anton/artifacts/q4-hiring-plan-tracker-36623b3b/doc.cdoc.json', primary: 'doc.cdoc.json',
  htmlPath: '/p/.anton/artifacts/q4-hiring-plan-tracker-36623b3b/doc.html',
};

beforeEach(() => { api.openArtifactFile.mockReset(); localStorage.clear(); });

describe('a doc in the library', () => {
  it('opens in the doc editor, not as a file in another app', async () => {
    // Found on the packaged app: clicking a doc's card handed doc.cdoc.json to
    // the OS, which opened it in Xcode (the .json app on that Mac).
    const user = userEvent.setup();
    render(<ArtifactsView artifacts={[doc]} agentLabel="Anton" />);
    await user.click(screen.getByRole('button', { name: /Q4 Hiring Plan Tracker/ }));
    expect(await screen.findByRole('region', { name: 'Doc editor: Q4 Hiring Plan Tracker' })).toBeInTheDocument();
    expect(api.openArtifactFile).not.toHaveBeenCalled();
  });

  it('opens outside the app from its ↗ button, as its rendered page', async () => {
    // A card's ↗ opens outside the app, as the list's does.
    const user = userEvent.setup();
    render(<ArtifactsView artifacts={[doc]} agentLabel="Anton" />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(api.openArtifactFile).toHaveBeenCalledWith(expect.objectContaining({ path: doc.htmlPath, file_path: doc.htmlPath }));
    expect(screen.queryByRole('region', { name: /Doc editor/ })).toBeNull();
  });
});

describe('a doc opened outside the app from the library list', () => {
  it('opens as its rendered page, not its JSON', async () => {
    const user = userEvent.setup();
    localStorage.setItem('anton:artifacts-view', 'list');
    render(<ArtifactsView artifacts={[doc]} agentLabel="Anton" />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(api.openArtifactFile).toHaveBeenCalledWith(expect.objectContaining({ path: doc.htmlPath, file_path: doc.htmlPath }));
    expect(screen.queryByRole('region', { name: /Doc editor/ })).toBeNull();
  });
});

describe('Edit with agent from a doc in the library', () => {
  it('hands the app the request as the doc beside a chat sends it: the passage, and the doc it is in', async () => {
    const user = userEvent.setup();
    const onEditDocWithAgent = vi.fn();
    const onAddressWithAgent = vi.fn();
    render(<ArtifactsView artifacts={[{ ...doc, originConversationId: 'conv-7' }]} agentLabel="Anton"
      onEditDocWithAgent={onEditDocWithAgent} onAddressWithAgent={onAddressWithAgent} />);
    await user.click(screen.getByRole('button', { name: /Q4 Hiring Plan Tracker/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit with agent' }));
    expect(onEditDocWithAgent).toHaveBeenCalledWith({
      artifact: expect.objectContaining({ id: 'a1', originConversationId: 'conv-7' }),
      message: '> Hire two engineers\n\nMake it three',
      docRequest: {
        artifactId: 'a1', projectId: 'p1', tab: 't_1', selection: { blockIds: ['b_1'], quote: 'Hire  two\nengineers' }, request: 'Make it three',
      },
      attachments: [],
    });
    // Not as a comment's repair, whose path started a new chat under the doc's.
    expect(onAddressWithAgent).not.toHaveBeenCalled();
    // The library has no chat beside the doc: it closes for the chat to take over.
    expect(screen.queryByRole('region', { name: /Doc editor/ })).toBeNull();
  });
});

describe('Open chat from a doc in the library (ENG-4599)', () => {
  it('closes the doc and opens the chat it was made in', async () => {
    const user = userEvent.setup();
    const chats = { open: vi.fn(), check: vi.fn().mockResolvedValue('ok') };
    render(
      <OriginChatContext.Provider value={chats}>
        <ArtifactsView artifacts={[{ ...doc, originConversationId: 'conv-7' }]} agentLabel="Anton" />
      </OriginChatContext.Provider>,
    );
    await user.click(screen.getByRole('button', { name: /Q4 Hiring Plan Tracker/ }));
    const button = await screen.findByRole('button', { name: 'Open chat' });
    await vi.waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
    expect(chats.check).toHaveBeenCalledWith('conv-7');

    await user.click(button);

    expect(chats.open).toHaveBeenCalledWith('conv-7');
    expect(screen.queryByRole('region', { name: /Doc editor/ })).toBeNull();
  });

  it('is disabled for a doc made outside any chat, with no check', async () => {
    const user = userEvent.setup();
    const chats = { open: vi.fn(), check: vi.fn() };
    render(
      <OriginChatContext.Provider value={chats}>
        <ArtifactsView artifacts={[doc]} agentLabel="Anton" />
      </OriginChatContext.Provider>,
    );
    await user.click(screen.getByRole('button', { name: /Q4 Hiring Plan Tracker/ }));
    const button = await screen.findByRole('button', { name: 'Open chat' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    expect(chats.open).not.toHaveBeenCalled();
    expect(chats.check).not.toHaveBeenCalled();
  });
});

describe('a doc opened outside the app in the web build', () => {
  it('opens its rendered page in a tab, not its JSON', async () => {
    hostMock.isWeb = true;
    try {
      const user = userEvent.setup();
      const served = { ...doc, serveUrl: '/api/v1/artifacts/serve/general/q4-hiring-plan-tracker-36623b3b/doc.cdoc.json' };
      render(<ArtifactsView artifacts={[served]} agentLabel="Anton" />);
      await user.click(screen.getByRole('button', { name: 'Open' }));
      expect(hostMock.openExternal).toHaveBeenCalledWith(
        'http://api.test/api/v1/artifacts/serve/general/q4-hiring-plan-tracker-36623b3b/doc.html',
      );
      expect(api.openArtifactFile).not.toHaveBeenCalled();
    } finally {
      hostMock.isWeb = false;
    }
  });
});
