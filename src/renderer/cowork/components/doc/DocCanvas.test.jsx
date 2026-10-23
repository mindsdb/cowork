// DocCanvas keyboard editing, end to end over a local copy of the doc: the
// keys that cross block boundaries, the Markdown shortcuts, the slash menu and
// the selection bar. The decisions themselves are tested in canvasOps.test.js.
import { useState } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocCanvas from './DocCanvas';
import { COMMIT_MS } from './EditableText';
import { applyLocal } from './docModel';

const docWith = (blocks, title = 'Plan') => ({
  schema: 'cowork.doc/1', id: 'd', title, rev: 1, tabs: [{ id: 't_1', title, blocks }],
});

/** The canvas over a doc that applies its own ops, as useDoc does. */
function Live({ initial, onOps, ...props }) {
  const [doc, setDoc] = useState(initial);
  const apply = (ops, opts) => {
    onOps?.(ops);
    setDoc((d) => applyLocal(d, ops, opts) || d);
    return Promise.resolve(null);
  };
  return <DocCanvas doc={doc} tab={doc.tabs[0]} editable apply={apply} {...props} />;
}

function caretAt(el, offset) {
  const range = document.createRange();
  range.setStart(el.firstChild || el, offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function select(el, start, end) {
  const range = document.createRange();
  range.setStart(el.firstChild, start);
  range.setEnd(el.firstChild, end);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  act(() => { document.dispatchEvent(new Event('selectionchange')); });
}

afterEach(() => { window.getSelection().removeAllRanges(); });

const blockIds = () => [...document.querySelectorAll('[data-block-id]')].map((el) => el.dataset.blockId);

describe('DocCanvas keys', () => {
  it('Enter at the end of a paragraph starts a new one below and moves there', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: 'Hello' }])} onOps={onOps} />);
    await user.type(screen.getByRole('textbox', { name: 'Paragraph' }), '{Enter}');
    const [update, insert] = onOps.mock.calls.at(-1)[0];
    expect(update).toEqual({ op: 'update', id: 'b_1', set: { text: 'Hello' } });
    expect(insert).toMatchObject({ op: 'insert', position: { after: 'b_1' }, blocks: [{ type: 'paragraph', text: '' }] });
    expect(blockIds()).toEqual(['b_1', insert.blocks[0].id]);
    expect(document.activeElement.closest('[data-block-id]').dataset.blockId).toBe(insert.blocks[0].id);
  });

  it('Backspace at the start of a paragraph joins it to the one above', () => {
    const onOps = vi.fn();
    render(<Live initial={docWith([
      { id: 'b_1', type: 'paragraph', text: 'One' },
      { id: 'b_2', type: 'paragraph', text: 'Two' },
    ])} onOps={onOps} />);
    const two = screen.getByText('Two');
    two.focus();
    caretAt(two, 0);
    fireEvent.keyDown(two, { key: 'Backspace' });
    expect(onOps).toHaveBeenLastCalledWith([
      { op: 'update', id: 'b_1', set: { text: 'OneTwo' } },
      { op: 'delete', target: ['b_2'] },
    ]);
    expect(blockIds()).toEqual(['b_1']);
    expect(screen.getByText('OneTwo')).toBe(document.activeElement);
  });

  it('does not save the joined paragraph\'s typing again once it is gone', () => {
    vi.useFakeTimers();
    try {
      const onOps = vi.fn();
      render(<Live initial={docWith([
        { id: 'b_1', type: 'paragraph', text: 'One' },
        { id: 'b_2', type: 'paragraph', text: 'Two' },
      ])} onOps={onOps} />);
      const two = screen.getByText('Two');
      two.focus();
      two.textContent = 'Two!';
      fireEvent.input(two);
      caretAt(two, 0);
      fireEvent.keyDown(two, { key: 'Backspace' });
      act(() => { vi.advanceTimersByTime(COMMIT_MS * 2); });
      expect(onOps.mock.calls).toEqual([[[
        { op: 'update', id: 'b_1', set: { text: 'OneTwo!' } },
        { op: 'delete', target: ['b_2'] },
      ]]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Delete at the end of a paragraph pulls the next one up', () => {
    const onOps = vi.fn();
    render(<Live initial={docWith([
      { id: 'b_1', type: 'paragraph', text: 'One' },
      { id: 'b_2', type: 'paragraph', text: 'Two' },
    ])} onOps={onOps} />);
    const one = screen.getByText('One');
    one.focus();
    caretAt(one, 3);
    fireEvent.keyDown(one, { key: 'Delete' });
    expect(onOps).toHaveBeenLastCalledWith([
      { op: 'update', id: 'b_1', set: { text: 'OneTwo' } },
      { op: 'delete', target: ['b_2'] },
    ]);
  });

  it('Tab indents a list item and Shift+Tab brings it back', () => {
    const onOps = vi.fn();
    render(<Live initial={docWith([{ id: 'b_1', type: 'bullet', text: 'Item', indent: 0 }])} onOps={onOps} />);
    const item = screen.getByRole('textbox', { name: 'List item' });
    fireEvent.keyDown(item, { key: 'Tab' });
    expect(onOps).toHaveBeenLastCalledWith([{ op: 'update', id: 'b_1', set: { indent: 1, text: 'Item' } }]);
    fireEvent.keyDown(item, { key: 'Tab', shiftKey: true });
    expect(onOps).toHaveBeenLastCalledWith([{ op: 'update', id: 'b_1', set: { indent: 0, text: 'Item' } }]);
  });
});

describe('DocCanvas shortcuts', () => {
  it('turns "# " into a heading', async () => {
    const user = userEvent.setup();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: '' }])} />);
    await user.type(screen.getByRole('textbox', { name: 'Paragraph' }), '# ');
    expect(await screen.findByRole('textbox', { name: 'Heading 1' })).toBeInTheDocument();
  });

  it('turns "- " into a bullet, keeping the words after it', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: '' }])} onOps={onOps} />);
    await user.type(screen.getByRole('textbox', { name: 'Paragraph' }), '- ');
    expect(onOps).toHaveBeenLastCalledWith([{ op: 'update', id: 'b_1', set: { type: 'bullet', text: '' } }]);
    expect(await screen.findByRole('textbox', { name: 'List item' })).toBeInTheDocument();
  });

  it('turns "---" into a divider above an empty line', async () => {
    const user = userEvent.setup();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: '' }])} />);
    await user.type(screen.getByRole('textbox', { name: 'Paragraph' }), '---');
    expect(document.querySelector('.doc-divider')).not.toBeNull();
    expect(blockIds().at(-1)).toBe('b_1');
    expect(screen.getByRole('textbox', { name: 'Paragraph' }).textContent).toBe('');
  });
});

