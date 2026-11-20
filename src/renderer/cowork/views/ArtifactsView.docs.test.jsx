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
vi.mock('../components/doc/DocPane', () => ({
  default: ({ artifactId, title, onAskAgent, onClose, onCardChange }) => (
    <div role="region" aria-label={`Doc editor: ${title}`} data-artifact={artifactId}>
      <button type="button" onClick={() => onCardChange?.({ ...docCard, title: 'Hiring plan 2027' })}>Rename</button>
      <button type="button" onClick={() => onClose?.()}>Close doc</button>
      {onAskAgent && (
        <button type="button" onClick={() => onAskAgent({ blockIds: ['b_1'], quote: 'Hire  two\nengineers', request: 'Make it three', tabId: 't_1', mode: 'edit' })}>
          Edit with agent
        </button>
      )}
    </div>
  ),
}));

import { useState } from 'react';
import ArtifactsView from './ArtifactsView';
import { withArtifactChange } from '../lib/artifactList';

const doc = {
  id: 'a1', title: 'Q4 Hiring Plan Tracker', format: 'doc', type: 'document', mtime: 1, projectId: 'p1',
  path: '/p/.anton/artifacts/q4-hiring-plan-tracker-36623b3b/doc.cdoc.json', primary: 'doc.cdoc.json',
  htmlPath: '/p/.anton/artifacts/q4-hiring-plan-tracker-36623b3b/doc.html',
};

// The card the doc's API returns: the library's own, under the doc's title.
const docCard = { id: 'a1', title: 'Q4 Hiring Plan Tracker', format: 'doc', path: doc.path, htmlPath: doc.htmlPath };

/** The library as the app holds it: a changed card replaces its row. */
function Library(props) {
  const [artifacts, setArtifacts] = useState(props.artifacts);
  return <ArtifactsView {...props} artifacts={artifacts} onArtifactChanged={(c) => setArtifacts((prev) => withArtifactChange(prev, c))} />;
}

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

describe('a doc renamed in the doc editor', () => {
  it('shows its new title in the library once the editor closes', async () => {
    const user = userEvent.setup();
    render(<Library artifacts={[doc]} agentLabel="Anton" />);
    await user.click(screen.getByRole('button', { name: /Q4 Hiring Plan Tracker/ }));
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    await user.click(screen.getByRole('button', { name: 'Close doc' }));
    expect(screen.queryByRole('region', { name: /Doc editor/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Hiring plan 2027/ })).toBeInTheDocument();
    expect(screen.queryByText('Q4 Hiring Plan Tracker')).toBeNull();
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
    });
    // Not as a comment's repair, whose path started a new chat under the doc's.
    expect(onAddressWithAgent).not.toHaveBeenCalled();
    // The library has no chat beside the doc: it closes for the chat to take over.
    expect(screen.queryByRole('region', { name: /Doc editor/ })).toBeNull();
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
