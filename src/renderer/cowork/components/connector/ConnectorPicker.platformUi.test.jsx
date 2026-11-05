import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { setOrgMode } from '../../../lib/orgMode';

vi.mock('../../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../../api', () => ({
  fetchConnectors: vi.fn(async () => [
    { id: 'gmail', label: 'Gmail', category: 'communication' },
    { id: 'local_files', label: 'Local Files', category: 'files', cloud_available: false },
  ]),
}));

import ConnectorPicker from './ConnectorPicker';
import { fetchConnectors } from '../../api';

afterEach(() => setOrgMode(false));

it('keeps usable connectors without advertising the desktop catalog', async () => {
  setOrgMode(true);
  const onPick = vi.fn();
  render(<ConnectorPicker open onPick={onPick} onClose={vi.fn()} onDesktopOnly={vi.fn()} />);
  await screen.findByText('Gmail');
  expect(fetchConnectors).toHaveBeenCalledWith({ includeUnavailable: false });
  expect(screen.getByText('Available connectors')).toBeInTheDocument();
  expect(screen.queryByText(/desktop|MindsHub|Cowork Cloud|Local Files/i)).toBeNull();
  fireEvent.click(screen.getByText('Gmail'));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'gmail' }));
});
