import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

/* The figure viewer reads a text source through the project files API. */
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  readProjectFile: vi.fn(async () => ({ content: 'sku,qty\nmug,250\n' })),
  writeProjectFile: vi.fn(),
}));

import ChatView from './ChatView';
import { host } from '../../platform/host';
import { readProjectFile, writeProjectFile } from '../api';

const cell = (id, label, tab, toolUseId) => ({
  id, label, badge: 'Script', icon: 'code', status: 'completed', startedAt: 1000, completedAt: 2000,
  data: { one_line_description: label, name: tab, code: 'print(1)' }, output: '1', result: null,
  _isScratchpad: true, _isToolCall: false, _scratchpadTabId: tab, _toolUseId: toolUseId,
});

const ANSWER = 'You have 250 units at $42 each.';
const at = (text) => ANSWER.indexOf(text);
/* The parsed `response.figure_sources` event, as the turn keeps it. */
const FIGURE_SOURCES = {
  steps: [
    { tool_use_id: 'toolu_01', kind: 'file', label: 'stock.png', path: 'charts/stock.png', url: null, queries: [], requests: [] },
    { tool_use_id: 'toolu_02', kind: 'file', label: 'rates.pdf', path: null, url: null, queries: [], requests: [] },
  ],
  figures: [
    { start: at('250'), end: at('250') + 3, text: '250', origin: 'step', sources: [{ tool_use_id: 'toolu_01', page: null }] },
    { start: at('$42'), end: at('$42') + 3, text: '$42', origin: 'step', sources: [{ tool_use_id: 'toolu_02', page: 1 }] },
  ],
};

const renderTurn = (extra, props = {}) => render(
  <ChatView
    task={{
      id: 'conv-a',
      title: 'Stock',
      status: 'idle',
      messages: [
        { role: 'user', content: 'How many mugs?' },
        {
          role: 'assistant',
          id: 'a1',
          content: ANSWER,
          startedAt: 1000,
          steps: [
            cell('step-1', 'Read the stock chart', 'stock', 'toolu_01'),
            cell('step-2', 'Read the supplier price list', 'rates', 'toolu_02'),
          ],
          ...extra,
        },
      ],
    }}
    onSend={vi.fn()}
    {...props}
  />,
);

const openPopover = async (name) => {
  await userEvent.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name: /came from/ });
};

describe('figure marks in a finished answer', () => {
  it("open a source's step in the scratchpad from the figure's popover", async () => {
    renderTurn({ figureSources: FIGURE_SOURCES });
    const popup = await openPopover('$42, From rates.pdf, page 1');
    await userEvent.click(within(popup).getByRole('button', { name: 'Open step' }));
    const pad = await screen.findByRole('dialog', { name: 'Scratchpad' });
    expect(within(pad).getByText('Read the supplier price list')).toBeInTheDocument();
    // The other pad's cell is not the one shown.
    expect(within(pad).queryByText('Read the stock chart')).toBeNull();
  });

  it("open a source's project file in the chat's file viewer, with no Open action", async () => {
    renderTurn({ figureSources: FIGURE_SOURCES }, { project: { name: 'acme', path: '/tmp/acme' } });
    const popup = await openPopover('250, From stock.png');
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    const viewer = await screen.findByRole('dialog', { name: 'charts/stock.png' });
    /* The image cannot load here (no network), so the viewer falls back to
       the panel that offers its file actions on desktop: Reveal stays, Open,
       which hands the agent's path to the OS default app, does not. */
    expect((await within(viewer).findAllByRole('button', { name: /Reveal/ })).length).toBeGreaterThan(0);
    expect(within(viewer).queryByRole('button', { name: /^.?\s*Open$/ })).toBeNull();
    expect(host.openPath).not.toHaveBeenCalled();
  });

  it("show a source's text file without Edit, since the file is the figure's evidence", async () => {
    const csvSources = {
      ...FIGURE_SOURCES,
      steps: [
        { ...FIGURE_SOURCES.steps[0], label: 'stock.csv', path: 'data/stock.csv' },
        FIGURE_SOURCES.steps[1],
      ],
    };
    renderTurn({ figureSources: csvSources }, { project: { name: 'acme', path: '/tmp/acme' } });
    const popup = await openPopover('250, From stock.csv');
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    const viewer = await screen.findByRole('dialog', { name: 'data/stock.csv' });
    expect(await within(viewer).findByText(/mug,250/)).toBeInTheDocument();
    expect(readProjectFile).toHaveBeenCalledWith('acme', 'data/stock.csv');
    expect(within(viewer).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(viewer).queryByText(/You do not have permission/)).toBeNull();
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it('offer no "View file" in a chat with no project to read it from', async () => {
    renderTurn({ figureSources: FIGURE_SOURCES });
    const popup = await openPopover('250, From stock.png');
    expect(within(popup).queryByRole('button', { name: /View file/ })).toBeNull();
  });

  it('are absent when the user turned them off in Settings', () => {
    const { container } = renderTurn({ figureSources: FIGURE_SOURCES }, { showFigureSources: false });
    expect(container.querySelector('.anton-figure')).toBeNull();
    expect(container.textContent).toContain(ANSWER);
  });

  it('are absent from an answer whose turn sent no figure sources', () => {
    const { container } = renderTurn({});
    expect(container.querySelector('.anton-figure')).toBeNull();
  });
});
