// The doc's tabs: one tab stop, arrows between tabs, and the rename box and
// options beside a tab rather than inside it.
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabRail, TabStrip, tabKeyTarget, useTabsHidden } from './DocTabs';

const tabs = [{ id: 't_1', title: 'Plan' }, { id: 't_2', title: 'Risks' }, { id: 't_3', title: 'Budget' }];

function Rail({ apply = vi.fn(), editable = true, ...rest }) {
  const [active, setActive] = useState('t_1');
  return <TabRail tabs={tabs} activeId={active} unseen={new Set(['t_3'])} editable={editable} onSelect={setActive} apply={apply} idBase="d" {...rest} />;
}

function Strip({ onAdd }) {
  const [active, setActive] = useState('t_1');
  return <TabStrip tabs={tabs} activeId={active} onSelect={setActive} idBase="d" onAdd={onAdd} />;
}

describe('tabKeyTarget', () => {
  it('moves along the tabs, wrapping, and jumps to the ends', () => {
    expect(tabKeyTarget('ArrowDown', 0, 3, true)).toBe(1);
    expect(tabKeyTarget('ArrowUp', 0, 3, true)).toBe(2);
    expect(tabKeyTarget('ArrowRight', 2, 3, false)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 1, 3, false)).toBe(0);
    expect(tabKeyTarget('Home', 2, 3, true)).toBe(0);
    expect(tabKeyTarget('End', 0, 3, false)).toBe(2);
  });

  it('leaves other keys, and the other axis, alone', () => {
    expect(tabKeyTarget('ArrowRight', 0, 3, true)).toBeNull();
    expect(tabKeyTarget('ArrowDown', 0, 3, false)).toBeNull();
    expect(tabKeyTarget('a', 0, 3, true)).toBeNull();
  });
});

