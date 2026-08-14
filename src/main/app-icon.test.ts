import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveChannelIconPath } from './app-icon';
import { BUILD_KINDS, CHANNELS } from './channels';

// The runtime window/dock/taskbar icon (getIconPath in index.ts) delegates here.
// Regression guard for the review finding: staging/preview must NOT fall back to
// the prod icon.png after launch — the badged asset is selected instead.
const ASSETS = '/app/assets';
const allExist = () => true;
const noneExist = () => false;

describe('resolveChannelIconPath — runtime channel icon selection', () => {
  it('selects the badged icon for non-prod kinds (not the prod icon)', () => {
    expect(resolveChannelIconPath('preview', ASSETS, allExist)).toBe(
      path.join(ASSETS, 'icon-preview.png'),
    );
    expect(resolveChannelIconPath('stable', ASSETS, allExist)).toBe(
      path.join(ASSETS, 'icon-staging.png'),
    );
  });

  it('uses the base icon.png for prod and dev', () => {
    expect(resolveChannelIconPath('prod', ASSETS, allExist)).toBe(path.join(ASSETS, 'icon.png'));
    expect(resolveChannelIconPath('dev', ASSETS, allExist)).toBe(path.join(ASSETS, 'icon.png'));
  });

  it('resolves under whichever assets dir it is given (packaged vs dev tree)', () => {
    const packaged = '/Applications/App.app/Contents/Resources/assets';
    expect(resolveChannelIconPath('stable', packaged, allExist)).toBe(
      path.join(packaged, 'icon-staging.png'),
    );
  });

  it('falls back to icon.png when the badged asset is missing (no blank dock icon)', () => {
    // nativeImage.createFromPath silently yields an empty image for a missing
    // file; the fallback keeps a real icon on screen instead of a blank one.
    expect(resolveChannelIconPath('preview', ASSETS, noneExist)).toBe(path.join(ASSETS, 'icon.png'));
    expect(resolveChannelIconPath('stable', ASSETS, noneExist)).toBe(path.join(ASSETS, 'icon.png'));
  });

  it('every build kind resolves to its channel iconName from CHANNELS', () => {
    for (const kind of BUILD_KINDS) {
      expect(resolveChannelIconPath(kind, ASSETS, allExist)).toBe(
        path.join(ASSETS, CHANNELS[kind].iconName),
      );
    }
  });
});
