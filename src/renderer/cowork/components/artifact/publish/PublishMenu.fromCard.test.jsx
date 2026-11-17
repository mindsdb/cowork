// A Share panel opened by Share outside the viewer (the chat's artifact card)
// starts a first share with no audience picked, even where the viewer's own
// Share starts on Public, so nobody shares to the internet by accepting a
// default they never looked at.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../../../lib/deployment', () => ({ PLATFORM_UI: true }));
vi.mock('../../../lib/artifactShareAnalytics', () => ({ reportShareOpened: vi.fn(), reportLinkCopied: vi.fn() }));

import { PublishMenu } from './PublishMenu';

function makeController(overrides = {}) {
  return {
    artifact: { id: 'a1', type: 'html' },
    entry: 'chat_card',
    publishedUrl: '', phase: 'idle', busy: false, error: '', notice: '', linkOwnerRecorded: null,
    accessMode: 'public', accessPassword: '', accessEmails: [], orgAllowed: false, ownerOnly: false,
    accessLoaded: true, versions: [], modified: false,
    setError: vi.fn(), loadVersions: vi.fn(), publish: vi.fn(async () => true), unpublish: vi.fn(), activate: vi.fn(), update: vi.fn(),
    ...overrides,
  };
}

// The trigger and the footer both read "Share"; the footer's is the panel's.
const footerShare = () => within(screen.getByText('Share to the Web').parentElement).getByRole('button', { name: 'Share' });
const checked = () => screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');

describe('a first share opened from the chat card', () => {
  it('picks no audience and keeps Share disabled', () => {
    const ctrl = makeController();
    render(<PublishMenu openRequest={{}} controller={ctrl} />);

    expect(checked()).toEqual([]);
    expect(footerShare()).toBeDisabled();
    fireEvent.click(footerShare());
    expect(ctrl.publish).not.toHaveBeenCalled();
  });

  it('enables Share once the person picks who can open it', () => {
    const ctrl = makeController();
    render(<PublishMenu openRequest={{}} controller={ctrl} />);

    fireEvent.click(screen.getByRole('radio', { name: /Only me/ }));
    expect(footerShare()).toBeEnabled();
    fireEvent.click(footerShare());
    expect(ctrl.publish).toHaveBeenCalledWith(expect.objectContaining({ mode: 'restricted' }));
  });

  it('hands back to the header once that panel closes: a reopen starts on Public, as the header does', () => {
    const onRequestClosed = vi.fn();
    render(<PublishMenu openRequest={{}} onRequestClosed={onRequestClosed} controller={makeController()} />);

    fireEvent.mouseDown(screen.getByTestId('publish-menu-outside-dismiss'));
    expect(onRequestClosed).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Share'));

    expect(screen.getByRole('radio', { name: /Public/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.mouseDown(screen.getByTestId('publish-menu-outside-dismiss'));
    expect(onRequestClosed).toHaveBeenCalledTimes(1);
  });
});

describe('the viewer\'s own Share', () => {
  it('keeps starting a first share on Public', () => {
    render(<PublishMenu controller={makeController({ entry: 'viewer' })} />);
    fireEvent.click(screen.getByText('Share'));

    expect(screen.getByRole('radio', { name: /Public/ })).toHaveAttribute('aria-checked', 'true');
    expect(footerShare()).toBeEnabled();
  });
});
