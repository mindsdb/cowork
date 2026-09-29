import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox } from './Combobox';

const FIVE = ['low', 'medium', 'high', 'xhigh', 'max'].map((v) => ({ value: v, label: v }));
const THREE = FIVE.slice(0, 3);

function Harness({ value, items, onValueChange = vi.fn(), ...rest }) {
  return (
    <Combobox
      value={value}
      onValueChange={onValueChange}
      groups={[{ key: 'g', name: null, items }]}
      ariaLabel="Effort"
      {...rest}
    />
  );
}

describe('Combobox', () => {
  it('fires onValueChange with the picked id, not the item object', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness value="low" items={FIVE} onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Effort' }));
    await user.click(screen.getByRole('option', { name: 'high' }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('high');
  });

  // ENG-2416: Select needed a null guard for this case; Combobox does not.
  // Pinned so a Base UI bump that changes that fails here.
  it('does not fire onValueChange when options shrink under the value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(<Harness value="max" items={FIVE} onValueChange={onValueChange} />);

    // Open and close once so the popup is mounted, as in the Select case.
    await user.click(screen.getByRole('combobox', { name: 'Effort' }));
    await user.keyboard('{Escape}');
    rerender(<Harness value="high" items={THREE} onValueChange={onValueChange} />);

    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Effort' })).toHaveTextContent('high');
  });

  it('keeps showing a value that is no longer in the list', () => {
    render(<Harness value="max" items={THREE} />);
    expect(screen.getByRole('combobox', { name: 'Effort' })).toHaveTextContent('max');
  });
});