describe('TabStrip', () => {
  it('is one tab stop, and the arrows open the next tab', async () => {
    const user = userEvent.setup();
    render(<Strip />);
    const [plan, risks, budget] = screen.getAllByRole('tab');
    expect([plan, risks, budget].map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    plan.focus();
    await user.keyboard('{ArrowRight}');
    expect(risks).toHaveFocus();
    expect(risks).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(budget).toHaveFocus();
    expect(budget.tabIndex).toBe(0);
    await user.click(plan);
    expect(plan).toHaveAttribute('aria-selected', 'true');
    expect(plan).toHaveAttribute('aria-controls', 'd-panel');
  });

  it('adds a tab from its +, beside the tabs, for an editor only', async () => {
    const onAdd = vi.fn();
    const { unmount } = render(<Strip onAdd={onAdd} />);
    expect(within(screen.getByRole('tablist')).queryByRole('button', { name: 'Add tab' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    unmount();
    render(<Strip />);
    expect(screen.queryByRole('button', { name: 'Add tab' })).toBeNull();
  });
});

describe('TabRail', () => {
  it('holds only tabs in its tabs; options and the changed dot sit beside them', () => {
    render(<Rail />);
    const list = screen.getByRole('tablist', { name: 'Tabs' });
    expect(list).toHaveAttribute('aria-orientation', 'vertical');
    for (const tab of within(list).getAllByRole('tab')) {
      expect(within(tab).queryByRole('button')).toBeNull();
      expect(within(tab).queryByRole('textbox')).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Risks options' })).toBeInTheDocument();
    expect(screen.getByLabelText('Changed')).toBeInTheDocument();
  });

  it('moves between tabs with the arrows', async () => {
    const user = userEvent.setup();
    render(<Rail />);
    const [plan, risks] = screen.getAllByRole('tab');
    plan.focus();
    await user.keyboard('{ArrowDown}');
    expect(risks).toHaveFocus();
    expect(risks).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('tab', { name: 'Budget' })).toHaveFocus();
  });

  it('renames a tab from F2, in a box beside the tabs', async () => {
    const user = userEvent.setup();
    const apply = vi.fn();
    render(<Rail apply={apply} />);
    screen.getByRole('tab', { name: 'Risks' }).focus();
    await user.keyboard('{F2}');
    const box = screen.getByRole('textbox', { name: 'Tab name' });
    await user.clear(box);
    await user.type(box, 'Open risks{Enter}');
    expect(apply).toHaveBeenCalledWith([{ op: 'rename_tab', tab: 't_2', title: 'Open risks' }]);
  });

  it('renames on a double-click, and not for a reader', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Rail />);
    await user.dblClick(screen.getByRole('tab', { name: 'Plan' }));
    expect(screen.getByRole('textbox', { name: 'Tab name' })).toHaveValue('Plan');
    unmount();
    render(<Rail editable={false} />);
    screen.getByRole('tab', { name: 'Plan' }).focus();
    await user.keyboard('{F2}');
    expect(screen.queryByRole('textbox', { name: 'Tab name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Plan options' })).toBeNull();
  });

  it('moves and deletes a tab from its options', async () => {
    const user = userEvent.setup();
    const apply = vi.fn();
    render(<Rail apply={apply} />);
    await user.click(screen.getByRole('button', { name: 'Risks options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }));
    expect(apply).toHaveBeenLastCalledWith([{ op: 'move_tab', tab: 't_2', index: 1 }]); // first, counted from 1
    await user.click(screen.getByRole('button', { name: 'Plan options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }));
    expect(apply).toHaveBeenLastCalledWith([{ op: 'move_tab', tab: 't_1', index: 2 }]);
    await user.click(screen.getByRole('button', { name: 'Plan options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete tab' }));
    expect(apply).toHaveBeenLastCalledWith([{ op: 'delete_tab', tab: 't_1' }]);
    expect(screen.getByRole('tab', { name: 'Risks' })).toHaveAttribute('aria-selected', 'true');
  });

  it('adds a tab and opens it to be named', async () => {
    const user = userEvent.setup();
    const added = { id: 't_4', title: 'Untitled' };
    let addTab;
    const apply = vi.fn(async () => { addTab(); return { doc: { tabs: [...tabs, added] } }; });
    function Added() {
      const [all, setAll] = useState(tabs);
      const [active, setActive] = useState('t_1');
      addTab = () => setAll([...tabs, added]);
      return <TabRail tabs={all} activeId={active} unseen={new Set()} editable onSelect={setActive} apply={apply} idBase="d" />;
    }
    render(<Added />);
    await user.click(screen.getByRole('button', { name: /Add tab/ }));
    expect(apply).toHaveBeenCalledWith([{ op: 'add_tab', title: 'Untitled' }]);
    expect(await screen.findByRole('textbox', { name: 'Tab name' })).toHaveValue('Untitled');
  });
});


describe('folding the rail away', () => {
  it('hides it from its own button, and a folded rail is out of reach of keys and readers', async () => {
    const onHide = vi.fn();
    const { rerender } = render(<Rail onHide={onHide} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide tabs' }));
    expect(onHide).toHaveBeenCalledTimes(1);
    rerender(<Rail onHide={onHide} hidden />);
    const rail = document.querySelector('.doc-tabs');
    expect(rail).toHaveAttribute('data-hidden');
    expect(rail).toHaveAttribute('aria-hidden', 'true');
    expect(rail.inert).toBe(true);
  });

  it('offers no fold without somewhere to unfold it from', () => {
    render(<Rail />);
    expect(screen.queryByRole('button', { name: 'Hide tabs' })).toBeNull();
  });

  it('remembers the fold for the next doc, and gets by without storage', () => {
    localStorage.removeItem('cowork:doc-tabs-hidden:v1');
    const first = renderHook(() => useTabsHidden());
    expect(first.result.current[0]).toBe(false);
    act(() => first.result.current[1](true));
    expect(first.result.current[0]).toBe(true);
    expect(renderHook(() => useTabsHidden()).result.current[0]).toBe(true);

    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const blocked = renderHook(() => useTabsHidden());
    expect(blocked.result.current[0]).toBe(false);
    act(() => blocked.result.current[1](true));
    expect(blocked.result.current[0]).toBe(true);
    getItem.mockRestore();
    setItem.mockRestore();
    localStorage.removeItem('cowork:doc-tabs-hidden:v1');
  });
});
