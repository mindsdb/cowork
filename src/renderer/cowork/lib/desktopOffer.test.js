import { afterEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ platformUi: true, isWeb: true, isMobileShell: false }));
vi.mock('../../lib/deployment', () => ({ get PLATFORM_UI() { return flags.platformUi; } }));
vi.mock('../../platform/host', () => ({
  host: {
    get isWeb() { return flags.isWeb; },
    get isMobileShell() { return flags.isMobileShell; },
  },
}));

import { desktopDownloadUrl, desktopOfferAvailable } from './desktopOffer';

afterEach(() => {
  flags.platformUi = true;
  flags.isWeb = true;
  flags.isMobileShell = false;
});

describe('desktopOfferAvailable', () => {
  it('is on for the hosted web build', () => {
    expect(desktopOfferAvailable()).toBe(true);
  });

  it('is off in the desktop app, which keeps its own entries', () => {
    flags.isWeb = false;
    expect(desktopOfferAvailable()).toBe(false);
  });

  it('is off inside the mobile app, which cannot install the desktop app', () => {
    flags.isMobileShell = true;
    expect(desktopOfferAvailable()).toBe(false);
  });

  it('is off in a self-hosted build, which has no app of ours to offer', () => {
    flags.platformUi = false;
    expect(desktopOfferAvailable()).toBe(false);
  });
});

describe('desktopDownloadUrl', () => {
  it.each([
    ['code_mode', 'cowork-web-code'],
    ['local_folder', 'cowork-web-folder'],
    ['connector', 'cowork-web-connector'],
  ])('tags %s as %s', (feature, from) => {
    expect(desktopDownloadUrl(feature)).toBe(`https://mindshub.ai/download?os=auto&from=${from}`);
  });

  it('falls back to the plain web tag for an unknown feature', () => {
    expect(desktopDownloadUrl('other')).toBe('https://mindshub.ai/download?os=auto&from=cowork-web');
  });
});
