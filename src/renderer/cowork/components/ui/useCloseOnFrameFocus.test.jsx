// A click into the artifact preview (an iframe) closes the viewer's popups
// (ENG-4227): the window blurs with the iframe as the active element.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Select from './Select.jsx';
import { Combobox } from './Combobox';
import { Menu } from './Menu.jsx';

function withFrame(ui) {
  return (
    <>
      {ui}
      <iframe title="Preview" />
    </>
  );
}

async function focusFrame() {
  const frame = screen.getByTitle('Preview');
  await act(async () => {
    frame.focus();
    fireEvent.blur(window);
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  });
}

describe('popups close when focus moves into an iframe', () => {
  it('closes an open Select', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(withFrame(<Select value="a" onValueChange={vi.fn()} onOpenChange={onOpenChange} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} ariaLabel="Pick" />));
    await user.click(screen.getByRole('combobox', { name: 'Pick' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    await focusFrame();

    expect(onOpenChange).toHaveBeenLastCalledWith(false, { reason: 'frame-focus' });
    expect(screen.getByRole('combobox', { name: 'Pick' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes an open Combobox (the model picker)', async () => {
    const user = userEvent.setup();
    render(withFrame(<Combobox value="m1" onValueChange={vi.fn()} groups={[{ key: 'g', name: null, items: [{ value: 'm1', label: 'Model one' }] }]} ariaLabel="Choose model" />));
    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    expect(await screen.findByRole('option', { name: /Model one/ })).toBeInTheDocument();

    await focusFrame();

    expect(screen.getByRole('combobox', { name: 'Choose model' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes a trigger Menu (the ⋯ menu)', async () => {
    const user = userEvent.setup();
    render(withFrame(<Menu ariaLabel="More" trigger={<button type="button">More</button>} items={[{ label: 'Reload', onClick: vi.fn() }]} />));
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    await focusFrame();

    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('leaves a popup open when the window blurs to something that is not an iframe', async () => {
    const user = userEvent.setup();
    render(<Select value="a" onValueChange={vi.fn()} options={[{ value: 'a', label: 'A' }]} ariaLabel="Pick" />);
    await user.click(screen.getByRole('combobox', { name: 'Pick' }));
    await screen.findByRole('listbox');

    await act(async () => {
      fireEvent.blur(window);
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    });

    expect(screen.getByRole('combobox', { name: 'Pick' })).toHaveAttribute('aria-expanded', 'true');
  });
});
