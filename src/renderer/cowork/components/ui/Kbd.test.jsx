import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Kbd } from './Kbd.jsx';

describe('Kbd', () => {
  it('renders a <kbd> with the "kbd" class and its children', () => {
    render(<Kbd>⌘K</Kbd>);
    const el = screen.getByText('⌘K');
    expect(el.tagName).toBe('KBD');
    expect(el).toHaveClass('kbd', { exact: true });
  });

  it('merges a custom className alongside "kbd"', () => {
    render(<Kbd className="extra">N</Kbd>);
    expect(screen.getByText('N')).toHaveClass('kbd', 'extra');
  });
});
