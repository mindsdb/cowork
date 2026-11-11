import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// A link in a note opens through the host bridge, like links elsewhere.
const openExternal = vi.hoisted(() => vi.fn());
vi.mock('../../../platform/host', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, host: { ...mod.host, openExternal } };
});

import { ThinkingStep, settleLiveNote } from './ThinkingStep';

// An in-progress step row must be the same height as a settled one, or the
// thinking block visibly jumps every time a step starts or finishes. The row
// height is driven by its tallest inline element, so the animated "…" dots
// must carry the same font-size as the 12.5px label — otherwise the dots
// inherit the 16px body font-size and the running row is ~5px taller.
describe('ThinkingStep in-progress row height', () => {
  it('sizes the animated dots to match the label so the row does not resize', () => {
    const { container } = render(
      <ThinkingStep step={{ id: 's1', label: 'Running code', status: 'in_progress' }} />,
    );

    const label = [...container.querySelectorAll('span')].find(
      (el) => el.textContent === 'Running code',
    );
    const dots = container.querySelector('span.w-5');

    expect(label).toBeTruthy();
    expect(dots).toBeTruthy();
    // Label and dots share the same explicit 12.5px size.
    expect(label.className).toContain('text-[12.5px]');
    expect(dots.className).toContain('text-[12.5px]');
  });
});

describe('ThinkingStep badges (ENG-2981)', () => {
  it('shows no duration for a ToolProgress row', () => {
    const { container } = render(
      <ThinkingStep step={{
        id: 's1', label: 'Writing the page (step 3 of 4)', badge: 'ToolProgress',
        status: 'completed', startedAt: 1000, completedAt: 6000,
      }} />,
    );
    expect(container.textContent).not.toContain('5s');
  });

  it('still shows the duration for other steps', () => {
    const { container } = render(
      <ThinkingStep step={{ id: 's1', label: 'Running code', status: 'completed', startedAt: 1000, completedAt: 6000 }} />,
    );
    expect(container.textContent).toContain('5s');
  });

  it('shows no question chip: AskUser steps render as cards, not rows', () => {
    const { container } = render(
      <ThinkingStep step={{ id: 'question-q1', label: 'Prompt', badge: 'AskUser', status: 'in_progress' }} />,
    );
    expect(container.textContent).not.toContain('question');
  });
});

describe('ThinkingStep — opening Note stand-in (ENG-3554)', () => {
  it("types out the stand-in phrase instead of Anton's opening line", async () => {
    const step = {
      id: 'note-1', badge: 'Note', icon: 'note', status: 'completed',
      label: "I'll create an interactive solar system.", standIn: 'Getting started…',
      startedAt: 0, completedAt: 0,
    };
    render(<ThinkingStep step={step} />);
    expect(await screen.findByText('Getting started…')).toBeInTheDocument();
    expect(screen.queryByText("I'll create an interactive solar system.")).not.toBeInTheDocument();
  });

  it("shows a Note without a stand-in as written", () => {
    const step = { id: 'note-2', badge: 'Note', icon: 'note', status: 'completed', label: "Now I'll add the orbits.", startedAt: 0, completedAt: 0 };
    render(<ThinkingStep step={step} />);
    expect(screen.getByText("Now I'll add the orbits.")).toBeInTheDocument();
  });
});

