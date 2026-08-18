// ENG-1705 — the card must never render a bare em-dash as its title.
//
// This is deliberately a VIEW test, not another unit test of
// connectionIdentity(). The helper's own suite passes even when the card is
// wired back to `connection.user_label || '—'`, so the helper alone does not
// prove the user-visible bug is fixed. This file covers the wiring.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const CONNECTIONS = [
  // Unlabelled, has a registry spec → titles from the registry's casing.
  { engine: 'github', name: 'github-46461b', label: 'GitHub', user_label: null, display_name: null },
  // Unlabelled with a derivable account → service in the title, account below.
  {
    engine: 'google_calendar', name: 'google_calendar-alecantu7-gmail-com',
    label: 'Google Calendar', user_label: null, display_name: 'alecantu7@gmail.com',
  },
  // The user's own label wins.
  {
    engine: 'gmail', name: 'gmail-3ce87a', label: 'Gmail',
    user_label: 'Work', display_name: 'alejandro.cantu@mindsdb.com',
  },
  // No registry spec (the ENG-1706 records) → humanized engine + unique slug.
  { engine: 'fm_ec163d25cf', name: 'fm_ec163d25cf-2cf3a6', label: null, user_label: null },
  { engine: 'fm_ec163d25cf', name: 'fm_ec163d25cf-724e63', label: null, user_label: null },
];

vi.mock('../api', () => ({
  CONNECTIONS_VAULT_KEEP: '__KEEP__',
  deleteDatasource: vi.fn(),
  fetchConnector: vi.fn(() => Promise.resolve(null)),
  // The view refetches on mount and replaces its list, so this must return the
  // same fixtures or the assertions race the effect.
  fetchDatasources: vi.fn(() => Promise.resolve({ connections: CONNECTIONS })),
  fetchSavedConnection: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../../platform/host', () => ({
  host: { isWeb: false, isMac: () => false, isElectron: true, openExternal: vi.fn(), keychainRevoke: vi.fn() },
}));

import CustomizeView from './CustomizeView';

describe('CustomizeView connection cards — ENG-1705 wiring', () => {
  it('renders no em-dash title for any connection', () => {
    const { container } = render(<CustomizeView connectors={CONNECTIONS} />);
    // The regression rendered one '—' per unlabelled card. Scoped to the
    // rendered container so unrelated chrome elsewhere in the document can
    // never fail this spuriously.
    expect(within(container).queryAllByText('—')).toHaveLength(0);
  });

  it('titles an unlabelled connection with the registry label, not the engine id', () => {
    render(<CustomizeView connectors={CONNECTIONS} />);
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Github')).toBeNull();
  });

  it('keeps the service in the title and the account on the second line', () => {
    render(<CustomizeView connectors={CONNECTIONS} />);
    expect(screen.getByText('Google Calendar')).toBeInTheDocument();
    expect(screen.getByText('alecantu7@gmail.com')).toBeInTheDocument();
  });

  it("preserves a user's own label", () => {
    render(<CustomizeView connectors={CONNECTIONS} />);
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('alejandro.cantu@mindsdb.com')).toBeInTheDocument();
  });

  it('distinguishes two spec-less connections that share an engine', () => {
    render(<CustomizeView connectors={CONNECTIONS} />);
    // Identical titles are acceptable; identical cards are not — the slug on
    // the second line is the only thing that tells these two apart.
    expect(screen.getByText('fm_ec163d25cf-2cf3a6')).toBeInTheDocument();
    expect(screen.getByText('fm_ec163d25cf-724e63')).toBeInTheDocument();
  });
});
