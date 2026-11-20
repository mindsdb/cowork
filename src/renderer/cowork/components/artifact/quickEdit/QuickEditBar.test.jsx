// The bar's motion (ENG-4227): a message gets its entrance once, never again
// as its reply streams or changes stage.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuickEditBar } from './QuickEditBar';

const controller = (messages) => ({
  messages, running: true, direct: true, send: vi.fn(), askAgent: vi.fn(), undo: vi.fn(), undoableId: null,
});
const reply = (stage) => ({ id: 'r1', role: 'assistant', state: 'running', stage, route: 'edit' });
const user = { id: 'u1', role: 'user', text: 'Make the title blue' };

describe('QuickEditBar motion', () => {
  it('gives a message the entry class once, not on later updates', () => {
    const view = render(<QuickEditBar controller={controller([user, reply('reading')])} />);
    const replyNode = screen.getByText('Reading the artifact…').closest('.artifact-quick-edit-row');
    expect(replyNode).toHaveClass('is-entering');
    expect(screen.getByText('Make the title blue')).toHaveClass('is-entering');

    fireEvent.animationEnd(replyNode);
    view.rerender(<QuickEditBar controller={controller([user, reply('writing')])} />);

    const updated = screen.getByText('Writing the change…').closest('.artifact-quick-edit-row');
    expect(updated).toBe(replyNode);
    expect(updated).not.toHaveClass('is-entering');
    // The user message has not finished its own entrance yet, and keeps it.
    expect(screen.getByText('Make the title blue')).toHaveClass('is-entering');
  });

  it("ignores a child's animation ending inside a reply", () => {
    render(<QuickEditBar controller={controller([user, reply('reading')])} />);
    const replyNode = screen.getByText('Reading the artifact…').closest('.artifact-quick-edit-row');
    fireEvent.animationEnd(replyNode.querySelector('[role="status"]'));
    expect(replyNode).toHaveClass('is-entering');
  });

  it('sizes the thread to its content through an inline height', () => {
    render(<QuickEditBar controller={controller([user])} />);
    const thread = document.querySelector('.artifact-quick-edit-thread');
    expect(thread.style.height).toMatch(/px$/);
  });
});

describe('QuickEditBar focus', () => {
  it('puts the caret in the input after the open animation, under StrictMode too', async () => {
    const { StrictMode } = await import('react');
    const { waitFor } = await import('@testing-library/react');
    const used = { current: 0 };
    render(
      <StrictMode>
        <QuickEditBar controller={{ ...controller([]), running: false }} focusRequest={1} focusUsed={used} />
      </StrictMode>,
    );
    const input = screen.getByRole('textbox', { name: 'Ask for a change' });
    expect(document.activeElement).not.toBe(input);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(used.current).toBe(1);
  });
});

