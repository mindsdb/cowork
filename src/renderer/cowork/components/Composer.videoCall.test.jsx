// The + menu's Video call row (prototype): there only when a call can start.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: { isWeb: true, isElectron: false, getApiOrigin: () => 'http://x', getAccessToken: async () => null, openExternal: vi.fn() },
}));

import Composer from './Composer';

function renderComposer(props = {}) {
  return render(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} connectors={[]} {...props} />);
}

describe('the Video call row', () => {
  it('starts a call and closes the menu', async () => {
    const onStartVideoCall = vi.fn();
    renderComposer({ onStartVideoCall });
    await userEvent.click(screen.getByRole('button', { name: /add context/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Video call' }));
    expect(onStartVideoCall).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Video call' })).not.toBeInTheDocument();
  });

  it('is not there when no call can start', async () => {
    renderComposer({ onStartVideoCall: null });
    await userEvent.click(screen.getByRole('button', { name: /add context/i }));
    expect(screen.queryByRole('button', { name: 'Video call' })).not.toBeInTheDocument();
  });
});
