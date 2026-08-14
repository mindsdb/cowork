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

  // Regression: an unselected control must read as a prompt, not a value. Base
  // UI stamps `data-placeholder` on the value span when nothing is selected;
  // we mute it via `data-[placeholder]:text-ink-4`. happy-dom can't compute the
  // resolved color, so guard the attribute + class that carry the cue — and
  // assert a selected value is NOT flagged as a placeholder.
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

  // Regression (ENG-1246): Base UI's <Select.Value> treats an empty-string
  // value as "nothing selected" and renders the placeholder, even when an
  // option with value '' exists. Call sites that need a real "All projects" /
  // "No project" catch-all must therefore give it a NON-empty sentinel value —
  // an option valued '' shows the placeholder on the closed control while its
  // item still carries a checkmark, which is exactly the display bug. This test
  // pins that behavior so the sentinel workaround isn't "simplified" away.
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

  // Regression: preflight is disabled, so an explicit `border-solid` is the
  // only thing overriding the trigger <button>'s UA-default `border-style:
  // outset` (which rendered as a beveled/uneven 1px border in Chromium).
  // happy-dom doesn't apply the UA default, so we can't assert the computed
  // style here — guard the class that carries the fix instead.
  it('keeps border-solid on the trigger so the border is not UA-default outset', () => {
    render(<Harness />);
    expect(screen.getByRole('combobox').className).toContain('border-solid');
  });

  // Regression: the popup must keep a visible border. It's a <div>, and
  // preflight is disabled, so a bare `border` leaves border-style at the UA
  // default `none` (border-width collapses to 0 → no border). Without it the
  // borderless popup all but disappears on a light surface (only a soft
  // shadow separates it). Target the popup via its unique `shadow-sh-popup`
  // class — the trigger also carries `border-solid`.
  it('renders the popup with a solid border so it is visible against the background', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    const popup = document.querySelector('.shadow-sh-popup');
    expect(popup).not.toBeNull();
    expect(popup.className).toContain('border-solid');
    expect(popup.className).toContain('border-line');
  });

  it('renders a separator between option groups', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  // A leading option `icon` renders inside the open list item (used to set a
  // mode entry like "All projects" apart from the real options) but is not
  // echoed into the closed trigger, which shows only the label.
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

  it('prefixes the pill variant with its label', () => {
    render(<Harness variant="pill" label="Sort by" initial="date" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Sort by:Date');
  });
});
