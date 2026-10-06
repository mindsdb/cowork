import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../lib/clipboard';
import { CopyResponseButton } from './CopyResponseButton';

vi.mock('../lib/clipboard', () => ({ copyText: vi.fn() }));

beforeEach(() => vi.mocked(copyText).mockResolvedValue(true));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('CopyResponseButton', () => {
  it('copies the original Markdown, including code, and confirms success', async () => {
    const text = '**Done.**\n\n```js\nconst answer = 42;\n```';
    render(<CopyResponseButton text={text} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    expect(copyText).toHaveBeenCalledWith(text);
  });

  it('lets the user retry a failed copy without reporting success', async () => {
    vi.mocked(copyText).mockResolvedValueOnce(false);
    render(<CopyResponseButton text="Answer" />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy response' })));
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy. Try again.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy response' })));
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('clears the success message after a short delay', async () => {
    vi.useFakeTimers();
    render(<CopyResponseButton text="Answer" />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy response' })));
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not apply a late clipboard result to updated text', async () => {
    let finish!: (success: boolean) => void;
    vi.mocked(copyText).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<CopyResponseButton text="Partial" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    expect(screen.getByRole('button', { name: 'Copy response' })).toBeDisabled();
    view.rerender(<CopyResponseButton text="Partial response completed" />);
    await act(async () => finish(true));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy response' })));
    expect(copyText).toHaveBeenLastCalledWith('Partial response completed');
  });

  it('does not offer an empty response', () => {
    render(<CopyResponseButton text={' \n'} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
