import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskSourceLinks } from './TaskSourceLinks';

const { readSourceContext, searchWorkItems } = vi.hoisted(() => ({
  readSourceContext: vi.fn(),
  searchWorkItems: vi.fn(),
}));
vi.mock('./api', () => ({ codingApi: { readSourceContext, searchWorkItems } }));
const url = 'https://linear.app/mindsdb/issue/ENG-2382/cannot-paste-linear-urls';
const context = { provider: 'linear', kind: 'issue', url, external_id: 'ENG-2382', title: 'Fix paste', body: 'Keep URLs' };
const connections = [{ engine: 'linear', name: 'work', status: 'connected' }];

function setup(availableConnections = connections) {
  const props = { project: null, availableConnections, value: [], onChange: vi.fn(), onOpenConnectors: vi.fn(), onAddingChange: vi.fn(), busy: false };
  return { ...render(<TaskSourceLinks {...props} />), props, user: userEvent.setup() };
}

beforeEach(() => {
  readSourceContext.mockReset().mockResolvedValue(context);
  searchWorkItems.mockReset().mockResolvedValue({ items: [], incomplete: false });
});

describe('TaskSourceLinks without a project', () => {
  it('always offers linked work and a clear connection action before accounts arrive', async () => {
    const { user, props, rerender } = setup([]);
    await user.click(screen.getByRole('button', { name: 'Add issue or PR' }));
    expect(screen.getByText('Connect GitHub or Linear to start from existing work.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open Connectors' }));
    expect(props.onOpenConnectors).toHaveBeenCalledOnce();
    rerender(<TaskSourceLinks {...props} availableConnections={connections} />);
    await waitFor(() => expect(searchWorkItems).toHaveBeenCalledWith(null, expect.objectContaining({ provider: 'linear', connection_name: 'work' })));
    expect(screen.getByRole('textbox', { name: 'Issue or pull-request link' })).toBeVisible();
  });

  it('retains the URL and error after a failed read and permits retry', async () => {
    readSourceContext.mockRejectedValueOnce(new Error('Linear is temporarily unavailable. Try again.'));
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Add issue or PR' }));
    await user.type(screen.getByRole('textbox', { name: 'Issue or pull-request link' }), url);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(searchWorkItems).toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toHaveTextContent('Linear is temporarily unavailable. Try again.');
    expect(screen.getByRole('textbox', { name: 'Issue or pull-request link' })).toHaveValue(url);
    expect(props.onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(props.onChange).toHaveBeenCalledWith([context]));
    expect(readSourceContext).toHaveBeenCalledTimes(2);
  });

  it('does not restore old context after leaving the draft while a read is pending', async () => {
    let complete!: (value: object) => void;
    readSourceContext.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const { user, props, unmount } = setup();
    await user.click(screen.getByRole('button', { name: 'Add issue or PR' }));
    await user.type(screen.getByRole('textbox', { name: 'Issue or pull-request link' }), url);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(readSourceContext).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(props.onAddingChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(props.onAddingChange).toHaveBeenLastCalledWith(false);
    await act(async () => { complete(context); });
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
