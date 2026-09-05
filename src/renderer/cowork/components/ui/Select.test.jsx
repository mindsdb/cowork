import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './Select';

const OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Date' },
  { separator: true },
  { value: 'locked', label: 'Locked', disabled: true },
];

function Harness({ initial = 'name', options = OPTIONS, ...rest }) {
  const onValueChange = rest.onValueChange || vi.fn();
  return <Select value={initial} onValueChange={onValueChange} options={options} {...rest} />;
}

describe('Select', () => {
  it('opens the popup and lists its options on trigger click', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Locked' })).toBeInTheDocument();
  });

  it('fires onValueChange with the picked value, not an event', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Date' }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('date');
  });

  it('does not fire onValueChange when a disabled option is clicked', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Locked' }));

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('shows the placeholder when no value is selected', () => {
    render(<Harness initial={null} placeholder="Pick one…" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Pick one…');
  });

  // happy-dom cannot resolve the placeholder color; assert its data attribute/class and their
  // absence on a selected value.
  it('marks the value span as a placeholder (muted) only when nothing is selected', () => {
    const { rerender } = render(<Harness initial={null} placeholder="Pick one…" />);
    const valueSpan = document.querySelector('span[data-placeholder]');
    expect(valueSpan).not.toBeNull();
    expect(valueSpan.textContent).toBe('Pick one…');
    expect(valueSpan.className).toContain('data-[placeholder]:text-ink-4');

    rerender(<Harness initial="date" placeholder="Pick one…" />);
    expect(document.querySelector('span[data-placeholder]')).toBeNull();
  });

  it('renders the current option label in the trigger', () => {
    render(<Harness initial="date" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Date');
  });

  // Base UI renders an empty-string selection as placeholder even if that option is checked.
  // Preserve nonempty sentinels for real All/No projects values.
  it('shows the placeholder for an empty-string value even when a value="" option exists', () => {
    render(
      <Harness
        initial=""
        placeholder="Pick one…"
        options={[{ value: '', label: 'All projects' }, ...OPTIONS]}
      />,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Pick one…');
    expect(trigger).not.toHaveTextContent('All projects');
  });

  // Complement to the above: a non-empty sentinel value DOES resolve to its
  // label, which is why the call sites switched from '' to '__all_projects__'.
  it('renders the label for a non-empty sentinel value', () => {
    render(
      <Harness
        initial="__all_projects__"
        options={[{ value: '__all_projects__', label: 'All projects' }, ...OPTIONS]}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('All projects');
  });

  it('sets aria-invalid on the trigger when invalid', () => {
    render(<Harness invalid />);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });

  // Preflight is off; border-solid overrides the button's UA outset border.
  // happy-dom cannot expose that UA styling, so guard the class.
  it('keeps border-solid on the trigger so the border is not UA-default outset', () => {
    render(<Harness />);
    expect(screen.getByRole('combobox').className).toContain('border-solid');
  });

  // Preflight is off; popup divs need border-solid or their border width collapses under UA
  // border-style:none.
  it('renders the popup with a solid border so it is visible against the background', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    const popup = document.querySelector('.shadow-sh-popup');
    expect(popup).not.toBeNull();
    expect(popup.className).toContain('border-solid');
    expect(popup.className).toContain('border-line');
  });

  it('lets a compact trigger keep a wider menu through menuMinWidth', async () => {
    const user = userEvent.setup();
    render(<Harness menuMinWidth={280} />);
    await user.click(screen.getByRole('combobox'));
    expect(document.querySelector('.shadow-sh-popup').style.minWidth).toBe('280px');
  });

  it('renders a separator between option groups', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  // Option icons belong in the popup rows; the closed trigger shows only the label.
  it('renders a leading icon on an option when provided', async () => {
    const user = userEvent.setup();
    const options = [
      { value: 'all', label: 'All projects', icon: <svg data-testid="opt-icon" /> },
      { separator: true },
      { value: 'analytics', label: 'analytics' },
    ];
    render(<Harness initial="all" options={options} />);

    // Not in the closed trigger.
    expect(screen.getByRole('combobox')).not.toContainElement(screen.queryByTestId('opt-icon'));

    await user.click(screen.getByRole('combobox'));
    const icon = screen.getByTestId('opt-icon');
    expect(icon).toBeInTheDocument();
    expect(icon.closest('[role="option"]')).toHaveTextContent('All projects');
  });

  it('supports a concise trigger with richer detail in the open menu', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial="remote"
        options={[{
          value: 'remote',
          label: 'Build computer',
          triggerLabel: 'Build computer',
          description: 'Linux · Ready',
          meta: 'Remote',
        }]}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('Build computer');
    expect(screen.queryByText('Linux · Ready')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /Build computer/ })).toHaveTextContent('Linux · Ready');
    expect(screen.getByText('Remote')).toBeInTheDocument();
  });

  it('prefixes the pill variant with its label', () => {
    render(<Harness variant="pill" label="Sort by" initial="date" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Sort by:Date');
  });

  it('lets domain controls reuse an established trigger treatment', () => {
    render(<Harness variant="unstyled" className="meta-pill" ariaLabel="Quiet picker" />);
    const trigger = screen.getByRole('combobox', { name: 'Quiet picker' });
    expect(trigger).toHaveClass('meta-pill');
    expect(trigger).not.toHaveClass('border-solid');
    expect(trigger.querySelector('.lucide-chevrons-up-down')).toBeInTheDocument();
  });

  it('shows a concise menu title only while the picker is open', async () => {
    const user = userEvent.setup();
    render(<Harness menuLabel="Permissions" ariaLabel="Coding permissions" />);

    expect(screen.queryByText('Permissions')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Coding permissions' }));

    expect(screen.getByText('Permissions')).toBeInTheDocument();
  });
});
