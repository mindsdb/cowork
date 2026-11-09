import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserTurn } from './UserTurn';

describe('UserTurn', () => {
  it('keeps the line breaks the reader typed', () => {
    const { container } = render(<UserTurn content={'first line\nsecond line\nthird line'} />);
    const bubble = container.querySelector('.user-turn-bubble')!;
    expect(bubble.querySelectorAll('br')).toHaveLength(2);
    // The minimap reads textContent; the break must still separate the words.
    expect(bubble.textContent).toContain('first line\nsecond line');
  });
});
