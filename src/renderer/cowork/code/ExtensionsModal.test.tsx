import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import type { ExtensionInventory } from './api';

const openPath = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const { extensions } = vi.hoisted(() => ({
  extensions: vi.fn<() => Promise<ExtensionInventory>>(async () => ({
    skills: [{ id: 'review', label: 'Review', description: 'Review changes', status: 'enabled', detail: 'user', path: '/skills/review/SKILL.md' }],
    mcp_servers: [{ id: 'github', label: 'GitHub', description: 'Repository tools', status: 'authenticated', detail: '2 tools' }],
    plugins: [], apps: [], hooks: [], errors: [], config_path: '/private/codex/config.toml',
  })),
}));

vi.mock('./api', () => ({ codingApi: { extensions } }));
vi.mock('../../platform/host', () => ({ host: { openPath } }));

import { ExtensionsModal } from './ExtensionsModal';


it('loads the runtime inventory and switches extension categories', async () => {
  const user = userEvent.setup();
  render(<ExtensionsModal open sessionId="task-1" initialTab="skills" onClose={vi.fn()} />);

  expect(await screen.findByText('Review')).toBeInTheDocument();
  expect(screen.getByText('/skills/review/SKILL.md')).toBeInTheDocument();
  expect(screen.getByText('/private/codex/config.toml')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open config' }));
  expect(openPath).toHaveBeenCalledWith('/private/codex/config.toml');
  await user.click(screen.getByRole('tab', { name: /MCP/ }));
  expect(screen.getByText('GitHub')).toBeInTheDocument();
  expect(extensions).toHaveBeenCalledWith('task-1');
});


it('shows a skill with two sources as one capability that names its other location', async () => {
  extensions.mockResolvedValueOnce({
    skills: [{
      id: 'review', label: 'Review', description: 'Review changes', status: 'enabled', detail: 'task skills',
      path: '/task/.codex/skills/review/SKILL.md',
      supersedes: [{ id: 'review', label: 'Review', description: 'Review changes', status: 'enabled', detail: 'user', path: '/home/ian/.codex/skills/review/SKILL.md' }],
    }],
    mcp_servers: [], plugins: [], apps: [], hooks: [], errors: [], config_path: '/private/codex/config.toml',
  });
  render(<ExtensionsModal open sessionId="task-1" initialTab="skills" onClose={vi.fn()} />);

  expect(await screen.findByText('Review')).toBeInTheDocument();
  expect(screen.getAllByText('Review')).toHaveLength(1);
  expect(screen.getByText('/task/.codex/skills/review/SKILL.md')).toBeInTheDocument();
  expect(screen.getByText('Also installed in user · /home/ian/.codex/skills/review/SKILL.md')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Skills/ })).toHaveTextContent('1');
});
