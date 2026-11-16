import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RailCard } from './RailCard';

// The rail scrolls as a whole; a section that scrolled inside itself put its
// scrollbar over its rows' trailing menus, where it took their clicks.
const scrollsByItself = (el) =>
  /\boverflow(-y)?-(auto|scroll)\b/.test(el.className || '')
  || ['auto', 'scroll'].includes(el.style?.overflowY)
  || Boolean(el.style?.maxHeight);

describe('RailCard', () => {
  it.each([
    ['a disclosure section', { defaultOpen: true }],
    ['a plain-label section', { noChevron: true }],
  ])('never scrolls inside itself, as %s', (_name, props) => {
    const { container, getByText } = render(
      <RailCard title="Artifacts" {...props}>
        <div>row</div>
      </RailCard>,
    );
    expect(getByText('row')).toBeInTheDocument();
    expect([...container.querySelectorAll('*')].filter(scrollsByItself)).toEqual([]);
  });
});
