import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../lib/deployment', () => ({ PLATFORM_UI: false }));
const report = vi.hoisted(() => ({ reportShareOpened: vi.fn(), reportLinkCopied: vi.fn() }));
vi.mock('../../../lib/artifactShareAnalytics', () => report);
const clipboard = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../../../lib/clipboard', () => clipboard);

import { PublishMenu } from './PublishMenu';

const ARTIFACT = { id: 'a1', type: 'html' };

function makeController(overrides = {}) {
  return {
    artifact: ARTIFACT,
    publishedUrl: '', phase: 'idle', busy: false, error: '', notice: '', linkOwnerRecorded: null,
    accessMode: 'public', accessPassword: '', accessEmails: [], orgAllowed: false, ownerOnly: false,
    accessLoaded: true, versions: [], modified: false,
    setError: vi.fn(), loadVersions: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), activate: vi.fn(), update: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PublishMenu analytics', () => {
  it('records each opening of the panel, with whether the artifact is shared', () => {
    render(<PublishMenu controller={makeController({ publishedUrl: 'https://view.example/r/a' })} />);

    fireEvent.click(screen.getByText('Shared'));

    expect(report.reportShareOpened).toHaveBeenCalledTimes(1);
    expect(report.reportShareOpened).toHaveBeenCalledWith(ARTIFACT, { entry: 'viewer', isShared: true });
  });

  it('says it does not know yet while the access of a published artifact is unread', () => {
    render(<PublishMenu controller={makeController({ publishedUrl: 'https://view.example/r/a', accessLoaded: false })} />);

    fireEvent.click(screen.getByText('Shared'));

    expect(report.reportShareOpened).toHaveBeenCalledWith(ARTIFACT, { entry: 'viewer', isShared: null });
  });

  it('says an artifact without a link is not shared', () => {
    render(<PublishMenu controller={makeController()} />);

    fireEvent.click(screen.getByRole('button', { name: /share/i }));

    expect(report.reportShareOpened).toHaveBeenCalledWith(ARTIFACT, { entry: 'viewer', isShared: false });
  });

  it('records a copied link only when the copy worked', async () => {
    render(<PublishMenu controller={makeController({ publishedUrl: 'https://view.example/r/a' })} />);
    fireEvent.click(screen.getByText('Shared'));
    const copy = screen.getByRole('button', { name: /copy/i });

    clipboard.copyText.mockResolvedValueOnce(false);
    await act(async () => { fireEvent.click(copy); });
    expect(report.reportLinkCopied).not.toHaveBeenCalled();

    clipboard.copyText.mockResolvedValueOnce(true);
    await act(async () => { fireEvent.click(copy); });
    expect(report.reportLinkCopied).toHaveBeenCalledTimes(1);
    expect(report.reportLinkCopied).toHaveBeenCalledWith(ARTIFACT, { entry: 'viewer' });
  });
});
