// A missing connect handler must fail visibly instead of leaving a dead button.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../api', () => ({
  CONNECTIONS_VAULT_KEEP: '__KEEP__',
  deleteDatasource: vi.fn(),
  fetchConnector: vi.fn(() => Promise.resolve(null)),
  fetchDatasources: vi.fn(() => Promise.resolve({ connections: [] })),
  fetchSavedConnection: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../../platform/host', () => ({
  host: { isWeb: false, isMac: () => false, isElectron: true, openExternal: vi.fn(), keychainRevoke: vi.fn() },
}));

import CustomizeView from './CustomizeView';

const CONNECTIONS = [
  { engine: 'gmail', name: 'gmail-3ce87a', label: 'Gmail', user_label: null, display_name: null },
];

describe('CustomizeView without onConnectNew', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it('logs an error instead of silently doing nothing when the Connect CTA is clicked', () => {
    render(<CustomizeView connectors={CONNECTIONS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('CustomizeView rendered without onConnectNew'),
    );
  });
});