// Anton's notes between steps are markdown: they render it at the step rows'
// size and colour, while step titles stay plain one-liners (ENG-4195).
describe('ThinkingStep — notes render markdown at the steps size (ENG-4195)', () => {
  const note = (label, extra = {}) => ({
    id: 'note-3', badge: 'Note', icon: 'note', status: 'completed', label,
    startedAt: 1000, completedAt: 4000, ...extra,
  });
  const renderNote = (label, extra) => render(<ThinkingStep step={note(label, extra)} />);
  const noteRoot = (container) => container.querySelector('.markdown-steps');

  it('renders bold without the asterisks, in the row colour at 12.5px', () => {
    const { container } = renderNote(
      'I found an important addition: **Acme Academy lists $29,950 tuition and merit scholarships**, a lower-cost option.',
    );
    const bold = container.querySelector('strong');
    expect(bold).toHaveTextContent('Acme Academy lists $29,950 tuition and merit scholarships');
    expect(container.textContent).not.toContain('**');
    const root = noteRoot(container);
    expect(root.className).toContain('text-[12.5px]');
    // No colour of its own: the note takes the row's muted ink.
    expect(root.className).not.toMatch(/\btext-ink/);
    expect(root.parentElement.className).toContain('text-ink-3');
    expect(bold.className).not.toMatch(/\btext-ink/);
    // The duration still sits on the right.
    expect(container.textContent).toContain('3s');
  });

  it('uses the in-progress ink while the note is live', () => {
    const { container } = renderNote('Checking the **fees**', { status: 'in_progress', completedAt: null });
    expect(noteRoot(container).parentElement.className).toMatch(/\btext-ink\b/);
  });

  it('renders a numbered list as an <ol> with its items', () => {
    const { container } = renderNote(
      'The guide will include:\n1. A filterable school explorer.\n2. A four-year cost calculator.\n3. A comparison table.',
    );
    const ol = container.querySelector('ol');
    expect(ol).toBeTruthy();
    expect(ol.className).toContain('list-decimal');
    expect([...ol.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'A filterable school explorer.', 'A four-year cost calculator.', 'A comparison table.',
    ]);
    expect(container.textContent).toContain('The guide will include:');
  });

  it('indents nested bullets under their parent', () => {
    const { container } = renderNote('Sources:\n- Tuition pages\n  - Day school\n  - Boarding');
    const nested = container.querySelector('ul ul');
    expect(nested).toBeTruthy();
    expect(nested.querySelectorAll('li')).toHaveLength(2);
  });

  it('keeps single line breaks as line breaks', () => {
    const { container } = renderNote('First line\nSecond line');
    expect(container.querySelector('br')).toBeTruthy();
  });

  it('renders inline code as code', () => {
    const { container } = renderNote('Reading `tuition.csv` next.');
    const code = container.querySelector('code');
    expect(code).toHaveTextContent('tuition.csv');
    expect(container.textContent).not.toContain('`');
  });

  it('renders a link that opens in the browser', () => {
    openExternal.mockClear();
    renderNote('See the [fee schedule](https://example.com/fees).');
    const link = screen.getByRole('link', { name: /fee schedule/ });
    expect(link).toHaveAttribute('href', 'https://example.com/fees');
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/fees');
  });

  it('renders a heading as bold text at the body size', () => {
    const { container } = renderNote('## Costs\nTuition first.');
    const h2 = container.querySelector('h2');
    expect(h2).toHaveTextContent('Costs');
    expect(h2.className).toContain('text-[12.5px]');
    expect(h2.className).toContain('font-semibold');
    expect(h2.className).not.toMatch(/s-h\d|text-ink/);
  });

  it('renders a small table compactly, scrolling sideways when wide', () => {
    const { container } = renderNote('| School | Tuition |\n| --- | --- |\n| Acme Academy | $29,950 |');
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect(table.parentElement.className).toContain('overflow-x-auto');
    expect(container.querySelector('td')).toHaveTextContent('Acme Academy');
    expect(container.querySelector('td').className).toContain('py-0.5');
  });

  it('does not render images', () => {
    const { container } = renderNote('Chart: ![tuition](https://example.com/chart.png)');
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps step titles plain and truncated, with the tooltip', () => {
    const { container } = render(
      <ThinkingStep step={{ id: 's1', label: 'Read **official** tuition pages', status: 'completed' }} />,
    );
    expect(container.querySelector('.markdown-steps')).toBeNull();
    const label = screen.getByText('Read **official** tuition pages');
    expect(label.className).toContain('truncate');
    expect(label).toHaveAttribute('title', 'Read **official** tuition pages');
  });

  it('keeps the opening stand-in as typed text', async () => {
    const { container } = render(<ThinkingStep step={note('**Opening** line', { standIn: 'Getting started…' })} />);
    expect(await screen.findByText('Getting started…')).toBeInTheDocument();
    expect(container.querySelector('.markdown-steps')).toBeNull();
  });

  it('never shows raw markers while a note streams', () => {
    const { container } = renderNote('I found **St', { status: 'in_progress', completedAt: null });
    expect(container.querySelector('strong')).toHaveTextContent('St');
    expect(container.textContent).not.toContain('*');
  });
});

describe('settleLiveNote', () => {
  it('closes an open bold', () => expect(settleLiveNote('I found **St')).toBe('I found **St**'));
  it('drops a bold opener with nothing after it yet', () => expect(settleLiveNote('Next: **')).toBe('Next:'));
  it('drops the first half of a ** marker', () => expect(settleLiveNote('Next: *')).toBe('Next:'));
  it('leaves finished markdown alone', () => {
    expect(settleLiveNote('A **b** and `c` with\n- item')).toBe('A **b** and `c` with\n- item');
  });
  it('closes an open code span', () => expect(settleLiveNote('Run `npm')).toBe('Run `npm`'));
  it('closes an open code fence', () => expect(settleLiveNote('```py\nx = 1')).toBe('```py\nx = 1\n```'));
  it('ignores asterisks inside code', () => expect(settleLiveNote('Use `a**b` then')).toBe('Use `a**b` then'));
});
