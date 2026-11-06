// The + menu's Browser switch (ENG-3188): shown when the composer is given
// one, on by default, and it reports the change rather than keeping it.

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

async function openThePlusMenu() {
  await userEvent.click(screen.getByRole('button', { name: /add context/i }));
}

describe('the Browser switch in the + menu', () => {
  it('is on when the task uses the browser, and reports turning it off', async () => {
    const onChange = vi.fn();
    renderComposer({ browserSwitch: { on: true, onChange, agentLabel: 'Anton' } });
    await openThePlusMenu();

    const toggle = await screen.findByRole('switch', { name: /browser off for this task/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('shows a task with the browser off as off', async () => {
    renderComposer({ browserSwitch: { on: false, onChange: vi.fn(), agentLabel: 'Anton' } });
    await openThePlusMenu();

    expect(await screen.findByRole('switch', { name: /browser on for this task/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('names the agent the person set, not a fixed one', async () => {
    renderComposer({ browserSwitch: { on: true, onChange: vi.fn(), agentLabel: 'Cowork' } });
    await openThePlusMenu();

    const row = (await screen.findByRole('switch', { name: /browser off for this task/i })).parentElement;
    expect(row).toHaveAttribute('title', 'Cowork can use your shared browser in this task. Off applies from your next message.');
  });

  it('is not there when the shared browser is off in Settings', async () => {
    renderComposer({ browserSwitch: null });
    await openThePlusMenu();

    expect(screen.queryByText('Browser')).not.toBeInTheDocument();
  });
});
