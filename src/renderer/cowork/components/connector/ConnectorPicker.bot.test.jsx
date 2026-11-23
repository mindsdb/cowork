// A connector whose spec sets `bot` (Microsoft Teams (Bot)) is labelled Bot in the
// directory, so it reads as something you ask from another app, not a data source.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const fetchConnectors = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
}));
vi.mock('../../../platform/host', () => ({
  host: { openExternal: vi.fn() },
}));

import ConnectorPicker from './ConnectorPicker';

afterEach(() => {
  fetchConnectors.mockReset();
});

describe('ConnectorPicker — bot label', () => {
  it('labels a bot connector Bot and leaves the data connectors bare', async () => {
    fetchConnectors.mockResolvedValue([
      { id: 'microsoft_teams_bot', label: 'Microsoft Teams (Bot)', category: 'communication', bot: true },
      { id: 'microsoft_teams', label: 'Microsoft Teams', category: 'communication' },
    ]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Microsoft Teams (Bot)');
    expect(screen.getAllByText('Bot')).toHaveLength(1);
  });
});
