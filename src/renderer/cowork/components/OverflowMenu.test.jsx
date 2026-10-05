import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OverflowMenu } from './OverflowMenu';


describe('OverflowMenu', () => {
  it('is a ghost icon button whose title shows as a tooltip and which still opens the menu', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<OverflowMenu label="Task actions" title="More for this task" items={[{ label: 'Rename', onClick: onRename }]} />);

    const trigger = screen.getByRole('button', { name: 'Task actions' });
    expect(trigger).toHaveClass('btn', 'subtle', 'icon', 'xxs');
    expect(trigger).not.toHaveAttribute('title');
    await user.hover(trigger);
    expect(await screen.findByText('More for this task')).toBeInTheDocument();

    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledOnce();
  });

  it('keeps trigger clicks from reaching the row it sits in, unless told otherwise', () => {
    const onRow = vi.fn();
    const onTriggerClick = vi.fn();
    const { rerender } = render(<div onClick={onRow}><OverflowMenu items={[{ label: 'Rename' }]} onTriggerClick={onTriggerClick} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(onTriggerClick).toHaveBeenCalledOnce();
    expect(onRow).not.toHaveBeenCalled();

    rerender(<div onClick={onRow}><OverflowMenu items={[{ label: 'Rename' }]} stopPropagation={false} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(onRow).toHaveBeenCalledOnce();
  });

  it('passes size and disabled through to the trigger', () => {
    render(<OverflowMenu items={[{ label: 'Rename' }]} size="sm" disabled />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger).toHaveClass('sm');
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
  });

  it('stays focusable while disabled but does not open', async () => {
    const user = userEvent.setup();
    render(<OverflowMenu items={[{ label: 'Rename' }]} disabled />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    trigger.focus();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
  });
});
