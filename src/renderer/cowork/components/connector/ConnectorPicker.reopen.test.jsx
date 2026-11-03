// A closed picker keeps no "yes" for its next open. The real Modal draws
// nothing while closed, so this one draws its children always, to show what
// the first frame of the next open would paint.

import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const fetchConnectors = vi.fn();
const fetchCanBuildCustomConnector = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
  fetchCanBuildCustomConnector: (...args) => fetchCanBuildCustomConnector(...args),
}));
vi.mock('../../../platform/host', () => ({
  host: { openExternal: vi.fn() },
}));
vi.mock('../ui/Modal', () => ({
  Modal: ({ children }) => <div>{children}</div>,
}));

import ConnectorPicker from './ConnectorPicker';

afterEach(() => {
  vi.clearAllMocks();
});

it('drops the server\'s yes when it closes', async () => {
  fetchConnectors.mockResolvedValue([{ id: 'gmail', label: 'Gmail', category: 'communication' }]);
  fetchCanBuildCustomConnector.mockResolvedValue(true);
  const props = { onPick: vi.fn(), onClose: vi.fn(), onBuildCustom: vi.fn() };
  const { rerender } = render(<ConnectorPicker open {...props} />);
  expect(await screen.findByRole('button', { name: /^Build a custom connector Connect a system/ })).toBeTruthy();

  rerender(<ConnectorPicker open={false} {...props} />);

  expect(screen.queryByText('Build a custom connector')).toBeNull();
});
