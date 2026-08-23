import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { RenameTaskModal } from './RenameTaskModal';


it('preserves the entered name and explains a failed rename', async () => {
  const user = userEvent.setup();
  const onRename = vi.fn(async () => { throw new Error('Name could not be saved'); });
  render(
    <RenameTaskModal
      open
      title="Old task"
      busy={false}
      onClose={vi.fn()}
      onRename={onRename}
    />,
  );

  const input = screen.getByRole('textbox', { name: 'Task name' });
  await user.clear(input);
  await user.type(input, 'Better task');
  await user.click(screen.getByRole('button', { name: 'Rename' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Name could not be saved');
  expect(input).toHaveValue('Better task');
});
