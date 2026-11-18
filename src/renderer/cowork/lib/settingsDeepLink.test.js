import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureSettingsDeepLink,
  parseSettingsDeepLink,
  takeSettingsDeepLink,
} from './settingsDeepLink';
import { transformSettingsRows } from './settingsTransform';

const loc = (search, pathname = '/', hash = '') => ({ search, pathname, hash });

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('parseSettingsDeepLink', () => {
  it.each([
    ['?settings=appearance&section=branding', { page: 'branding', section: null }],
    ['?settings=branding', { page: 'branding', section: null }],
    ['?settings=branding&section=display', { page: 'branding', section: null }],
    ['?settings=appearance&section=display', { page: 'appearance', section: 'display' }],
    ['?settings=appearance&section=style', { page: 'appearance', section: 'style' }],
    ['?settings=appearance', { page: 'appearance', section: null }],
    ['?settings=appearance&section=elsewhere', { page: 'appearance', section: null }],
    ['?settings=backend&section=branding', null],
    ['?section=branding', null],
    ['', null],
  ])('reads %s', (search, expected) => {
    expect(parseSettingsDeepLink(search)).toEqual(expected);
  });
});

describe('captureSettingsDeepLink', () => {
  it('stashes the link and strips it from the address bar, keeping other params', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    captureSettingsDeepLink(loc('?settings=appearance&section=branding&keep=1', '/c/abc', '#x'));
    expect(replace).toHaveBeenCalledWith(window.history.state, '', '/c/abc?keep=1#x');
    // The console's older link opens Branding.
    expect(takeSettingsDeepLink()).toEqual({ page: 'branding', section: null });
  });

  it('strips an unknown link without stashing it', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    captureSettingsDeepLink(loc('?settings=nowhere'));
    expect(replace).toHaveBeenCalledWith(window.history.state, '', '/');
    expect(takeSettingsDeepLink()).toBeNull();
  });

  it('leaves a page with no Settings link alone', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    captureSettingsDeepLink(loc('?from=console'));
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('takeSettingsDeepLink', () => {
  it('applies once', () => {
    captureSettingsDeepLink(loc('?settings=appearance&section=display'));
    expect(takeSettingsDeepLink()).toEqual({ page: 'appearance', section: 'display' });
    expect(takeSettingsDeepLink()).toBeNull();
  });

  it('drops a link left over from long ago', () => {
    captureSettingsDeepLink(loc('?settings=appearance&section=display'));
    expect(takeSettingsDeepLink(sessionStorage, Date.now() + 11 * 60 * 1000)).toBeNull();
  });

  it.each(['{nope', JSON.stringify({ page: 'backend', at: Date.now() }), JSON.stringify({ page: 'appearance' })])(
    'ignores a bad stash: %s',
    (raw) => {
      sessionStorage.setItem('anton.settingsDeepLink', raw);
      expect(takeSettingsDeepLink()).toBeNull();
    },
  );
});

describe('animated background default', () => {
  it('is off for someone who never set it, and keeps an explicit choice', () => {
    expect(transformSettingsRows([]).showDots).not.toBe(true);
    expect(transformSettingsRows([{ key: 'show_dots', value: 'True' }]).showDots).toBe(true);
    expect(transformSettingsRows([{ key: 'show_dots', value: 'False' }]).showDots).toBe(false);
  });
});
