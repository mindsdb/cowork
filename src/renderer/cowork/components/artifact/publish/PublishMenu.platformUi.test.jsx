import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A web build without the platform UI whose page has no SPA wrapper
// publish-token tag, which keeps the shared-token choices: no "Only me", and
// Public says "Anyone with the URL".
vi.mock('../../../../lib/deployment', () => ({ PLATFORM_UI: false }));

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

describe('PublishMenu with the platform UI off and no publish-token tag', () => {
  it('opens an unpublished artifact with nothing picked and Share disabled', () => {
    const ctrl = makeController();
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Share'));

    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('Only me')).toBeNull();
    expect(shareButton()).toBeDisabled();

    fireEvent.click(shareButton());
    expect(ctrl.publish).not.toHaveBeenCalled();
  });

  it('enables Share once a choice is picked', () => {
    const ctrl = makeController();
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Share'));

    fireEvent.click(screen.getByRole('radio', { name: /Public/ }));
    expect(shareButton()).toBeEnabled();
    fireEvent.click(shareButton());
    expect(ctrl.publish).toHaveBeenCalledWith({ mode: 'public' }, expect.anything());
  });

  it('opens an artifact already shared as Public on Public, without claiming the internet', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({ publishedUrl: 'https://view.example/r/a' })} />);
    await user.click(screen.getByText('Shared'));

    expect(screen.getByTestId('access-dropdown')).toHaveAccessibleName('Who can access your app: Public');
    expect(screen.getByText('Anyone with the URL')).toBeInTheDocument();
    expect(screen.queryByText(/internet/)).toBeNull();

    await user.click(screen.getByTestId('access-dropdown'));
    expect(screen.getByRole('radio', { name: /Public/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(/internet/)).toBeNull();
  });

  // A change drafted in the access view must not leak into the reshare.
  it('starts a reshare with nothing picked after Stop sharing from a change', async () => {
    const user = userEvent.setup();
    const published = makeController({
      publishedUrl: 'https://view.example/r/a',
      unpublish: vi.fn().mockResolvedValue({ ok: true, notice: '' }),
    });
    const { rerender } = render(<PublishMenu controller={published} />);
    await user.click(screen.getByText('Shared'));
    await user.click(screen.getByTestId('access-dropdown'));
    await user.click(screen.getByRole('radio', { name: /^Password protected/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    });
    expect(published.unpublish).toHaveBeenCalled();

    // usePublish clears only the URL when it unpublishes, so the controller
    // still carries the access the artifact had.
    rerender(<PublishMenu controller={makeController()} />);
    fireEvent.click(screen.getByText('Share'));

    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveAttribute('aria-checked', 'false');
    expect(shareButton()).toBeDisabled();
  });
});
