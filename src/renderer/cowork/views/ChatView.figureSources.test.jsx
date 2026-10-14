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
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

import ChatView from './ChatView';

const cell = (id, label, tab, toolUseId) => ({
  id, label, badge: 'Script', icon: 'code', status: 'completed', startedAt: 1000, completedAt: 2000,
  data: { one_line_description: label, name: tab, code: 'print(1)' }, output: '1', result: null,
  _isScratchpad: true, _isToolCall: false, _scratchpadTabId: tab, _toolUseId: toolUseId,
});

const ANSWER = 'You have 250 units at $42 each.';
const at = (text) => ANSWER.indexOf(text);
const FIGURES = [
  { start: at('250'), end: at('250') + 3, text: '250', origin: 'step', sources: [{ tool_use_id: 'toolu_01', kind: 'file', label: 'stock.csv', page: null }] },
  { start: at('$42'), end: at('$42') + 3, text: '$42', origin: 'step', sources: [{ tool_use_id: 'toolu_02', kind: 'file', label: 'rates.pdf', page: 1 }] },
];

const renderTurn = (extra) => render(
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
            cell('step-1', 'Read the stock export', 'stock', 'toolu_01'),
            cell('step-2', 'Read the supplier price list', 'rates', 'toolu_02'),
          ],
          ...extra,
        },
      ],
    }}
    onSend={vi.fn()}
  />,
);

describe('figure marks in a finished answer', () => {
  it('open the step a figure came from in the scratchpad', async () => {
    renderTurn({ figureSources: FIGURES });
    await userEvent.click(screen.getByRole('button', { name: '$42, From rates.pdf, page 1' }));
    const pad = await screen.findByRole('dialog', { name: 'Scratchpad' });
    expect(within(pad).getByText('Read the supplier price list')).toBeInTheDocument();
    // The other pad's cell is not the one shown.
    expect(within(pad).queryByText('Read the stock export')).toBeNull();
  });

  it('are absent from an answer whose turn sent no figure sources', () => {
    const { container } = renderTurn({});
    expect(container.querySelector('.anton-figure')).toBeNull();
  });
});
