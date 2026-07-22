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

  it('renders the current option label in the trigger', () => {
    render(<Harness initial="date" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Date');
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

  it('prefixes the pill variant with its label', () => {
    render(<Harness variant="pill" label="Sort by" initial="date" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Sort by:Date');
  });
});
