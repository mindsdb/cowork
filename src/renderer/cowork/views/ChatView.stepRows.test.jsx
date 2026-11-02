// A thinking-block row for an artifact or a skill draft opens that object, as
// its card does. It used to open ScratchpadModal, on a tab unrelated to the
// row, because every row click went there.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const openPath = vi.fn();

vi.mock('../lib/artifactsStore', () => ({
  useArtifactLiveness: () => false,
  artifactDeletedNow: () => false,
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
    openPath: (...a) => openPath(...a),
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

vi.mock('../components/artifact', () => ({
  ArtifactViewer: ({ open, artifact }) => (open ? <div data-testid="artifact-viewer">{artifact?.title}</div> : null),
}));

vi.mock('../components/thinking/ScratchpadModal', () => ({
  ScratchpadModal: ({ open, focusStepId }) => (open ? <div data-testid="scratchpad">{focusStepId}</div> : null),
}));

// The card itself is not under test; its preview modal is what the row opens.
vi.mock('../components/SkillCard', () => ({
  default: () => null,
  SkillModal: ({ open, skill }) => (open ? <div data-testid="skill-preview">{skill?.name}</div> : null),
}));

import ChatView from './ChatView';

const cell = {
  id: 'step-1', label: 'Load signups.csv', badge: 'Script', icon: 'code', status: 'completed',
  _isScratchpad: true, _scratchpadTabId: 'signups', data: { name: 'signups', code: 'print(1)' },
};
const artifact = {
  id: 'artifact-dash', label: 'Signups dashboard', badge: 'Artifact', icon: 'doc', status: 'completed',
  data: {
    title: 'Signups dashboard', file_path: '/proj/.anton/artifacts/dash/index.html',
    path: '/proj/.anton/artifacts/dash/index.html', ext: '.html', action: 'html-app', slug: 'dash',
  },
};
const skill = {
  id: 'skill-digest', label: 'Weekly metrics digest', badge: 'Skill', icon: 'cube', status: 'completed',
  _skillKey: 'digest', data: { slug: 'digest', name: 'Weekly metrics digest', instructions: 'Do it.' },
};

const task = (steps) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  projectPath: '/proj',
  messages: [
    { role: 'user', content: 'build it' },
    { id: 'a1', role: 'assistant', content: 'Done.', steps },
  ],
});

async function openRow(user, label) {
  await user.click(screen.getByRole('button', { name: 'Thought process' }));
  // The row comes first: the thinking block sits above the answer and its cards.
  await user.click(screen.getAllByTitle(label)[0]);
}

beforeEach(() => { openPath.mockReset(); });

describe('thinking-block rows for created objects', () => {
  it('opens the artifact viewer from an artifact row', async () => {
    const user = userEvent.setup();
    render(<ChatView task={task([cell, artifact])} />);

    await openRow(user, 'Signups dashboard');

    expect(screen.getByTestId('artifact-viewer')).toHaveTextContent('Signups dashboard');
    expect(screen.queryByTestId('scratchpad')).toBeNull();
  });

  it('opens the skill preview from a skill row', async () => {
    const user = userEvent.setup();
    render(<ChatView task={task([cell, skill])} />);

    await openRow(user, 'Weekly metrics digest');

    expect(screen.getByTestId('skill-preview')).toHaveTextContent('Weekly metrics digest');
    expect(screen.queryByTestId('scratchpad')).toBeNull();
  });

  it('still opens a scratchpad row in ScratchpadModal', async () => {
    const user = userEvent.setup();
    render(<ChatView task={task([cell, artifact])} />);

    await openRow(user, 'Load signups.csv');

    expect(screen.getByTestId('scratchpad')).toHaveTextContent('m:a1::step-1');
  });
});
