import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NoticeBell, { badgeText } from './NoticeBell';

const notices = [
  { id: 'a', kind: 'scheduled_run.failed', subject: 'Weekly digest', target: { scheduleId: 's1' }, createdAt: new Date().toISOString(), readAt: null },
  { id: 'b', kind: 'scheduled_run.succeeded', subject: 'Inbox sweep', target: { scheduleId: 's2' }, createdAt: new Date().toISOString(), readAt: new Date().toISOString() },
  { id: 'c', kind: 'something.new', subject: 'Later kind', target: null, createdAt: new Date().toISOString(), readAt: null },
];

function renderBell(props = {}) {
  const handlers = { showList: vi.fn(), openNotice: vi.fn(), markAllRead: vi.fn() };
  render(<NoticeBell available unreadCount={2} notices={notices} listStatus="ready" {...handlers} {...props} />);
  return handlers;
}

describe('NoticeBell', () => {
  it('draws nothing on a server without notices', () => {
    const { container } = render(<NoticeBell available={false} unreadCount={3} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the unread count, and says it in the label', () => {
    renderBell();
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
    expect(screen.getByTestId('notice-badge')).toHaveTextContent('2');
    expect(badgeText(120)).toBe('99+');
  });

  it('has no badge when everything is read', () => {
    renderBell({ unreadCount: 0 });
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByTestId('notice-badge')).toBeNull();
  });

  it('reads the list on opening and lists the notices, a new kind included', async () => {
    const user = userEvent.setup();
    const { showList } = renderBell();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(showList).toHaveBeenCalledTimes(1);
    const items = await screen.findAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Unread: Scheduled task “Weekly digest” didn’t finish its last run.');
    expect(items[1]).toHaveTextContent('Scheduled task “Inbox sweep” finished a run.');
    expect(items[1]).not.toHaveTextContent('Unread');
    expect(items[2]).toHaveTextContent('New notification: Later kind');
  });

  it('opens a notice on click', async () => {
    const user = userEvent.setup();
    const { openNotice } = renderBell();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Weekly digest/ }));
    expect(openNotice).toHaveBeenCalledWith(notices[0]);
  });

  it('shows the supplied summary for an unfamiliar notice kind', async () => {
    const user = userEvent.setup();
    renderBell({ notices: [{
      ...notices[2],
      fallback: { summary: 'A task is waiting for approval.' },
    }] });
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect((await screen.findAllByRole('menuitem'))[0]).toHaveTextContent('A task is waiting for approval.');
  });

  it('marks all read', async () => {
    const user = userEvent.setup();
    const { markAllRead } = renderBell();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mark all read' }));
    expect(markAllRead).toHaveBeenCalledTimes(1);
  });

  it('says so quietly when there is nothing', async () => {
    const user = userEvent.setup();
    renderBell({ notices: [], unreadCount: 0 });
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('No notifications')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark all read' })).toBeNull();
  });
});
