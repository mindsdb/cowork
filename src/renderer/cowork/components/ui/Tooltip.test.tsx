import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The open delay comes from the `--tooltip-delay` motion token, read once per
// module load — so each case sets the token, then imports a fresh module.
async function renderWithToken(token: string | null) {
  if (token == null) document.documentElement.style.removeProperty('--tooltip-delay');
  else document.documentElement.style.setProperty('--tooltip-delay', token);
  vi.resetModules();
  const { Tooltip, TooltipProvider } = await import('./Tooltip');
  render(
    <TooltipProvider>
      <Tooltip content="Hint"><button type="button">Trigger</button></Tooltip>
    </TooltipProvider>,
  );
}

async function hoverAndWait(ms: number) {
  await userEvent.hover(screen.getByText('Trigger'));
  await new Promise((r) => setTimeout(r, ms));
}

describe('Tooltip delay token', () => {
  afterEach(() => document.documentElement.style.removeProperty('--tooltip-delay'));

  it('opens without waiting when --tooltip-delay is 0ms', async () => {
    await renderWithToken('0ms');
    await hoverAndWait(30);
    expect(screen.getByText('Hint')).toBeInTheDocument();
  });

  it('reads a unitless 0 as no delay', async () => {
    await renderWithToken('0');
    await hoverAndWait(30);
    expect(screen.getByText('Hint')).toBeInTheDocument();
  });

  it('waits for --tooltip-delay before opening', async () => {
    await renderWithToken('0.8s');
    await hoverAndWait(100);
    expect(screen.queryByText('Hint')).toBeNull();
    expect(await screen.findByText('Hint', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('still opens when the token is missing', async () => {
    await renderWithToken(null);
    await userEvent.hover(screen.getByText('Trigger'));
    expect(await screen.findByText('Hint')).toBeInTheDocument();
  });
});
