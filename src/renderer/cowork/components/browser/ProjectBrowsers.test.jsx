import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({
  fetchTaskBrowsers: vi.fn(),
  switchTaskTab: vi.fn(async () => ({ ok: true })),
  closeTaskTab: vi.fn(async () => ({ ok: true })),
  closeTaskBrowser: vi.fn(async () => ({ ok: true })),
}));

// eslint-disable-next-line import/first
import ProjectBrowsers from './ProjectBrowsers';
// eslint-disable-next-line import/first
import { closeTaskTab, fetchTaskBrowsers, switchTaskTab } from '../../api';

const tasks = [{ id: 'c1', title: 'Flights' }, { id: 'c2', title: 'Hotel' }, { id: 'c3', title: 'No browser' }];

beforeEach(() => {
  vi.clearAllMocks();
  fetchTaskBrowsers.mockResolvedValue({
    browsers: [
      {
        conversation_id: 'c1', session_id: 't-1', url: 'https://kayak.com/', viewers: 1, holder: 'agent',
        tabs: [
          { id: 't1', url: 'https://kayak.com/', title: 'Kayak', active: true },
          { id: 't2', url: 'https://tap.pt/', title: 'TAP', active: false },
        ],
        parked_tabs: [{ url: 'https://seatguru.com/', title: 'SeatGuru' }],
      },
      { conversation_id: 'c2', session_id: 't-2', url: 'https://booking.com/', viewers: 0, holder: 'agent', tabs: [], parked_tabs: [] },
    ],
  });
});

async function open(props = {}) {
  render(<ProjectBrowsers taskId="c1" tasks={tasks} {...props} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Browsers in this project' })); });
}

describe('ProjectBrowsers', () => {
  it("lists this task's tabs and saved tabs, and the project's other open browsers", async () => {
    const onReopen = vi.fn();
    await open({ onReopen });
    expect(fetchTaskBrowsers).toHaveBeenCalledWith(['c1', 'c2', 'c3']);
    expect(screen.getByText('Kayak · kayak.com')).toBeInTheDocument();
    expect(screen.getByText('Hotel')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('Reopen SeatGuru · seatguru.com')); });
    expect(onReopen).toHaveBeenCalledWith('https://seatguru.com/');
  });

  it('switches to a tab', async () => {
    await open();
    await act(async () => { fireEvent.click(screen.getByText('TAP · tap.pt')); });
    expect(switchTaskTab).toHaveBeenCalledWith('c1', 't2');
  });

  it('closes the side tabs, saving them', async () => {
    await open();
    await act(async () => { fireEvent.click(screen.getByText('Close the other tab (saved for later)')); });
    expect(closeTaskTab).toHaveBeenCalledWith('c1', 't2');
  });
});
