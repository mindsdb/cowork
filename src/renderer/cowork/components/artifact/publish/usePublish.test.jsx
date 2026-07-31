import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePublish } from './usePublish';

// Regression coverage for ENG-931: the restricted-access list must always
// reflect the server's real list — on any open, and it must never be
// self-clobbered by the re-sync effect after refresh() feeds onChange back
// into the artifact prop.

const apiMock = vi.hoisted(() => ({
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  fetchArtifactStatus: vi.fn(),
  listArtifactVersions: vi.fn(),
  activateArtifactVersion: vi.fn(),
  // Pure helper — mirror the real implementation so targetPath resolves.
  publishTargetPath: (a) => a?.folder || a?.canonicalPath || a?.file_path || a?.path || '',
}));
vi.mock('../../../api', () => apiMock);
vi.mock('../../../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));

// Server status for an already-shared restricted artifact with two recipients.
const STATUS_RESTRICTED = {
  publishedUrl: 'https://share/abc',
  modified: false,
  accessMode: 'restricted',
  accessEmails: ['alice@x.com', 'bob@x.com'],
  orgAllowed: false,
  artifactKey: 'user/report',
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.fetchArtifactStatus.mockResolvedValue(STATUS_RESTRICTED);
});

describe('usePublish — server is the source of truth for the access list (ENG-931)', () => {
  it('seeds accessLoaded=true when the prop already carries accessMode (grid/rail)', () => {
    const artifact = {
      path: '/p/a.html', publishedUrl: 'https://share/abc',
      accessMode: 'restricted', accessEmails: ['alice@x.com'],
    };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    expect(result.current.accessLoaded).toBe(true);
    expect(result.current.accessEmails).toEqual(['alice@x.com']);
  });

  it('seeds accessLoaded=true for a legacy prop carrying only accessProtected (no accessMode)', () => {
    const artifact = { path: '/p/a.html', publishedUrl: 'https://share/abc', accessProtected: true };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    expect(result.current.accessLoaded).toBe(true);
  });

  it('open refresh() fills the real list for a prop that lacks it (chat bubble)', async () => {
    const onChange = vi.fn();
    const artifact = { path: '/p/a.html' }; // no accessMode / accessEmails
    const { result } = renderHook(() => usePublish(artifact, { onChange, enabled: true }));

    // Guarded until the fetch lands.
    expect(result.current.accessLoaded).toBe(false);
    expect(result.current.accessEmails).toEqual([]);

    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    expect(apiMock.fetchArtifactStatus).toHaveBeenCalledWith('/p/a.html');
    expect(result.current.accessMode).toBe('restricted');
    expect(result.current.accessEmails).toEqual(['alice@x.com', 'bob@x.com']);
    // ⚠️ onChange must carry the access fields back (self-clobber guard).
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      accessMode: 'restricted',
      accessEmails: ['alice@x.com', 'bob@x.com'],
      orgAllowed: false,
    }));
  });

  it('refresh() applies access even when modified/publishedUrl are unchanged (early-return regression)', async () => {
    // Prop matches the status url + modified flag, so the old early return
    // would have bailed before touching the (empty) access list.
    const artifact = {
      path: '/p/a.html', publishedUrl: 'https://share/abc',
      accessMode: 'restricted', accessEmails: [],
    };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.accessEmails).toEqual(['alice@x.com', 'bob@x.com']);
  });

  it('does not self-clobber the loaded list when onChange feeds back into the prop', async () => {
    // Emulate the chat-bubble parent: onChange result becomes the next prop
    // (setPreviewArt). This is the sequence that would wipe the list if
    // onChange dropped the access fields.
    let artifact = { path: '/p/a.html' };
    const onChange = vi.fn((updated) => { artifact = updated; });
    const { result, rerender } = renderHook(
      ({ a }) => usePublish(a, { onChange, enabled: true }),
      { initialProps: { a: artifact } },
    );

    await waitFor(() => expect(result.current.accessLoaded).toBe(true));
    expect(result.current.accessEmails).toEqual(['alice@x.com', 'bob@x.com']);

    // Parent applies onChange back into the prop → re-sync effect re-seeds
    // accessEmails FROM the prop. The list must survive.
    rerender({ a: artifact });
    expect(result.current.accessEmails).toEqual(['alice@x.com', 'bob@x.com']);
  });

  it('publish(restricted) shows the new list immediately and marks it loaded (same-session)', async () => {
    apiMock.publishArtifact.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'restricted',
      accessEmails: ['carol@x.com'], orgAllowed: false, artifactKey: 'user/report',
    });
    const artifact = { path: '/p/a.html' };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    await act(async () => {
      await result.current.publish({ mode: 'restricted', emails: ['carol@x.com'] });
    });
    expect(result.current.accessEmails).toEqual(['carol@x.com']);
    expect(result.current.accessLoaded).toBe(true);
  });
});
