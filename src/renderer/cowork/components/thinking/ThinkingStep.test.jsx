import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
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
