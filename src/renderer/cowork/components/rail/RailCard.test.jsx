import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RailCard } from './RailCard';

describe('RailCard', () => {
  it('never scrolls inside itself, so no scrollbar sits over its rows’ menus', () => {
    const { container } = render(
      <RailCard title="Artifacts" defaultOpen>
        <div>row</div>
      </RailCard>,
    );
    const body = container.querySelector('.pt-1');
    expect(body).not.toBeNull();
    expect(body.className).not.toContain('overflow-y-auto');
    expect(body.style.maxHeight).toBe('');
  });
});
