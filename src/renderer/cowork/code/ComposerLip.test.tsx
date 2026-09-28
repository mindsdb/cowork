import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CodingEvent, CodingSession } from './api';
import { ComposerLip } from './ComposerLip';
import { accountFailure, failureNotice, messageNotice, pickNotice } from './composerNotices';


function session(overrides: Partial<CodingSession> = {}): CodingSession {
  return {
    schema_version: 1,
    id: 'task-1',
    title: 'Polish the checkout flow',
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'gpt-5.6-sol',
    permission_mode: 'supervised',
    status: 'failed',
    run_status: 'failed',
    source_path: '/work/shop',
    workspace_path: '/work/shop-cowork',
    workspace_kind: 'git_worktree',
    source_dirty: false,
    event_count: 1,
    created_at: '2026-08-21T09:00:00Z',
    updated_at: '2026-08-21T09:05:00Z',
    last_error: 'The turn failed.',
    ...overrides,
  };
}


function failure(code: string, detail: string, type: CodingEvent['type'] = 'error'): CodingEvent {
  return {
    schema_version: 1,
    seq: 1,
    timestamp: '2026-08-21T09:00:01Z',
    type,
    title: '',
    text: 'The turn failed.',
    phase: 'failed',
    data: type === 'session' ? { status: 'failed', code, detail } : { code, detail },
  };
}


function renderFailure(code: string, detail: string, task = session()) {
  const onChooseModel = vi.fn();
  const onAddCredits = vi.fn();
  const notice = failureNotice(accountFailure(task, undefined, failure(code, detail)), 'GPT 5.6 Sol');
  if (!notice) throw new Error(`no notice for ${code}`);
  const view = render(<ComposerLip notice={notice} onChooseModel={onChooseModel} onAddCredits={onAddCredits} onDismiss={vi.fn()} />);
  return { ...view, onChooseModel, onAddCredits };
}


describe('ComposerLip', () => {
  it('turns a credit failure into concise recovery actions with technical detail on demand', () => {
    const { onChooseModel, onAddCredits, container } = renderFailure('insufficient_credits', 'server returned 402 Payment Required');

    expect(screen.getByText('GPT 5.6 Sol needs credits')).toBeInTheDocument();
    expect(screen.getByText('Add credits or choose another model, then continue in this task.')).toBeInTheDocument();
    expect(container.querySelector('.code-composer-lip.is-danger')).not.toBeNull();
    expect(screen.queryByText(/server returned 402/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add credits' }));
    expect(onChooseModel).toHaveBeenCalledOnce();
    expect(onAddCredits).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('server returned 402 Payment Required')).toBeVisible();
  });

  it('reads the failure code from the terminal session event when the raw agent error carries none', () => {
    const task = session();
    const raw = { ...failure('', ''), data: {} };
    const notice = failureNotice(accountFailure(task, failure('insufficient_credits', '402', 'session'), raw), 'GPT 5.6 Sol');
    expect(notice?.title).toBe('GPT 5.6 Sol needs credits');
  });

  it('asks for a fresh sign-in when the model credential is rejected, with no invented sign-in action', () => {
    renderFailure('model_authentication_failed', 'server returned 401 Unauthorized');
    expect(screen.getByText('Your sign-in does not match this server')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add credits' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose model' })).toBeInTheDocument();
  });

  it('offers a model change when the chosen model is not available', () => {
    const { onChooseModel } = renderFailure('model_unavailable', 'server returned 404 model not found');
    expect(screen.getByText('GPT 5.6 Sol is not available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add credits' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    expect(onChooseModel).toHaveBeenCalledOnce();
  });

  it('shows a rate limit as a wait, not a failure, without offering a model change or credits', () => {
    const { container } = renderFailure('rate_limited', 'exceeded retry limit, last status: 429 Too Many Requests');
    expect(screen.getByText('MindsHub is receiving requests too quickly')).toBeInTheDocument();
    expect(container.querySelector('.code-composer-lip.is-warning')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add credits' })).not.toBeInTheDocument();
  });

  it.each([
    ['included_allowance_exhausted', 'Your included allowance is used up'],
    ['free_air_daily_spend_fuse_exceeded', 'Free MindsHub Air is paused'],
  ])('offers credits when %s blocks the turn until a reset', (code, title) => {
    const { onAddCredits } = renderFailure(code, 'upstream 429');
    expect(screen.getByText(title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add credits' }));
    expect(onAddCredits).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Choose model' })).toBeInTheDocument();
  });

  it('shows nothing for a limit once new work has started or while the task reopens', () => {
    const credits = failure('insufficient_credits', '402');
    expect(accountFailure(session({ status: 'running', run_status: 'running' }), undefined, credits)).toBeNull();
    expect(accountFailure(session({ run_status: 'recovering' }), undefined, credits)).toBeNull();
    expect(accountFailure(session(), undefined, credits, true)).toBeNull();
    expect(accountFailure(session(), undefined, failure('runtime_crashed', 'exit 137'))).toBeNull();
  });

  it('shows one notice at a time, most blocking first, and lets a warning be dismissed', () => {
    const blocked = failureNotice(accountFailure(session(), undefined, failure('insufficient_credits', '402')), 'GPT');
    const error = messageNotice('error', 'Could not send your message.');
    const workspace = messageNotice('workspace', 'The source folder has uncommitted changes.');
    expect(pickNotice([blocked, error, workspace], new Set())?.key).toBe(blocked?.key);
    expect(pickNotice([null, error, workspace], new Set())?.key).toBe(error?.key);
    expect(pickNotice([null, error, workspace], new Set([error!.key]))?.key).toBe(workspace?.key);

    const onDismiss = vi.fn();
    render(<ComposerLip notice={workspace!} onChooseModel={vi.fn()} onAddCredits={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith(workspace!.key);
  });
});
