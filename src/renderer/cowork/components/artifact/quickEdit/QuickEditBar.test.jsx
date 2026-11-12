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
    const replyNode = screen.getByText('Reading the artifact…').closest('.artifact-quick-edit-msg');
    expect(replyNode).toHaveClass('is-entering');
    expect(screen.getByText('Make the title blue')).toHaveClass('is-entering');

    fireEvent.animationEnd(replyNode);
    view.rerender(<QuickEditBar controller={controller([user, reply('writing')])} />);

    const updated = screen.getByText('Writing the change…').closest('.artifact-quick-edit-msg');
    expect(updated).toBe(replyNode);
    expect(updated).not.toHaveClass('is-entering');
    // The user message has not finished its own entrance yet, and keeps it.
    expect(screen.getByText('Make the title blue')).toHaveClass('is-entering');
  });

  it("ignores a child's animation ending inside a reply", () => {
    render(<QuickEditBar controller={controller([user, reply('reading')])} />);
    const replyNode = screen.getByText('Reading the artifact…').closest('.artifact-quick-edit-msg');
    fireEvent.animationEnd(replyNode.querySelector('[role="status"]'));
    expect(replyNode).toHaveClass('is-entering');
  });

  it('sizes the thread to its content through an inline height', () => {
    render(<QuickEditBar controller={controller([user])} />);
    const thread = document.querySelector('.artifact-quick-edit-thread');
    expect(thread.style.height).toMatch(/px$/);
  });
});
