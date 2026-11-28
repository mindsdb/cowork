import { describe, expect, it, vi } from 'vitest';
import {
  DRAFT_LINK_TTL_MS,
  PUBLISHED_FRAME_MARGIN_MS,
  PUBLISHED_FRAME_TTL_MS,
  RefusedDraftLink,
  draftLinkLifetimeMs,
  draftLinkUrl,
  draftLinksWithdrawal,
  publishedFrameLifetimeMs,
} from './draftLinkRules';

describe('draftLinkUrl', () => {
  it.each([
    'https://draft.mindshub.co/_t/v1.a.b/index.html',
    'https://draft-staging.mindshub.co/_t/v1.a.b/index.html',
    'https://draft-dev.mindshub.co/_t/v1.a.b/report/index.html',
  ])('accepts a link on a draft host: %s', (url) => {
    expect(draftLinkUrl({ url, expiresAt: 1 })).toBe(url);
  });

  it('rebuilds the link from the allowed origin, keeping the query and dropping the fragment', () => {
    expect(draftLinkUrl({ url: 'https://DRAFT-STAGING.mindshub.co:443/_t/v1.a.b/index.html?x=1#top' }))
      .toBe('https://draft-staging.mindshub.co/_t/v1.a.b/index.html?x=1');
  });

  it.each([
    ['another host', 'https://evil.example/_t/v1.a.b/index.html'],
    ['a host that only starts like a draft host', 'https://draft.mindshub.co.evil.example/_t/v1.a.b/index.html'],
    ['a path that names another host', 'https://draft-staging.mindshub.co//evil.example/x'],
    ['a backslash path', 'https://draft-staging.mindshub.co/\\evil.example/x'],
    ['a path outside /_t/', 'https://draft-staging.mindshub.co/index.html'],
    ['a path that climbs out of /_t/', 'https://draft-staging.mindshub.co/_t/../index.html'],
    ['plain http', 'http://draft-staging.mindshub.co/_t/v1.a.b/index.html'],
    ['another port', 'https://draft-staging.mindshub.co:8443/_t/v1.a.b/index.html'],
    ['not a URL', 'javascript:alert(1)'],
    ['an empty string', ''],
    ['not a string', 42],
  ])('refuses %s', (_label, url) => {
    expect(() => draftLinkUrl({ url })).toThrow(RefusedDraftLink);
  });

  it('refuses a response without a link', () => {
    expect(() => draftLinkUrl(null)).toThrow('The server returned no draft link.');
  });
});

describe('draftLinksWithdrawal', () => {
  const notFound = Object.assign(new Error('Draft links are not available'), { status: 404 });

  it('withdraws links for a refused link without reading /health', async () => {
    const readHealth = vi.fn();
    await expect(draftLinksWithdrawal(new RefusedDraftLink(), readHealth)).resolves.toBe('draft_link_refused');
    expect(readHealth).not.toHaveBeenCalled();
  });

  it('withdraws links for a 404 once /health says they are off', async () => {
    const readHealth = vi.fn(async () => ({ configured: true, provider: '', draftLinks: false }));
    await expect(draftLinksWithdrawal(notFound, readHealth)).resolves.toBe('draft_links_off');
  });

  it('keeps links for a 404 while /health says they are on', async () => {
    const readHealth = vi.fn(async () => ({ configured: true, provider: '', draftLinks: true }));
    await expect(draftLinksWithdrawal(notFound, readHealth)).resolves.toBeNull();
  });

  it('keeps links when /health cannot be read', async () => {
    const readHealth = vi.fn(async () => { throw new Error('offline'); });
    await expect(draftLinksWithdrawal(notFound, readHealth)).resolves.toBeNull();
  });

  it.each([401, 403, 500])('keeps links and reads no /health for a %i', async (status) => {
    const readHealth = vi.fn();
    await expect(draftLinksWithdrawal(Object.assign(new Error('x'), { status }), readHealth)).resolves.toBeNull();
    expect(readHealth).not.toHaveBeenCalled();
  });

  it('keeps links for a network failure', async () => {
    await expect(draftLinksWithdrawal(new TypeError('Failed to fetch'), vi.fn())).resolves.toBeNull();
  });
});

describe('draftLinkLifetimeMs', () => {
  const now = 1_900_000_000_000;

  it('counts down to expiresAt on the server clock', () => {
    expect(draftLinkLifetimeMs(1_900_000_000 + 1200, now)).toBe(1_200_000);
  });

  it('gives the full lifetime when the page clock is ahead of the expiry', () => {
    expect(draftLinkLifetimeMs(1_900_000_000 - 60, now)).toBe(DRAFT_LINK_TTL_MS);
  });

  it('gives the full lifetime when the page clock is far behind', () => {
    expect(draftLinkLifetimeMs(1_900_000_000 + 3 * 3600, now)).toBe(DRAFT_LINK_TTL_MS);
  });

  it.each([undefined, null, 'soon'])('gives the full lifetime for a missing expiry: %s', (expiresAt) => {
    expect(draftLinkLifetimeMs(expiresAt, now)).toBe(DRAFT_LINK_TTL_MS);
  });
});

describe('draftLinkLifetimeMs with a cap and a margin', () => {
  const now = 1_900_000_000_000;
  const options = { cap: PUBLISHED_FRAME_TTL_MS, margin: PUBLISHED_FRAME_MARGIN_MS };

  it('counts down to the margin before expiresAt', () => {
    expect(draftLinkLifetimeMs(1_900_000_000 + 3600, now, options)).toBe(3_510_000);
  });

  it('trusts no clock that leaves less than the margin, so the overlay never comes up at once', () => {
    expect(draftLinkLifetimeMs(1_900_000_000 + 60, now, options)).toBe(3_510_000);
    expect(draftLinkLifetimeMs(1_900_000_000 + 90, now, options)).toBe(3_510_000);
    expect(draftLinkLifetimeMs(1_900_000_000 - 60, now, options)).toBe(3_510_000);
  });

  it('trusts no clock that leaves more than the cap', () => {
    expect(draftLinkLifetimeMs(1_900_000_000 + 3 * 3600, now, options)).toBe(3_510_000);
  });

  it('is what publishedFrameLifetimeMs gives', () => {
    expect(publishedFrameLifetimeMs(1_900_000_000 + 1800, now)).toBe(1_710_000);
    expect(PUBLISHED_FRAME_TTL_MS).toBe(3_600_000);
    expect(PUBLISHED_FRAME_MARGIN_MS).toBe(90_000);
  });
});
