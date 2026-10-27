import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// A web build without the platform UI whose server publishes with the person's
// own key: the SPA wrapper's tag says no shared publish token is set.
vi.mock('../../../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../../../../lib/sharedPublishToken', () => ({ hasSharedPublishToken: () => false }));

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
    ownerOnly: false,
    accessLoaded: true,
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

function shareButton() {
  // The trigger and the footer both read "Share"; the footer's is the one in the panel.
  return within(screen.getByText('Share to the Web').parentElement).getByRole('button', { name: 'Share' });
}

describe('PublishMenu with the platform UI off and no shared publish token', () => {
  it('opens an unpublished artifact with nothing picked and "Only you" offered', () => {
    const ctrl = makeController();
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Share'));

    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Only you/ })).toBeInTheDocument();
    expect(screen.getByText('Anyone on the internet with the URL')).toBeInTheDocument();
    expect(shareButton()).toBeDisabled();
  });

  it('shares as owner-only once "Only you" is picked', () => {
    const ctrl = makeController();
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Share'));

    fireEvent.click(screen.getByRole('radio', { name: /Only you/ }));
    fireEvent.click(shareButton());
    expect(ctrl.publish).toHaveBeenCalledWith({
      mode: 'restricted', emails: [], org_allowed: false, owner_only: true,
    });
  });

  it('describes an artifact shared as Public as reaching the internet', () => {
    render(<PublishMenu controller={makeController({ publishedUrl: 'https://view.example/r/a' })} />);
    fireEvent.click(screen.getByText('Shared'));

    expect(screen.getByText('Anyone on the internet with the URL')).toBeInTheDocument();
  });
});
