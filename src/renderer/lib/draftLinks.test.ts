import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getDraftLinks, setDraftLinks, useDraftLinks } from './draftLinks';

// A web build without the platform UI (self-hosted, white-label): its page's
// CSP frames no draft host, so a server that reports links cannot turn them on.
vi.mock('./deployment', () => ({ PLATFORM_UI: false }));

describe('useDraftLinks in a build without the platform UI', () => {
  afterEach(() => setDraftLinks(false));

  it('reads false whatever /health says', () => {
    setDraftLinks(true);

    const { result } = renderHook(() => useDraftLinks());

    expect(getDraftLinks()).toBe(true);
    expect(result.current).toBe(false);
  });
});
