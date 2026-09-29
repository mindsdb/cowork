import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CodingEvent, CodingSession } from './api';
import { ComposerLip } from './ComposerLip';
import { accountFailure, failureNotice, messageNotice, pickNotice, recoveryNotice } from './composerNotices';


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
  const view = render(<ComposerLip notice={notice} onChooseModel={onChooseModel} onAddCredits={onAddCredits} onReopen={vi.fn()} onDismiss={vi.fn()} />);
  return { ...view, onChooseModel, onAddCredits };
}


describe('ComposerLip', () => {
  it('turns a credit failure into one recovery action, with the rest and technical detail on demand', async () => {
    const user = userEvent.setup();
    const { onChooseModel, onAddCredits, container } = renderFailure('insufficient_credits', 'server returned 402 Payment Required');

    expect(screen.getByText('GPT 5.6 Sol needs credits.')).toBeInTheDocument();
    expect(screen.getByText('Add credits or choose another model, then continue in this task.')).toBeInTheDocument();
    expect(container.querySelector('.code-composer-lip.is-danger')).not.toBeNull();
    expect(screen.queryByText(/server returned 402/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose model' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add credits' }));
    expect(onAddCredits).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Choose another model' }));
    expect(onChooseModel).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Show details' }));
    expect(screen.getByText('server returned 402 Payment Required')).toBeVisible();
  });

  it('shows a lone detail toggle as a plain button rather than a menu', () => {
    renderFailure('rate_limited', 'exceeded retry limit, last status: 429 Too Many Requests');
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/429 Too Many Requests/)).toBeVisible();
  });

  it('starts a title with a capital even when the model name does not', () => {
    const notice = failureNotice(accountFailure(session(), undefined, failure('insufficient_credits', '402')), 'gpt');
    expect(notice?.title).toBe('Gpt needs credits');
  });

  it('reads the failure code from the terminal session event when the raw agent error carries none', () => {
    const task = session();
    const raw = { ...failure('', ''), data: {} };
    const notice = failureNotice(accountFailure(task, failure('insufficient_credits', '402', 'session'), raw), 'GPT 5.6 Sol');
    expect(notice?.title).toBe('GPT 5.6 Sol needs credits');
  });

  it('asks for a fresh sign-in when the model credential is rejected, with no invented sign-in action', () => {
    renderFailure('model_authentication_failed', 'server returned 401 Unauthorized');
    expect(screen.getByText('Your sign-in does not match this server.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add credits' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose model' })).toBeInTheDocument();
  });

  it('offers a model change when the chosen model is not available', () => {
    const { onChooseModel } = renderFailure('model_unavailable', 'server returned 404 model not found');
    expect(screen.getByText('GPT 5.6 Sol is not available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add credits' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    expect(onChooseModel).toHaveBeenCalledOnce();
  });

  it('shows a rate limit as a wait, not a failure, without offering a model change or credits', () => {
    const { container } = renderFailure('rate_limited', 'exceeded retry limit, last status: 429 Too Many Requests');
    expect(screen.getByText('MindsHub is receiving requests too quickly.')).toBeInTheDocument();
    expect(container.querySelector('.code-composer-lip.is-warning')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add credits' })).not.toBeInTheDocument();
  });

  it.each([
    ['included_allowance_exhausted', 'Your included allowance is used up'],
    ['free_air_daily_spend_fuse_exceeded', 'Free MindsHub Air is paused'],
  ])('offers credits when %s blocks the turn until a reset', (code, title) => {
    const { onAddCredits } = renderFailure(code, 'upstream 429');
    expect(screen.getByText(`${title}.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add credits' }));
    expect(onAddCredits).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
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
    render(<ComposerLip notice={workspace!} onChooseModel={vi.fn()} onAddCredits={vi.fn()} onReopen={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith(workspace!.key);
  });

  function renderRecovery(task: CodingSession, latestError?: CodingEvent, recovering = false) {
    const onReopen = vi.fn();
    const notice = recoveryNotice(task, undefined, latestError, recovering);
    if (!notice) throw new Error('no recovery notice');
    render(<ComposerLip notice={notice} onChooseModel={vi.fn()} onAddCredits={vi.fn()} onReopen={onReopen} onDismiss={vi.fn()} />);
    return { notice, onReopen };
  }

  it('offers one Reopen task action when the task computer goes offline, with its error behind Details', () => {
    const { onReopen } = renderRecovery(
      session({ status: 'interrupted', run_status: 'interrupted', computer_status: 'offline', last_error: 'Computer disconnected' }),
      { ...failure('', ''), text: 'Computer disconnected', data: {} },
    );

    expect(screen.getByText('Task paused.')).toBeInTheDocument();
    expect(screen.getByText(/conversation is safe; reopen it there or choose another compatible computer/)).toBeInTheDocument();
    expect(screen.queryByText('Computer disconnected')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen task' }));
    expect(onReopen).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Computer disconnected')).toBeVisible();
  });

  it('says that reopening restores the copy but does not continue the interrupted turn', () => {
    renderRecovery(session({ status: 'interrupted', run_status: 'interrupted' }));

    expect(screen.getByText(/send a message to continue the interrupted work/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
  });

  it('keeps the generic paused-task recovery for failure codes it does not know', () => {
    const task = session();
    const unknown = failure('runtime_crashed', 'worker exited with code 137');
    expect(failureNotice(accountFailure(task, undefined, unknown), 'GPT 5.6 Sol')).toBeNull();
    renderRecovery(task, unknown);

    expect(screen.getByRole('button', { name: 'Reopen task' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose model' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('worker exited with code 137')).toBeVisible();
  });

  it('says a task whose workspace could not be prepared never started, with nothing to reopen', () => {
    renderRecovery(
      session({ workspace_path: '', last_error: 'The task workspace could not be prepared: disk is full' }),
      { ...failure('', ''), title: 'Task did not start', text: 'The task workspace could not be prepared: disk is full', data: {} },
    );

    expect(screen.getByText('Task did not start.')).toBeInTheDocument();
    expect(screen.getByText(/the agent never ran/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen task' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/disk is full/)).toBeVisible();
  });

  it('shows the reconnect in progress with the action held until it finishes', () => {
    renderRecovery(session({ status: 'interrupted', run_status: 'recovering' }));

    expect(screen.getByText('Reopening task.')).toBeInTheDocument();
    expect(screen.getByText('Reconnecting to the task files…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopening…' })).toBeDisabled();
  });

  it('leaves an account limit to its own notice rather than a paused-task one', () => {
    expect(recoveryNotice(session(), undefined, failure('insufficient_credits', '402'))).toBeNull();
    expect(recoveryNotice(session({ status: 'running', run_status: 'running' }), undefined, undefined)).toBeNull();
  });
});
