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
    render(<WorkspaceCleanupNotice active />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry cleanup' }));
    expect(await screen.findByRole('button', { name: 'Retrying cleanup…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Some files from deleted tasks');
    expect(codingApi.retryWorkspaceCleanup).toHaveBeenCalledOnce();
  });

  it('polls for failures after a deletion and clears them after a successful retry', async () => {
    vi.useFakeTimers();
    vi.mocked(codingApi.workspaceCleanup)
      .mockResolvedValueOnce({ failed: 0, running: false })
      .mockResolvedValueOnce({ failed: 1, running: false })
      .mockResolvedValue({ failed: 0, running: false });
    vi.mocked(codingApi.retryWorkspaceCleanup).mockResolvedValue({ failed: 1, running: true });
    render(<WorkspaceCleanupNotice active />);
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry cleanup' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retains the warning and offers another retry after a failed request', async () => {
    vi.mocked(codingApi.workspaceCleanup).mockResolvedValue({ failed: 1, running: false });
    vi.mocked(codingApi.retryWorkspaceCleanup).mockRejectedValue(new Error('offline'));
    render(<WorkspaceCleanupNotice active />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry cleanup' }));
    expect(await screen.findByText('Cleanup could not be retried. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry cleanup' })).toBeEnabled();
  });

  it('stops polling an older server and does not poll while inactive', async () => {
    vi.useFakeTimers();
    vi.mocked(codingApi.workspaceCleanup).mockRejectedValue({ status: 404 });
    const view = render(<WorkspaceCleanupNotice active={false} />);
    expect(codingApi.workspaceCleanup).not.toHaveBeenCalled();
    view.rerender(<WorkspaceCleanupNotice active />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(codingApi.workspaceCleanup).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
