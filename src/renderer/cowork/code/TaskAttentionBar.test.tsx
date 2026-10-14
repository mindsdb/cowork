import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodingSession } from './api';
import { TaskAttentionBar } from './TaskAttentionBar';
import { newAttention } from './taskAttention';

const mocks = vi.hoisted(() => ({ sessions: vi.fn(), visible: true }));
vi.mock('./api', () => ({ codingApi: { sessions: mocks.sessions } }));
vi.mock('./useAppVisible', () => ({ isAppVisible: () => mocks.visible }));

const task = { id: 'task', status: 'running', event_count: 1 } as CodingSession;
class Notice {
  static permission = 'granted';
  static requestPermission = vi.fn(async () => 'granted');
  static items: Notice[] = [];
  onclick?: () => void;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) { Notice.items.push(this); }
}
const props = { sessions: [task], selectedId: 'task', active: true, scopeKey: 'ian', onSelect: vi.fn() };
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(5000); });
const enable = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Notify when away' })); });

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); Notice.items = []; Notice.permission = 'granted'; mocks.visible = true;
  mocks.sessions.mockResolvedValue({ items: [task] });
  vi.stubGlobal('Notification', Notice);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Task attention and notifications', () => {
  it('does not replay restored failures, plans, or unchanged history as new alerts', () => {
    const failed = { ...task, status: 'failed' as const };
    expect(newAttention(undefined, failed)).toBeNull();
    expect(newAttention(failed, { ...failed, event_count: 50 })).toBeNull();
    expect(newAttention(task, { ...task, task_mode: 'plan', status: 'completed' })).toBe('A plan is ready for your review.');
    expect(newAttention(task, { ...task, status: 'completed' })).toBe('A coding task has finished.');
    expect(newAttention(task, { ...failed, archived: true })).toBeNull();
  });

  it('navigates to another task that needs input', () => {
    render(<TaskAttentionBar {...props} sessions={[task, { ...task, id: 'other', status: 'failed' }]} />);
    fireEvent.click(screen.getByRole('button', { name: '1 task needs you →' }));
    expect(props.onSelect).toHaveBeenCalledWith('other');
  });

  it('requires opt-in, stays quiet while visible, and opens the task from a private alert', async () => {
    render(<TaskAttentionBar {...props} />);
    await tick(); expect(mocks.sessions).not.toHaveBeenCalled();
    await enable(); await tick(); expect(mocks.sessions).not.toHaveBeenCalled();
    mocks.visible = false;
    mocks.sessions.mockResolvedValue({ items: [{ ...task, title: 'PRIVATE CUSTOMER', status: 'completed' }] });
    await tick();
    expect(Notice.items).toHaveLength(1);
    expect(Notice.items[0].options.body).toBe('A coding task has finished.');
    Notice.items[0].onclick?.();
    expect(props.onSelect).toHaveBeenCalledWith(task.id);
    await tick(); expect(Notice.items).toHaveLength(1);
  });

  it('continues monitoring when the user switches to Cowork and closes alerts when disabled', async () => {
    const view = render(<TaskAttentionBar {...props} />);
    await enable();
    view.rerender(<TaskAttentionBar {...props} active={false} />);
    mocks.sessions.mockResolvedValue({ items: [{ ...task, status: 'failed' }] });
    await tick(); expect(Notice.items).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications on' }));
    expect(Notice.items[0].close).toHaveBeenCalled();
    const calls = mocks.sessions.mock.calls.length;
    await tick(); expect(mocks.sessions).toHaveBeenCalledTimes(calls);
  });

  it('fences an in-flight poll when accounts change and does not overlap slow requests', async () => {
    let resolve!: (value: { items: CodingSession[] }) => void;
    mocks.sessions.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = render(<TaskAttentionBar {...props} />);
    await enable(); mocks.visible = false; await tick(); await tick();
    expect(mocks.sessions).toHaveBeenCalledTimes(1);
    view.rerender(<TaskAttentionBar {...props} scopeKey="another-user" sessions={[]} />);
    await act(async () => { resolve({ items: [{ ...task, status: 'failed' }] }); });
    expect(Notice.items).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Notify when away' })).toBeInTheDocument();
  });

  it('explains denied permission without enabling alerts', async () => {
    Notice.permission = 'denied';
    render(<TaskAttentionBar {...props} />); await enable();
    expect(screen.getByRole('status')).toHaveTextContent('Allow MindsHub notifications');
    mocks.visible = false; await tick(); expect(mocks.sessions).not.toHaveBeenCalled();
  });

  it('ignores a permission response after changing accounts', async () => {
    Notice.permission = 'default';
    let resolve!: (value: string) => void;
    Notice.requestPermission.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<TaskAttentionBar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notify when away' }));
    view.rerender(<TaskAttentionBar {...props} scopeKey="someone-else" sessions={[]} />);
    await act(async () => { resolve('granted'); });
    expect(screen.queryByRole('button', { name: 'Notifications on' })).not.toBeInTheDocument();
  });
});
