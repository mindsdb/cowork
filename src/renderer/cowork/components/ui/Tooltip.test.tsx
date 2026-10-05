import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip, parseTooltipDelay } from './Tooltip';

// The real Code Mode token block from globals.css, so the test breaks if the
// stylesheet stops making Code tooltips instant.
const globals = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf8');
const codeBlock = /html\[data-workspace="code"\] \{[^}]*\}/.exec(globals)?.[0];

let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement('style');
  style.textContent = codeBlock ?? '';
  document.head.appendChild(style);
});
afterAll(() => style.remove());
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.workspace;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderTooltip() {
  render(
    <Tooltip content="Hint">
      <button type="button">Trigger</button>
    </Tooltip>,
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

describe('Tooltip delay per workspace', () => {
  it('declares a 0ms tooltip delay for Code Mode in globals.css', () => {
    expect(codeBlock).toMatch(/--tooltip-delay:\s*0ms;/);
  });

  it('keeps the 250ms wait outside Code Mode', async () => {
    document.documentElement.dataset.workspace = 'cowork';
    renderTooltip();
    await userEvent.hover(screen.getByText('Trigger'));
    await wait(100);
    expect(screen.queryByText('Hint')).toBeNull();
    expect(await screen.findByText('Hint', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('opens without waiting in Code Mode', async () => {
    document.documentElement.dataset.workspace = 'code';
    renderTooltip();
    await userEvent.hover(screen.getByText('Trigger'));
    await wait(30);
    expect(screen.getByText('Hint')).toBeInTheDocument();
  });

  it('picks up a workspace switch on an already-mounted tooltip', async () => {
    document.documentElement.dataset.workspace = 'cowork';
    renderTooltip();
    await act(async () => {
      document.documentElement.dataset.workspace = 'code';
      await wait(0);
    });
    await userEvent.hover(screen.getByText('Trigger'));
    await wait(30);
    expect(screen.getByText('Hint')).toBeInTheDocument();
  });

  it('lets an explicit delay prop win over the token', async () => {
    document.documentElement.dataset.workspace = 'code';
    render(
      <Tooltip content="Hint" delay={800}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    await userEvent.hover(screen.getByText('Trigger'));
    await wait(100);
    expect(screen.queryByText('Hint')).toBeNull();
  });
});
