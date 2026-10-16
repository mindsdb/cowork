import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThinkingStep } from './ThinkingStep';

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

describe('ThinkingStep object rows', () => {
  // An artifact or skill row marks a moment, not timed work: it read "0s".
  it.each(['Artifact', 'Skill', 'Compaction'])('shows no duration for a %s row', (badge) => {
    const { container } = render(
      <ThinkingStep step={{ id: 's1', label: 'Thing', badge, status: 'completed', startedAt: 1000, completedAt: 1000 }} />,
    );
    expect(container.textContent).not.toContain('0s');
  });

  it('tags a skill row like an artifact row', () => {
    const { container } = render(
      <ThinkingStep step={{ id: 'skill-a', label: 'Digest', badge: 'Skill', status: 'completed' }} />,
    );
    expect(container.textContent).toContain('skill');
  });
});
