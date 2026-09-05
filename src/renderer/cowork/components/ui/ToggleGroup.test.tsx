// Hide dividers adjoining the selection so they do not cut through its fill/shadow.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToggleGroup } from './ToggleGroup';

const OPTIONS = [
  { value: 'anton', label: 'Anton' },
  { value: 'hermes', label: 'Hermes' },
  { value: 'claude-code', label: 'Claude-Code' },
];

// Find decorative divider spans by role exclusion rather than adding a test id.
const dividers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[aria-hidden="true"]'));

describe('ToggleGroup — divider between options', () => {
  it('renders one fewer divider than there are options', () => {
    const { container } = render(
      <ToggleGroup value="anton" onValueChange={vi.fn()} options={OPTIONS} aria-label="Choose harness" />,
    );
    expect(dividers(container)).toHaveLength(OPTIONS.length - 1);
  });

  it('hides the divider on both sides of the selected option, shows the rest', () => {
    const { container } = render(
      <ToggleGroup value="hermes" onValueChange={vi.fn()} options={OPTIONS} aria-label="Choose harness" />,
    );
    const [antonHermes, hermesClaudeCode] = dividers(container);
    // hermes is selected — both its neighboring dividers (anton|hermes and
    // hermes|claude-code) touch it, so both are hidden.
    expect(antonHermes).toHaveStyle({ opacity: '0' });
    expect(hermesClaudeCode).toHaveStyle({ opacity: '0' });
  });

  it('shows a divider whose neither side is selected', () => {
    const { container } = render(
      <ToggleGroup value="claude-code" onValueChange={vi.fn()} options={OPTIONS} aria-label="Choose harness" />,
    );
    const [antonHermes, hermesClaudeCode] = dividers(container);
    // claude-code is selected — anton|hermes touches neither side of it.
    expect(antonHermes).toHaveStyle({ opacity: '1' });
    expect(hermesClaudeCode).toHaveStyle({ opacity: '0' });
  });

  it('moves the hidden divider as selection changes', async () => {
    const user = userEvent.setup();
    let value = 'anton';
    const onValueChange = vi.fn((v) => { value = v; });
    const { container, rerender } = render(
      <ToggleGroup value={value} onValueChange={onValueChange} options={OPTIONS} aria-label="Choose harness" />,
    );

    await user.click(screen.getByRole('button', { name: 'Claude-Code' }));
    rerender(
      <ToggleGroup value={value} onValueChange={onValueChange} options={OPTIONS} aria-label="Choose harness" />,
    );

    const [antonHermes, hermesClaudeCode] = dividers(container);
    expect(antonHermes).toHaveStyle({ opacity: '1' });
    expect(hermesClaudeCode).toHaveStyle({ opacity: '0' });
  });
});
