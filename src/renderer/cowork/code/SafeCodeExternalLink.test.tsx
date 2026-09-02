import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SafeCodeExternalLink } from './SafeCodeExternalLink';

describe('SafeCodeExternalLink', () => {
  it('opens validated web URLs in a separate browser context', () => {
    render(<SafeCodeExternalLink value="https://github.com/mindsdb/cowork/pull/1">Pull request</SafeCodeExternalLink>);

    expect(screen.getByRole('link', { name: 'Pull request' })).toMatchObject({
      href: 'https://github.com/mindsdb/cowork/pull/1',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  });

  it('renders unsafe values as inert text', () => {
    render(<SafeCodeExternalLink value="javascript:alert(1)">Unsafe link</SafeCodeExternalLink>);

    expect(screen.queryByRole('link', { name: 'Unsafe link' })).not.toBeInTheDocument();
    expect(screen.getByText('Unsafe link')).toHaveAttribute('aria-disabled', 'true');
  });
});
