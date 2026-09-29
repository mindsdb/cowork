import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerFooter, ComposerShell, ComposerSpacer } from './ComposerShell';

describe('ComposerShell', () => {
  it('maps its states onto the shared composer classes', () => {
    render(<ComposerShell floating focused dragging role="region" aria-label="Compose"><ComposerFooter><ComposerSpacer /></ComposerFooter></ComposerShell>);
    const shell = screen.getByRole('region', { name: 'Compose' });
    expect(shell).toHaveClass('composer-wrap', 'composer-wrap--floating', 'focused', 'is-dragging-files');
    expect(shell.firstElementChild).toHaveClass('composer-toolbar');
    expect(shell.querySelector('.composer-toolbar__spacer')).toBeInTheDocument();
  });
});
