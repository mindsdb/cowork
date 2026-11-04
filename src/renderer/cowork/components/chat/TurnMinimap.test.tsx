import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatScroller } from './ChatScroller';
import { activeTurnIndex, answerAfter, railFit, snippetOf } from './TurnMinimap';
import { useStickToBottom } from './useStickToBottom';

function Transcript({ prompts }: { prompts: string[] }) {
  const stick = useStickToBottom();
  return (
    <ChatScroller stick={stick}>
      <div className="chat-column">
        {prompts.map((p, i) => (
          <div key={p} className="user-turn" data-turn-id={`t${i}`}>
            <div className="user-turn-bubble">{p}</div>
          </div>
        ))}
      </div>
    </ChatScroller>
  );
}

describe('the turn minimap', () => {
  // happy-dom lays nothing out; give the reading column a roomy 120px margin
  // so the rail has space to show.
  let rect: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    const original = Element.prototype.getBoundingClientRect;
    rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.classList.contains('chat-column') ? new DOMRect(120, 0, 720, 0) : original.call(this);
    });
  });
  afterEach(() => rect.mockRestore());

  it('stays out of a margin too narrow to hold it', () => {
    rect.mockImplementation(() => new DOMRect(28, 0, 720, 0));
    render(<Transcript prompts={['Plan the launch', 'Draft the email', 'Price it']} />);
    expect(screen.queryByRole('navigation', { name: 'Conversation turns' })).toBeNull();
  });

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

  // happy-dom never resizes, so this is the equal-height switch: only the
  // nodes change.
  it('re-reads the turns when the conversation changes without a resize', async () => {
    const { rerender } = render(<Transcript prompts={['Plan the launch', 'Draft the email', 'Price it']} />);
    rerender(<Transcript prompts={['Fix the parser', 'Add a test', 'Ship it']} />);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(screen.getByRole('button', { name: 'Go to message 1: Fix the parser' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan the launch/ })).toBeNull();
  });

  it('gives each tick its distance from the pointed one, and forgets it when the pointer leaves', () => {
    render(<Transcript prompts={['Plan the launch', 'Draft the email', 'Price it', 'Book the venue']} />);
    const nav = screen.getByRole('navigation', { name: 'Conversation turns' });
    const ticks = Array.from(nav.querySelectorAll('button'));
    fireEvent.pointerEnter(ticks[1]);
    expect(nav).toHaveClass('is-pointed');
    expect(ticks.map((t) => t.style.getPropertyValue('--tick-distance'))).toEqual(['1', '0', '1', '2']);
    fireEvent.pointerLeave(nav);
    expect(nav).not.toHaveClass('is-pointed');
    expect(ticks[0].style.getPropertyValue('--tick-distance')).toBe('');
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

describe('answerAfter', () => {
  function transcript(html: string) {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  }

  it('reads the answer that closes a Cowork turn, not its action row', () => {
    const root = transcript(`
      <div data-turn-id="t0">Plan the launch</div>
      <div class="answer-turn"><div class="markdown-content">Lead with the outcome.</div><span class="turn-meta">Anton</span></div>
      <div data-turn-id="t1">Price it</div>`);
    expect(answerAfter(root.children[0])).toBe('Lead with the outcome.');
    expect(answerAfter(root.children[2])).toBe('');
  });

  it('takes the last Code Mode message before the next turn, past progress notes', () => {
    const root = transcript(`
      <div data-turn-id="code-1">Fix the parser</div>
      <article class="code-agent-message"><div class="markdown-content">Checking the parser first.</div></article>
      <details><summary>Worked for 2m</summary></details>
      <article class="code-agent-message"><div class="markdown-content">The parser drops trailing commas.</div></article>`);
    expect(answerAfter(root.children[0])).toBe('The parser drops trailing commas.');
  });
});


describe('railFit', () => {
  it('sits 14px in when the margin is roomy', () => {
    expect(railFit(120)).toEqual({ inset: 14, peak: 24 });
  });

  it('moves toward the edge to keep 24px clear of the text', () => {
    expect(railFit(56)).toEqual({ inset: 8, peak: 24 });
  });

  it('hides when the margin cannot hold the rail and its gap', () => {
    expect(railFit(53)).toBeNull();
    expect(railFit(28)).toBeNull();
  });
});
