import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCollectionShortcut } from './useCollectionShortcut';

function Collection({ enabled = true, showInput = true }) {
  const ref = useRef(null);
  useCollectionShortcut(ref, enabled);
  return showInput ? <input ref={ref} aria-label="Collection search" /> : null;
}

describe('collection search shortcut routing', () => {
  it.each(['before', 'after'])('claims Cmd/Ctrl+K when the global listener mounts %s it', (order) => {
    // App's window listener opens global search without checking defaultPrevented.
    const openGlobalSearch = vi.fn();
    const onGlobalKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') openGlobalSearch();
    };
    if (order === 'before') window.addEventListener('keydown', onGlobalKey);
    const view = render(<Collection />);
    if (order === 'after') window.addEventListener('keydown', onGlobalKey);
    try {
      for (const modifier of ['metaKey', 'ctrlKey']) {
        screen.getByRole('textbox').blur();
        expect(fireEvent.keyDown(document.body, { key: 'k', [modifier]: true })).toBe(false);
        expect(screen.getByRole('textbox')).toHaveFocus();
      }
      expect(openGlobalSearch).not.toHaveBeenCalled();
      view.unmount();
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
      expect(openGlobalSearch).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', onGlobalKey);
    }
  });

  it.each([{ enabled: false }, { showInput: false }])('does not claim search when inactive: %j', props => {
    render(<Collection {...props} />);
    expect(fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })).toBe(true);
    expect(screen.queryByRole('textbox')).not.toBe(document.activeElement);
  });

  it.each([{ shiftKey: true }, { altKey: true }, { ctrlKey: false }])('leaves other shortcuts alone: %j', modifiers => {
    render(<Collection />);
    expect(fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true, ...modifiers })).toBe(true);
    expect(screen.getByRole('textbox')).not.toHaveFocus();
  });
});
