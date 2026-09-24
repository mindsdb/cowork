import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ComposerAddMenu } from './ComposerAddMenu';

describe('ComposerAddMenu', () => {
  it('opens the shared Add menu, toggles planning and closes', async () => {
    const user = userEvent.setup(), onPlanChange = vi.fn(), onAttach = vi.fn();
    render(<ComposerAddMenu disabled={false} onAttach={onAttach} onPlanChange={onPlanChange} />);
    await user.click(screen.getByRole('button', { name: 'Add to prompt' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    await user.click(screen.getByRole('menuitem', { name: 'Plan mode Turn plan mode on' }));
    expect(onPlanChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(onAttach).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('opens the existing attachment picker and returns focus on Escape', async () => {
    const user = userEvent.setup(), onAttach = vi.fn();
    render(<ComposerAddMenu disabled={false} onAttach={onAttach} onPlanChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Add to prompt' });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Files and folders' }));
    expect(onAttach).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await user.click(trigger);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps the active state visible and offers turning planning off', async () => {
    const user = userEvent.setup(), onPlanChange = vi.fn();
    render(<ComposerAddMenu disabled={false} onAttach={vi.fn()} onPlanChange={onPlanChange} planMode />);
    await user.click(screen.getByRole('button', { name: 'Add to prompt' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Plan mode Turn plan mode off' }));
    expect(onPlanChange).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole('button', { name: 'Turn plan mode off' }));
    expect(onPlanChange).toHaveBeenCalledTimes(2);
  });

  it('does not allow a mode change during an active turn but still allows attachments', async () => {
    const user = userEvent.setup();
    render(<ComposerAddMenu disabled={false} onAttach={vi.fn()} onPlanChange={vi.fn()} planDisabled />);
    await user.click(screen.getByRole('button', { name: 'Add to prompt' }));
    expect(await screen.findByRole('menuitem', { name: /Plan mode/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Files and folders' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('cannot open while busy', () => {
    render(<ComposerAddMenu disabled onAttach={vi.fn()} onPlanChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add to prompt' })).toBeDisabled();
  });
});
