import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../../lib/deployment', () => ({ PLATFORM_UI: false }));

import { PublishMenu } from './PublishMenu';
import { UNRECORDED_LINK_WARNING } from './linkLeftLive';

const NOTICE = 'Cowork couldn’t take this page down, so anyone with its link can still open it: https://view.example/r/a.';

function makeController(overrides = {}) {
  return {
    publishedUrl: '', phase: 'idle', busy: false, error: '', notice: '', linkOwnerRecorded: null,
    accessMode: 'public', accessPassword: '', accessEmails: [], orgAllowed: false, ownerOnly: false,
    accessLoaded: true, versions: [], modified: false,
    setError: vi.fn(), loadVersions: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), activate: vi.fn(), update: vi.fn(),
    ...overrides,
  };
}

// Opens the access view: picking another access from the dropdown starts the
// change, with Update and Stop sharing in the footer.
async function openChange(user) {
  await user.click(screen.getByText('Shared'));
  await user.click(screen.getByTestId('access-dropdown'));
  await user.click(screen.getByRole('radio', { name: /^Password protected/ }));
}

describe('PublishMenu when a link has no owner on record', () => {
  it('warns before Update, Stop sharing or delete that the link stays live', async () => {
    render(<PublishMenu controller={makeController({ publishedUrl: 'https://view.example/r/a', linkOwnerRecorded: false })} />);
    await openChange(userEvent.setup());
    expect(screen.getByText(UNRECORDED_LINK_WARNING)).toBeInTheDocument();
  });

  it('shows no warning for a link on record', async () => {
    render(<PublishMenu controller={makeController({ publishedUrl: 'https://view.example/r/a', linkOwnerRecorded: true })} />);
    await openChange(userEvent.setup());
    expect(screen.queryByText(UNRECORDED_LINK_WARNING)).toBeNull();
  });

  it('stays open after Stop sharing that left the page live, and says so', async () => {
    const published = makeController({
      publishedUrl: 'https://view.example/r/a',
      unpublish: vi.fn().mockResolvedValue({ ok: true, notice: NOTICE }),
    });
    const { rerender } = render(<PublishMenu controller={published} />);
    await openChange(userEvent.setup());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    });
    // What usePublish holds once its unpublish returns.
    rerender(<PublishMenu controller={makeController({ notice: NOTICE })} />);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it('closes after Stop sharing that took the page down', async () => {
    const published = makeController({
      publishedUrl: 'https://view.example/r/a',
      unpublish: vi.fn().mockResolvedValue({ ok: true, notice: '' }),
    });
    render(<PublishMenu controller={published} />);
    await openChange(userEvent.setup());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    });
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull();
  });
});
