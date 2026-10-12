// Picks an option from a toolbar dropdown (a sort or filter pill) the way a
// user would: open the control named `trigger`, then choose the option they
// read as `option`. One place to adapt when the pill changes implementation:
// today's SortPill is a plain button that opens a list of buttons next to it;
// a listbox-based Select exposes a combobox and portalled options.
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

export async function pickOption(user: UserEvent, trigger: RegExp | string, option: string): Promise<void> {
  const combobox = screen.queryByRole('combobox', { name: trigger });
  if (combobox) {
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: option }));
    return;
  }
  const button = screen.getByRole('button', { name: trigger });
  await user.click(button);
  await user.click(within(button.parentElement as HTMLElement).getByRole('button', { name: option }));
}

// Text of every element matching one of `names`, in document order — reads a
// list's visible order without depending on its row markup.
export function orderOf(names: string[]): string[] {
  const set = new Set(names);
  return screen
    .getAllByText((_, el) => !!el && set.has(el.textContent ?? '') && ![...el.children].some((c) => set.has(c.textContent ?? '')))
    .map((el) => el.textContent ?? '');
}

// Opens the collection Filter menu at one facet's options. By keyboard:
// happy-dom drops pointer clicks inside Base UI submenus, which work in a
// real browser.
export async function openFilterFacet(user: UserEvent, facet: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: /^Filter/ }));
  screen.getByRole('menuitem', { name: new RegExp(`^${facet}`) }).focus();
  await user.keyboard('{ArrowRight}');
  await screen.findAllByRole('menuitemradio');
}

// Picks `option` under `facet` in the collection Filter menu.
export async function pickFilter(user: UserEvent, facet: string, option: string): Promise<void> {
  await openFilterFacet(user, facet);
  const options = screen.getAllByRole('menuitemradio');
  const target = options.findIndex((item) => item.textContent === option);
  if (target < 0) throw new Error(`No ${facet} option "${option}"`);
  const from = options.findIndex((item) => item === document.activeElement);
  for (let i = from; i < target; i++) await user.keyboard('{ArrowDown}');
  await user.keyboard('{Enter}');
}
