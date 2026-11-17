import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScheduleNotifyMenu from './ScheduleNotifyMenu';

describe('ScheduleNotifyMenu', () => {
  it('shows which run endings notify, and toggles one', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ScheduleNotifyMenu prefs={{ failed: true, succeeded: false }} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Failed runs' })).toHaveAttribute('aria-checked', 'true');
    const succeeded = screen.getByRole('menuitemcheckbox', { name: 'Successful runs' });
    expect(succeeded).toHaveAttribute('aria-checked', 'false');
    await user.click(succeeded);
    expect(onChange).toHaveBeenCalledWith({ succeeded: true });
  });
});
