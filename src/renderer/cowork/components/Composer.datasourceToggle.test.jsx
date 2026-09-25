// The per-conversation connector toggles, with cloud database connections in
// the list. They are governed by the control that already existed: a pair of
// (engine, name), which is exactly what the server compares a turn's grants
// against, so a datasource needs no second mechanism.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: { isWeb: true, isElectron: false, getApiOrigin: () => 'http://x', getAccessToken: async () => null, openExternal: vi.fn() },
}));

import Composer from './Composer';

const GMAIL = { engine: 'gmail', name: 'work' };
const POSTGRES = { engine: 'postgres', name: 'Analytics' };

function renderComposer(props = {}) {
  return render(
    <Composer
      value=""
      onChange={vi.fn()}
      onSend={vi.fn()}
      connectors={[GMAIL, POSTGRES]}
      disabledConnections={[]}
      onUpdateConnectorMute={vi.fn()}
      {...props}
    />,
  );
}

async function openTheConnectorsMenu() {
  await userEvent.click(screen.getByRole('button', { name: /add|plus|more/i }));
  const accordion = await screen.findByRole('button', { name: /connectors/i });
  await userEvent.click(accordion);
}

describe('the connector toggles', () => {
  it('lists a cloud database connection beside the OAuth ones', async () => {
    renderComposer();
    await openTheConnectorsMenu();

    expect(await screen.findByRole('switch', { name: /Analytics/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /work/i })).toBeInTheDocument();
  });

  it('turns one off through the control that already governs connections', async () => {
    const onUpdateConnectorMute = vi.fn();
    renderComposer({ onUpdateConnectorMute });
    await openTheConnectorsMenu();

    await userEvent.click(await screen.findByRole('switch', { name: /Analytics/i }));

    expect(onUpdateConnectorMute).toHaveBeenCalledWith(
      expect.objectContaining({ engine: 'postgres', name: 'Analytics' }),
      false,
    );
  });

  it('shows a disabled datasource as off, from the pair the server stores', async () => {
    renderComposer({ disabledConnections: [{ engine: 'postgres', name: 'Analytics' }] });
    await openTheConnectorsMenu();

    expect(await screen.findByRole('switch', { name: /Analytics/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /work/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('says when a change takes effect', async () => {
    renderComposer();
    await openTheConnectorsMenu();

    expect(await screen.findByText(/applies from your next message/i)).toBeInTheDocument();
  });
});