describe('DocCanvas slash menu', () => {
  it('opens on "/", filters as you type, and inserts the pick above', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: '' }])} onOps={onOps} />);
    const p = screen.getByRole('textbox', { name: 'Paragraph' });
    await user.type(p, '/');
    expect(screen.getByRole('listbox', { name: 'Insert a block' })).toBeInTheDocument();
    await user.type(p, 'tab');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Table']);
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onOps).toHaveBeenLastCalledWith([
      { op: 'insert', position: { before: 'b_1' }, blocks: [expect.objectContaining({ type: 'table' })] },
    ]);
    expect(p.textContent).toBe('');
  });

  it('moves through the list with the arrows and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: '' }])} />);
    const p = screen.getByRole('textbox', { name: 'Paragraph' });
    await user.type(p, '/');
    const options = () => screen.getAllByRole('option');
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    // The block keeps the focus; a screen reader follows the active item.
    expect(p).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(p).toHaveAttribute('aria-activedescendant', options()[0].id);
    await user.keyboard('{ArrowDown}');
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(p).toHaveAttribute('aria-activedescendant', options()[1].id);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(options().at(-1)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(p).not.toHaveAttribute('aria-activedescendant');
  });

  it('turns the line into the block picked', async () => {
    const user = userEvent.setup();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: '' }])} />);
    await user.type(screen.getByRole('textbox', { name: 'Paragraph' }), '/quote');
    await user.click(screen.getByRole('option', { name: /Quote/ }));
    expect(document.querySelector('.doc-quote [contenteditable="true"]')).not.toBeNull();
  });
});

