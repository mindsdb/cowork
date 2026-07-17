import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PublishMenu } from './PublishMenu';

function makeController(overrides = {}) {
  return {
    publishedUrl: '',
    phase: 'idle',
    busy: false,
    error: '',
    accessMode: 'public',
    accessPassword: '',
    accessEmails: [],
    orgAllowed: false,
    versions: [],
    modified: false,
    setError: vi.fn(),
    loadVersions: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    activate: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

describe('PublishMenu — outside-click dismiss', () => {
  it('closes when a click lands elsewhere on screen, not just on the trigger', () => {
    render(<PublishMenu controller={makeController()} />);

    fireEvent.click(screen.getByText('Share'));
    expect(screen.getByText('Share to the Web')).toBeInTheDocument();

    // The artifact preview renders as an <iframe>; a real click there would
    // hit-test to this overlay div (it visually covers the whole viewport),
    // never bubbling into the iframe's own document. Firing the press
    // directly on the overlay simulates that real-world hit-test.
    fireEvent.mouseDown(screen.getByTestId('publish-menu-outside-dismiss'));

    expect(screen.queryByText('Share to the Web')).toBeNull();
  });

  it('does not render the dismiss overlay when the popover is closed', () => {
    render(<PublishMenu controller={makeController()} />);
    expect(screen.queryByTestId('publish-menu-outside-dismiss')).toBeNull();
  });
});
