import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceCleanupNotice } from './WorkspaceCleanupNotice';
import { codingApi } from './api';

vi.mock('./api', () => ({ codingApi: { workspaceCleanup: vi.fn(), retryWorkspaceCleanup: vi.fn() } }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

describe('WorkspaceCleanupNotice', () => {
  it('keeps the failure visible and disables the button during retry', async () => {
    vi.mocked(codingApi.workspaceCleanup).mockResolvedValue({ failed: 1, running: false });
    vi.mocked(codingApi.retryWorkspaceCleanup).mockResolvedValue({ failed: 1, running: true });
    render(<WorkspaceCleanupNotice active taskCount={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry cleanup' }));
    expect(await screen.findByRole('button', { name: 'Retrying cleanup…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Some files from deleted tasks');
    expect(codingApi.retryWorkspaceCleanup).toHaveBeenCalledOnce();
  });

  it('checks again after a deletion, follows the removal, and clears after a successful retry', async () => {
    vi.useFakeTimers();
    vi.mocked(codingApi.workspaceCleanup)
      .mockResolvedValueOnce({ failed: 0, running: false })
      .mockResolvedValueOnce({ failed: 0, running: true })
      .mockResolvedValueOnce({ failed: 1, running: false })
      .mockResolvedValue({ failed: 0, running: false });
    vi.mocked(codingApi.retryWorkspaceCleanup).mockResolvedValue({ failed: 1, running: true });
    const view = render(<WorkspaceCleanupNotice active taskCount={2} />);
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();
    // A delete shrinks the task list, which starts a check while removal runs.
    view.rerender(<WorkspaceCleanupNotice active taskCount={1} />);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry cleanup' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not poll while nothing is running or failed', async () => {
    vi.useFakeTimers();
    vi.mocked(codingApi.workspaceCleanup).mockResolvedValue({ failed: 0, running: false });
    render(<WorkspaceCleanupNotice active taskCount={1} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(codingApi.workspaceCleanup).toHaveBeenCalledOnce();
  });

  it('keeps polling while a removal runs and stops once it settles', async () => {
    vi.useFakeTimers();
    vi.mocked(codingApi.workspaceCleanup)
      .mockResolvedValueOnce({ failed: 0, running: true })
      .mockResolvedValueOnce({ failed: 0, running: true })
      .mockResolvedValue({ failed: 0, running: false });
    render(<WorkspaceCleanupNotice active taskCount={1} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(codingApi.workspaceCleanup).toHaveBeenCalledTimes(3);
  });

  it('retains the warning and offers another retry after a failed request', async () => {
    vi.mocked(codingApi.workspaceCleanup).mockResolvedValue({ failed: 1, running: false });
    vi.mocked(codingApi.retryWorkspaceCleanup).mockRejectedValue(new Error('offline'));
    render(<WorkspaceCleanupNotice active taskCount={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry cleanup' }));
    expect(await screen.findByText('Cleanup could not be retried. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry cleanup' })).toBeEnabled();
  });

  it('stops polling an older server and does not poll while inactive', async () => {
    vi.useFakeTimers();
    vi.mocked(codingApi.workspaceCleanup).mockRejectedValue({ status: 404 });
    const view = render(<WorkspaceCleanupNotice active={false} taskCount={1} />);
    expect(codingApi.workspaceCleanup).not.toHaveBeenCalled();
    view.rerender(<WorkspaceCleanupNotice active taskCount={1} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(codingApi.workspaceCleanup).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