describe('DocCanvas selection bar', () => {
  it('offers formatting and "Edit with agent" for selected words', async () => {
    const user = userEvent.setup();
    const onAskAgent = vi.fn();
    const onSelectionChange = vi.fn();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: 'Acme is the pick' }])}
      onAskAgent={onAskAgent} onSelectionChange={onSelectionChange} />);
    const p = screen.getByText('Acme is the pick');
    select(p, 0, 4);
    const bar = await screen.findByRole('toolbar', { name: 'Format' });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ blockIds: ['b_1'], quote: 'Acme' });

    await user.click(screen.getByRole('button', { name: 'Code' }));
    expect(p.querySelector('code')?.textContent).toBe('Acme');

    await user.click(screen.getByRole('button', { name: /Edit with agent/ }));
    expect(bar).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Request for the agent' }), 'Say why{Enter}');
    expect(onAskAgent).toHaveBeenCalledWith({ blockIds: ['b_1'], quote: 'Acme', request: 'Say why', tabId: 't_1', mode: 'edit' });
  });

  it('links the selected words', async () => {
    const user = userEvent.setup();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: 'See the brief' }])} />);
    const p = screen.getByText('See the brief');
    select(p, 4, 13);
    await user.click(await screen.findByRole('button', { name: 'Link' }));
    await user.type(screen.getByRole('textbox', { name: 'Link address' }), 'example.com/brief{Enter}');
    expect(p.querySelector('a')).toHaveAttribute('href', 'https://example.com/brief');
    expect(p.querySelector('a').textContent).toBe('the brief');
    expect(screen.queryByRole('dialog', { name: 'Add link' })).toBeNull();
  });

  it('keeps the pick while the selection is outside the page, and clears it once the caret is back in it', async () => {
    // Found in review: nothing ever cleared it, so a passage picked once rode
    // on every later message. It must survive the focus moving to the
    // chat's composer, though: asking about the passage there is its point.
    const onSelectionChange = vi.fn();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: 'Acme is the pick' }])} onSelectionChange={onSelectionChange} />);
    const p = screen.getByText('Acme is the pick');
    select(p, 0, 4);
    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith({ blockIds: ['b_1'], quote: 'Acme' }));

    const composer = document.body.appendChild(document.createElement('textarea'));
    try {
      caretAt(composer, 0);
      act(() => { document.dispatchEvent(new Event('selectionchange')); });
      await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
      expect(onSelectionChange).not.toHaveBeenCalledWith(null);

      caretAt(p, 2);
      act(() => { document.dispatchEvent(new Event('selectionchange')); });
      await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(null));
    } finally {
      composer.remove();
    }
  });

  it('hides when the selection collapses', async () => {
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: 'Acme' }])} onAskAgent={() => {}} />);
    select(screen.getByText('Acme'), 0, 4);
    await screen.findByRole('toolbar', { name: 'Format' });
    window.getSelection().removeAllRanges();
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
  });
});

describe('DocCanvas title', () => {
  it('puts the title back when it is emptied', () => {
    const onOps = vi.fn();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: 'Lead' }])} onOps={onOps} />);
    const title = screen.getByRole('textbox', { name: 'Title' });
    title.focus();
    title.textContent = '  ';
    fireEvent.input(title);
    fireEvent.blur(title);
    expect(title.textContent).toBe('Plan');
    expect(onOps).not.toHaveBeenCalled();
  });

  it('renames the doc', () => {
    const onOps = vi.fn();
    render(<Live initial={docWith([{ id: 'b_1', type: 'paragraph', text: 'Lead' }])} onOps={onOps} />);
    const title = screen.getByRole('textbox', { name: 'Title' });
    title.focus();
    title.textContent = 'Plan B ';
    fireEvent.input(title);
    fireEvent.blur(title);
    expect(onOps).toHaveBeenCalledWith([{ op: 'rename_doc', title: 'Plan B' }]);
  });
});

describe('DocCanvas adding a tab', () => {
  const lead = [{ id: 'b_1', type: 'paragraph', text: 'Lead' }];

  it('offers Add tab under the title of a doc of one tab, to an editor', async () => {
    const onAddTab = vi.fn();
    const { unmount } = render(<Live initial={docWith(lead)} onAddTab={onAddTab} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    expect(onAddTab).toHaveBeenCalledTimes(1);
    unmount();
    const doc = docWith(lead);
    render(<DocCanvas doc={doc} tab={doc.tabs[0]} editable={false} apply={vi.fn()} onAddTab={onAddTab} />);
    expect(screen.queryByRole('button', { name: 'Add tab' })).toBeNull();
  });

  it('leaves adding to the tab rail once a doc has tabs', () => {
    const doc = { ...docWith(lead), tabs: [{ id: 't_1', title: 'Plan', blocks: lead }, { id: 't_2', title: 'Risks', blocks: [] }] };
    render(<DocCanvas doc={doc} tab={doc.tabs[0]} editable apply={vi.fn()} onAddTab={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add tab' })).toBeNull();
  });

  it('opens a tab just added with its title selected, to be named, once', () => {
    const doc = { ...docWith(lead), tabs: [{ id: 't_1', title: 'Plan', blocks: lead }, { id: 't_2', title: 'Untitled', blocks: [] }] };
    const onNamed = vi.fn();
    render(<DocCanvas doc={doc} tab={doc.tabs[1]} editable apply={vi.fn()} nameTitle onNamed={onNamed} />);
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
    expect(window.getSelection().toString()).toBe('Untitled');
    expect(onNamed).toHaveBeenCalledTimes(1);
  });
});

describe('DocCanvas block handles', () => {
  it('name the block they act on', () => {
    render(<Live initial={docWith([
      { id: 'b_1', type: 'heading', level: 2, text: 'Risks' },
      { id: 'b_2', type: 'paragraph', text: '' },
    ])} />);
    expect(screen.getByRole('button', { name: 'Options for Heading 2 “Risks”' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a block below Empty paragraph' })).toBeInTheDocument();
  });
});

