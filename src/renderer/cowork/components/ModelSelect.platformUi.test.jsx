import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));

import { ModelSelect } from './ModelSelect';

it('retains models and disabled states without offering credits', async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  render(<ModelSelect
    value="sonnet"
    onValueChange={onValueChange}
    options={[
      { value: 'sonnet', label: 'Claude Sonnet 5' },
      { value: 'opus', label: 'Claude Opus 5', tag: 'Needs credits', disabled: true, locked: true },
      { value: 'restricted', label: 'Restricted model', tag: 'Restricted', disabled: true, restricted: true },
      { value: 'mindshub_air', label: 'MindsHub Air' },
    ]}
  />);
  await user.click(screen.getByRole('combobox'));
  const locked = screen.getByRole('option', { name: /Claude Opus 5/ });
  expect(locked).toHaveAttribute('aria-disabled', 'true');
  expect(within(locked).getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Restricted model/ })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.queryByText(/credits/i)).toBeNull();
  await user.click(locked);
  expect(onValueChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole('option', { name: 'MindsHub Air' }));
  expect(onValueChange).toHaveBeenCalledWith('mindshub_air');
});
