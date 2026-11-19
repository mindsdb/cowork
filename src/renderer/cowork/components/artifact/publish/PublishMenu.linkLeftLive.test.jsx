import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

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

function openChange() {
  fireEvent.click(screen.getByText('Shared'));
  fireEvent.click(screen.getByText('Change'));
}

describe('PublishMenu when a link has no owner on record', () => {
  it('warns before Update, Stop sharing or delete that the link stays live', () => {
    render(<PublishMenu controller={makeController({ publishedUrl: 'https://view.example/r/a', linkOwnerRecorded: false })} />);
    openChange();
    expect(screen.getByText(UNRECORDED_LINK_WARNING)).toBeInTheDocument();
  });

  it('shows no warning for a link on record', () => {
    render(<PublishMenu controller={makeController({ publishedUrl: 'https://view.example/r/a', linkOwnerRecorded: true })} />);
    openChange();
    expect(screen.queryByText(UNRECORDED_LINK_WARNING)).toBeNull();
  });

  it('stays open after Stop sharing that left the page live, and says so', async () => {
    const published = makeController({
      publishedUrl: 'https://view.example/r/a',
      unpublish: vi.fn().mockResolvedValue({ ok: true, notice: NOTICE }),
    });
    const { rerender } = render(<PublishMenu controller={published} />);
    openChange();
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
    openChange();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    });
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull();
  });
});