describe('QuickEditBar reply actions', () => {
  const done = (state, extra = {}) => ({ id: 'r1', role: 'assistant', state, summary: 'Made the title blue and the subtitle a little larger.', ...extra });
  const ctl = (messages, extra = {}) => ({ ...controller(messages), running: false, ...extra });

  it('puts Undo beside the bubble, on its row, not inside it', () => {
    render(<QuickEditBar controller={ctl([user, done('applied', { undoable: true })], { undoableId: 'r1' })} />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const bubble = screen.getByText(/Made the title blue/).closest('.artifact-quick-edit-msg');
    expect(bubble).not.toContainElement(undo);
    const row = bubble.parentElement;
    expect(row).toHaveClass('artifact-quick-edit-row');
    expect(row.lastElementChild).toHaveClass('artifact-quick-edit-side');
    expect(row.lastElementChild).toContainElement(undo);
  });

  it('keeps the Undoing and Undone states beside the bubble', () => {
    const view = render(<QuickEditBar controller={ctl([user, done('applied', { undoing: true })], { undoableId: 'r1' })} />);
    expect(screen.getByRole('button', { name: 'Undoing…' }).closest('.artifact-quick-edit-side')).not.toBeNull();
    view.rerender(<QuickEditBar controller={ctl([user, done('applied', { undone: true })], { undoableId: null })} />);
    expect(screen.getByRole('status').closest('.artifact-quick-edit-side')).toHaveTextContent('Undone.');
  });

  it('places "Ask the agent instead" the same way, and nothing beside other replies', () => {
    const view = render(<QuickEditBar controller={ctl([user, done('failed')])} />);
    expect(screen.getByRole('button', { name: 'Ask the agent instead' }).closest('.artifact-quick-edit-side')).not.toBeNull();
    view.rerender(<QuickEditBar controller={ctl([user, done('noop')])} />);
    expect(document.querySelector('.artifact-quick-edit-side')).toBeNull();
  });

  // A question answered in the bar (ENG-4455): the answer, set as markdown,
  // with no Undo and the agent one click away.
  it('shows an answer as markdown, with "Ask the agent instead" and no Undo', () => {
    render(<QuickEditBar controller={ctl([user, done('replied', { summary: 'It has **three** slides.' })])} />);
    const strong = screen.getByText('three');
    expect(strong.tagName).toBe('STRONG');
    expect(strong.closest('.artifact-quick-edit-msg')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask the agent instead' }).closest('.artifact-quick-edit-side')).not.toBeNull();
  });

  it('says it is answering while a reply runs', () => {
    render(<QuickEditBar controller={controller([user, { ...reply(null), route: 'reply' }])} />);
    expect(screen.getByRole('status')).toHaveTextContent('Answering…');
  });
});


// The thread floats over the artifact (ENG-4455): open when the pointer comes
// back over the bar, on a click into it or the focus arriving there, or when
// a reply settles; folded away, leaving the input, once the pointer goes back
// to the artifact.
describe('QuickEditBar thread over the artifact', () => {
  const thread = () => document.querySelector('.artifact-quick-edit-thread');
  const bar = () => screen.getByRole('region');

  const settled = { ...reply(null), state: 'applied', summary: 'Done' };
  const idle = (messages) => ({ ...controller(messages), running: false });

  it('folds away when the pointer leaves for the artifact, and opens when it comes back over the bar', () => {
    render(<QuickEditBar controller={idle([user, settled])} />);
    expect(thread()).toHaveAttribute('data-open');

    fireEvent.pointerLeave(bar(), { pointerType: 'mouse' });
    expect(thread()).not.toHaveAttribute('data-open');

    fireEvent.pointerEnter(bar(), { pointerType: 'mouse' });
    expect(thread()).toHaveAttribute('data-open');
  });

  it('opens on a click into the input that kept the focus', () => {
    render(<QuickEditBar controller={controller([user, reply('reading')])} />);
    fireEvent.pointerLeave(bar(), { pointerType: 'mouse' });

    fireEvent.pointerDown(screen.getByRole('textbox'));
    expect(thread()).toHaveAttribute('data-open');
  });

  it('opens when the input takes the focus', () => {
    render(<QuickEditBar controller={controller([user, reply('reading')])} />);
    fireEvent.pointerLeave(bar(), { pointerType: 'mouse' });

    fireEvent.focus(screen.getByRole('textbox'));
    expect(thread()).toHaveAttribute('data-open');
  });

  it('opens again when a new message starts and when its reply settles', () => {
    const view = render(<QuickEditBar controller={idle([user, settled])} />);
    fireEvent.pointerLeave(bar(), { pointerType: 'mouse' });
    expect(thread()).not.toHaveAttribute('data-open');

    const next = { id: 'u2', role: 'user', text: 'Bigger' };
    view.rerender(<QuickEditBar controller={idle([user, settled, next, { ...reply('reading'), id: 'r2' }])} />);
    expect(thread()).toHaveAttribute('data-open');
  });

  it('opens again when an answer arrives', () => {
    const view = render(<QuickEditBar controller={controller([user, { ...reply(null), route: 'reply' }])} />);
    fireEvent.pointerLeave(bar(), { pointerType: 'mouse' });

    view.rerender(<QuickEditBar controller={controller([user, { ...reply(null), state: 'replied', summary: 'Hi there.' }])} />);
    expect(thread()).toHaveAttribute('data-open');
  });

  it('stays open while the focus is on a button in it', () => {
    const settled = { id: 'r1', role: 'assistant', state: 'applied', summary: 'Done.', undoable: true };
    render(<QuickEditBar controller={{ ...controller([user, settled]), running: false, undoableId: 'r1' }} />);
    screen.getByRole('button', { name: 'Undo' }).focus();

    fireEvent.pointerLeave(bar(), { pointerType: 'mouse' });
    expect(thread()).toHaveAttribute('data-open');
  });

  it('stays open while a change is on its way, and folds once it is done', () => {
    const view = render(<QuickEditBar controller={{ ...controller([user, reply('writing')]), running: true }} />);
    fireEvent.pointerLeave(bar(), { pointerType: 'mouse' });
    expect(thread()).toHaveAttribute('data-open');

    view.rerender(<QuickEditBar controller={{ ...controller([user, { ...reply(null), state: 'applied', summary: 'Done' }]), running: false }} />);
    fireEvent.pointerLeave(bar(), { pointerType: 'mouse' });
    expect(thread()).not.toHaveAttribute('data-open');
  });

  it('stays open while the agent answers in the chat', () => {
    const handedOff = { ...reply(null), state: 'chat' };
    const live = [{ role: 'user', content: 'Make the title blue' }, { role: '_streaming', content: '' }];
    render(<QuickEditBar controller={{ ...controller([user, handedOff]), running: false }} chatMessages={live} />);
    fireEvent.pointerLeave(bar(), { pointerType: 'mouse' });
    expect(thread()).toHaveAttribute('data-open');
  });
});

