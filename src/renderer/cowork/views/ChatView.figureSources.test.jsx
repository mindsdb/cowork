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

/* The figure viewer reads a project file through the project files API, and
   a file attached to the chat through its attachment route, whose bytes come
   back through authFetch. */
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  readProjectFile: vi.fn(async () => ({ content: 'sku,qty\nmug,250\n' })),
  writeProjectFile: vi.fn(),
  deleteProjectFile: vi.fn(),
  authFetch: vi.fn(async () => new Response('sku,qty\nmug,40\n', { headers: { 'Content-Type': 'text/csv' } })),
}));

import ChatView, { TextBlock } from './ChatView';
import { host } from '../../platform/host';
import { BASE, authFetch, deleteProjectFile, readProjectFile, writeProjectFile } from '../api';

const cell = (id, label, tab, toolUseId) => ({
  id, label, badge: 'Script', icon: 'code', status: 'completed', startedAt: 1000, completedAt: 2000,
  data: { one_line_description: label, name: tab, code: 'print(1)' }, output: '1', result: null,
  _isScratchpad: true, _isToolCall: false, _scratchpadTabId: tab, _toolUseId: toolUseId,
});

const ANSWER = 'You have 250 units at $42 each.';
const at = (text) => ANSWER.indexOf(text);
/* The parsed `response.figure_sources` event, as the turn keeps it. An event
   from before figure sources named their project has no project_id. */
