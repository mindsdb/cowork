import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatScroller } from './ChatScroller';
import { activeTurnIndex, snippetOf } from './TurnMinimap';
import { useStickToBottom } from './useStickToBottom';

function Transcript({ prompts }: { prompts: string[] }) {
  const stick = useStickToBottom();
  return (
    <ChatScroller stick={stick}>
      {prompts.map((p, i) => (
        <div key={p} className="user-turn" data-turn-id={`t${i}`}>
          <div className="user-turn-bubble">{p}</div>
        </div>
      ))}
    </ChatScroller>
  );
}

describe('the turn minimap', () => {
  it('stays out of short conversations', () => {
    render(<Transcript prompts={['One', 'Two']} />);
    expect(screen.queryByRole('navigation', { name: 'Conversation turns' })).toBeNull();
  });

  it('lists each user turn by the start of its prompt', () => {
    render(<Transcript prompts={['Plan the launch', 'Draft the email', 'Price it']} />);
    const nav = screen.getByRole('navigation', { name: 'Conversation turns' });
    expect(nav.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Go to message 2: Draft the email' })).toBeInTheDocument();
  });

  it('scrolls the transcript to a turn when its tick is clicked', () => {
    const scrollTo = vi.fn();
    const original = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo;
    try {
      render(<Transcript prompts={['Plan the launch', 'Draft the email', 'Price it']} />);
      fireEvent.click(screen.getByRole('button', { name: /Go to message 3/ }));
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
    } finally {
      HTMLElement.prototype.scrollTo = original;
    }
  });
});

describe('activeTurnIndex', () => {
  const tops = [0, 800, 1600, 2400];
  it('is the last turn whose top has passed a third of the way down', () => {
    expect(activeTurnIndex(tops, 0, 600)).toBe(0);
    expect(activeTurnIndex(tops, 700, 600)).toBe(1);
    expect(activeTurnIndex(tops, 2300, 600)).toBe(3);
  });
});

describe('snippetOf', () => {
  it('flattens whitespace and trims long prompts', () => {
    expect(snippetOf('  Plan\n\nthe   launch ')).toBe('Plan the launch');
    const long = snippetOf('word '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('…')).toBe(true);
  });
});
