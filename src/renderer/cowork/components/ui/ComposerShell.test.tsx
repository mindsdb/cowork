import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerFooter, ComposerShell, composerShellClasses } from './ComposerShell';

describe('ComposerShell', () => {
  it('maps its states onto the shared composer classes', () => {
    expect(composerShellClasses()).toBe('composer-wrap');
    expect(composerShellClasses({ floating: true, focused: true, dragging: true, className: 'x' }))
      .toBe('composer-wrap composer-wrap--floating focused is-dragging-files x');
  });

  it('passes element props through to the card', () => {
    render(<ComposerShell role="region" aria-label="Compose">body</ComposerShell>);
    expect(screen.getByRole('region', { name: 'Compose' })).toHaveTextContent('body');
  });
});

describe('ComposerFooter', () => {
  it('places the start slot before the spacer and the end slot after it', () => {
    const { container } = render(
      <ComposerFooter start={<button>Add</button>} end={<button>Send</button>} />,
    );
    const footer = container.firstElementChild!;
    expect(footer).toHaveClass('composer-toolbar');
    expect([...footer.children].map(child => child.textContent || child.className))
      .toEqual(['Add', 'composer-toolbar__spacer', 'Send']);
  });

  it('renders either slot alone', () => {
    render(<ComposerFooter end={<button>Send</button>} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });
});