const step = (tool_use_id, label, extra = {}) => ({
  tool_use_id, kind: 'file', label, path: null, attachment_id: null, url: null, queries: [], requests: [], ...extra,
});
const FIGURE_SOURCES = {
  project_id: null,
  steps: [
    step('toolu_01', 'stock.png', { path: 'charts/stock.png' }),
    step('toolu_02', 'rates.pdf'),
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
    const popup = await openPopover('$42, from a file');
    await userEvent.click(within(popup).getByRole('button', { name: 'Open step' }));
    const pad = await screen.findByRole('dialog', { name: 'Scratchpad' });
    expect(within(pad).getByText('Read the supplier price list')).toBeInTheDocument();
    // The other pad's cell is not the one shown.
    expect(within(pad).queryByText('Read the stock chart')).toBeNull();
  });

  it("open a source's project file in the chat's file viewer, with no Open action", async () => {
    renderTurn({ figureSources: FIGURE_SOURCES }, { project: { name: 'acme', path: '/tmp/acme' } });
    const popup = await openPopover('250, from a file');
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    const viewer = await screen.findByRole('dialog', { name: 'charts/stock.png' });
    /* The image cannot load here (no network), so the viewer falls back to
       the panel that offers its file actions on desktop: Reveal stays, Open,
       which hands the agent's path to the OS default app, does not. */
    expect((await within(viewer).findAllByRole('button', { name: /Reveal/ })).length).toBeGreaterThan(0);
    expect(within(viewer).queryByRole('button', { name: /^.?\s*Open$/ })).toBeNull();
    expect(host.openPath).not.toHaveBeenCalled();
  });

  const csvSources = (projectId) => ({
    ...FIGURE_SOURCES,
    project_id: projectId,
    steps: [step('toolu_01', 'stock.csv', { path: 'data/stock.csv' }), FIGURE_SOURCES.steps[1]],
  });

  it("show a source's text file without Edit or Delete, since the file is the figure's evidence", async () => {
    renderTurn({ figureSources: csvSources(null) }, { project: { name: 'acme', path: '/tmp/acme' } });
    const popup = await openPopover('250, from a file');
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    const viewer = await screen.findByRole('dialog', { name: 'data/stock.csv' });
    expect(await within(viewer).findByText(/mug,250/)).toBeInTheDocument();
    expect(readProjectFile).toHaveBeenCalledWith('acme', 'data/stock.csv');
    expect(within(viewer).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(viewer).queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(within(viewer).queryByText(/You do not have permission/)).toBeNull();
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(deleteProjectFile).not.toHaveBeenCalled();
  });

  it('say in the viewer that it shows the file as it is now, and that Open step shows what the step read', async () => {
    renderTurn({ figureSources: csvSources(null) }, { project: { name: 'acme', path: '/tmp/acme' } });
    const popup = await openPopover('250, from a file');
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    const viewer = await screen.findByRole('dialog', { name: 'data/stock.csv' });
    expect(within(viewer).getByRole('note')).toHaveTextContent('Shows the file as it is now. Open step shows what the step read.');
  });

  it('offer "View file" for a project file only in the project the answer ran in', async () => {
    const { unmount } = renderTurn(
      { figureSources: csvSources('proj-a') },
      { project: { id: 'proj-b', name: 'plantB', path: '/tmp/plantB' } },
    );
    let popup = await openPopover('250, from a file');
    // Moved to another project: the same name there is a different file.
    expect(within(popup).queryByRole('button', { name: /View file/ })).toBeNull();
    unmount();

    renderTurn({ figureSources: csvSources('proj-a') }, { project: { id: 'proj-a', name: 'plantA', path: '/tmp/plantA' } });
    popup = await openPopover('250, from a file');
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    expect(await screen.findByRole('dialog', { name: 'data/stock.csv' })).toBeInTheDocument();
    expect(readProjectFile).toHaveBeenCalledWith('plantA', 'data/stock.csv');
  });

  const attachedSources = {
    ...FIGURE_SOURCES,
    project_id: 'proj-a',
    steps: [step('toolu_01', 'stock.csv', { attachment_id: 'file-123' }), FIGURE_SOURCES.steps[1]],
  };

  it("open a file attached to the chat through its attachment route, read only", async () => {
    vi.mocked(authFetch).mockClear();
    vi.mocked(readProjectFile).mockClear();
    // An attachment belongs to the chat, so a move to another project keeps it.
    renderTurn({ figureSources: attachedSources }, { project: { id: 'proj-b', name: 'plantB', path: '/tmp/plantB' } });
    const popup = await openPopover('250, from a file');
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    const viewer = await screen.findByRole('dialog', { name: 'stock.csv' });
    expect(await within(viewer).findByText(/mug,40/)).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledWith(`${BASE}/attachments/plantB/conv-a/file-123/raw`, { signal: undefined });
    expect(readProjectFile).not.toHaveBeenCalled();
    expect(within(viewer).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(viewer).queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(within(viewer).queryByRole('button', { name: /^.?\s*Open$/ })).toBeNull();
    expect(host.openExternal).not.toHaveBeenCalled();
  });

  /* The attachment route names the chat's project, so with none there is no
     route to read the file by, and a viewer opened anyway would say the file
     is empty. */
  it('offer no "View file" for a file attached to a chat with no project to read it through', async () => {
    vi.mocked(authFetch).mockClear();
    renderTurn({ figureSources: attachedSources });
    const popup = await openPopover('250, from a file');
    expect(within(popup).queryByRole('button', { name: /View file/ })).toBeNull();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('offer no "View file" for an attached file in an answer that names no conversation', async () => {
    const onViewFile = vi.fn();
    render(
      <TextBlock
        text={ANSWER}
        figureSources={attachedSources}
        steps={[]}
        onViewFile={onViewFile}
        projectId="proj-a"
        projectName="plantA"
      />,
    );
    const popup = await openPopover('250, from a file');
    expect(within(popup).queryByRole('button', { name: /View file/ })).toBeNull();
  });

  it('open a step with the latest opener after a re-render hands in a fresh one', async () => {
    const steps = [
      cell('step-1', 'Read the stock chart', 'stock', 'toolu_01'),
      cell('step-2', 'Read the supplier price list', 'rates', 'toolu_02'),
    ];
    const first = vi.fn();
    const latest = vi.fn();
    const block = (onOpenStep) => (
      <TextBlock text={ANSWER} figureSources={FIGURE_SOURCES} steps={steps} onOpenStep={onOpenStep} />
    );
    const { rerender } = render(block(first));
    rerender(block(latest));
    const popup = await openPopover('$42, from a file');
    await userEvent.click(within(popup).getByRole('button', { name: 'Open step' }));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('offer no "View file" for a project file in a chat with no project to read it from', async () => {
    renderTurn({ figureSources: FIGURE_SOURCES });
    const popup = await openPopover('250, from a file');
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
