import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ApprovalCard from './ApprovalCard';

const resolveApproval = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ resolveApproval }));

const pendingAction = {
  id: 'ap-1',
  kind: 'action',
  status: 'pending',
  actionDescriptor: { tool: 'browser_click', args: { index: 3 }, summary: 'Send the reply to Abi' },
  draft: 'Thanks Abi — scope looks right.',
};

const pendingAuth = {
  id: 'ap-2',
  kind: 'auth',
  status: 'pending',
  actionDescriptor: { appName: 'Gmail', tabId: 'tab-9' },
  draft: '',
};

describe('ApprovalCard', () => {
  // No beforeEach clearing: mockClear/mockReset INSIDE beforeEach makes
  // vitest 4 flag the component's CAUGHT rejection as unhandled (verified —
  // in-test clearing is safe). Implementations are set per-test; call-count
  // assertions clear locally where they need a clean slate.

  it('pending action card shows Send/Edit/Skip and resolves approved', async () => {
    resolveApproval.mockResolvedValue({ approval: { ...pendingAction, status: 'approved' } });
    render(<ApprovalCard approval={pendingAction} />);
    expect(screen.getByText('Send the reply to Abi')).toBeTruthy();
    expect(screen.getByText('Needs you')).toBeTruthy();

    fireEvent.click(screen.getByText('Send it'));
    await waitFor(() => expect(resolveApproval).toHaveBeenCalledWith('ap-1', 'approved', undefined));
    await screen.findByText('Sent');
  });

  it('skip resolves as skipped with the learn-from-this copy nearby', async () => {
    resolveApproval.mockResolvedValue({ approval: { ...pendingAction, status: 'skipped' } });
    render(<ApprovalCard approval={pendingAction} />);
    fireEvent.click(screen.getByText('Skip'));
    await waitFor(() => expect(resolveApproval).toHaveBeenCalledWith('ap-1', 'skipped', undefined));
    await screen.findByText('Skipped');
  });

  it('edit modal resolves with the EDITED text', async () => {
    resolveApproval.mockResolvedValue({ approval: { ...pendingAction, status: 'edited' } });
    render(<ApprovalCard approval={pendingAction} />);
    fireEvent.click(screen.getByText('Edit'));
    const box = await screen.findByDisplayValue(/Thanks Abi/);
    fireEvent.change(box, { target: { value: 'rewritten by the user' } });
    fireEvent.click(screen.getByText('Send edited'));
    await waitFor(() => expect(resolveApproval).toHaveBeenCalledWith('ap-1', 'edited', 'rewritten by the user'));
  });

  it('auth card hands the tab over, never resolves directly', () => {
    resolveApproval.mockClear(); // this test asserts zero calls
    const onOpenTab = vi.fn();
    render(<ApprovalCard approval={pendingAuth} onOpenTab={onOpenTab} />);
    expect(screen.getByText('Sign in to Gmail')).toBeTruthy();
    fireEvent.click(screen.getByText('Open tab to sign in'));
    expect(onOpenTab).toHaveBeenCalledWith('tab-9');
    expect(resolveApproval).not.toHaveBeenCalled();
  });

  it('resolve failure surfaces inline and stays actionable', async () => {
    // mockImplementation over mockRejectedValue: vitest 4 flags
    // mockRejectedValue's rejection as unhandled in this environment even
    // though the component catches it (verified). A manual reject slips past.
    resolveApproval.mockImplementation(() => Promise.reject(new Error('HTTP 400')));
    render(<ApprovalCard approval={pendingAction} />);
    fireEvent.click(screen.getByText('Send it'));
    await screen.findByText('HTTP 400');
    expect(screen.getByText('Send it')).toBeTruthy(); // still pending, still clickable
  });
});
