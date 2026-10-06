import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseTooltipDelay } from './Tooltip';

// The real :root motion-token block from globals.css, so the test breaks if
// the stylesheet changes the tooltip delay.
const globals = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf8');
const rootBlock = /:root \{[^}]*--tooltip-delay[^}]*\}/.exec(globals)?.[0];

let style: HTMLStyleElement | null = null;
afterEach(() => {
  cleanup();
  style?.remove();
  style = null;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The token is cached per module load, so each case injects its stylesheet
// and then imports a fresh Tooltip.
async function renderTooltip(css: string, delay?: number) {
  style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  vi.resetModules();
  const { Tooltip } = await import('./Tooltip');
  render(
    <Tooltip content="Hint" delay={delay}>
      <button type="button">Trigger</button>
    </Tooltip>,
  );
}

async function renderTooltipRow(css: string) {
  style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  vi.resetModules();
  const { Tooltip, TooltipProvider } = await import('./Tooltip');
  render(
    <TooltipProvider>
      <Tooltip content="First hint">
        <button type="button">First</button>
      </Tooltip>
      <Tooltip content="Second hint">
        <button type="button">Second</button>
      </Tooltip>
    </TooltipProvider>,
  );
}

describe('parseTooltipDelay', () => {
  it.each([
    ['0', 0],
    ['0ms', 0],
    ['0s', 0],
    [' 250ms ', 250],
    ['0.8s', 800],
  ])('reads %j as %i ms', (raw, ms) => {
    expect(parseTooltipDelay(raw)).toBe(ms);
  });

  it.each(['', 'fast', '-1ms'])('rejects %j', (raw) => {
    expect(parseTooltipDelay(raw)).toBeNull();
  });
});

describe('Tooltip delay token', () => {
  it('declares a 500ms tooltip delay on :root in globals.css', () => {
    expect(rootBlock).toMatch(/--tooltip-delay:\s*500ms;/);
  });

  it('opens instantly under a 0ms token', async () => {
    await renderTooltip(':root { --tooltip-delay: 0ms; }');
    await userEvent.hover(screen.getByText('Trigger'));
    await wait(30);
    expect(screen.getByText('Hint')).toBeInTheDocument();
  });

  it('waits for a non-zero token before opening', async () => {
    await renderTooltip(':root { --tooltip-delay: 0.8s; }');
    await userEvent.hover(screen.getByText('Trigger'));
    await wait(100);
    expect(screen.queryByText('Hint')).toBeNull();
    expect(await screen.findByText('Hint', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('lets an explicit delay prop win over the token', async () => {
    await renderTooltip(rootBlock ?? '', 800);
    await userEvent.hover(screen.getByText('Trigger'));
    await wait(100);
    expect(screen.queryByText('Hint')).toBeNull();
  });

  it('opens a neighbour instantly once one tooltip is warm', async () => {
    await renderTooltipRow(rootBlock ?? '');
    const user = userEvent.setup();
    await user.hover(screen.getByText('First'));
    expect(await screen.findByText('First hint', {}, { timeout: 2000 })).toBeInTheDocument();
    await user.unhover(screen.getByText('First'));
    await user.hover(screen.getByText('Second'));
    await wait(100);
    expect(screen.getByText('Second hint')).toBeInTheDocument();
  });
});
