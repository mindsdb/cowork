import { describe, it, expect, beforeEach } from 'vitest';
import { applyFavicon, applyNavTitleColor } from './navBranding';

describe('navBranding — applyNavTitleColor', () => {
  beforeEach(() => {
    document.body.removeAttribute('style');
  });

  it('sets --nav-title-color as an inline body property', () => {
    applyNavTitleColor('#00ff00');
    expect(document.body.style.getPropertyValue('--nav-title-color')).toBe('#00ff00');
  });

  it('clears the property for a null/empty color, falling back to the theme default', () => {
    applyNavTitleColor('#00ff00');
    applyNavTitleColor(null);
    expect(document.body.style.getPropertyValue('--nav-title-color')).toBe('');

    applyNavTitleColor('#00ff00');
    applyNavTitleColor('');
    expect(document.body.style.getPropertyValue('--nav-title-color')).toBe('');
  });
});

describe('applyFavicon', () => {
  beforeEach(() => {
    document.head.querySelectorAll('link').forEach((link) => link.remove());
    document.head.innerHTML += '<link rel="icon" type="image/svg+xml" href="/minds-icon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">';
  });

  it.each(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml', 'image/webp'])('sets the matching type for %s and restores the original icon', (mime) => {
    const icon = document.querySelector('link[rel="icon"]')!;
    const uri = `data:${mime};base64,aWNvbg==`;
    applyFavicon(uri);
    expect(icon.getAttribute('href')).toBe(uri);
    expect(icon.getAttribute('type')).toBe(mime);
    expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe('/apple-touch-icon.png');
    applyFavicon(null);
    expect(icon.getAttribute('href')).toBe('/minds-icon.svg');
    expect(icon.getAttribute('type')).toBe('image/svg+xml');
  });

  it('keeps a branded relative URL and missing type through startup, replacements, and reset', () => {
    const icon = document.querySelector('link[rel="icon"]')!;
    icon.setAttribute('href', './branding/icon-fingerprint.svg');
    icon.removeAttribute('type');
    applyFavicon(undefined);
    expect(icon.getAttribute('href')).toBe('./branding/icon-fingerprint.svg');
    expect(icon.hasAttribute('type')).toBe(false);
    applyFavicon('data:image/png;base64,aWNvbg==');
    applyFavicon('data:image/webp;base64,aWNvbg==');
    applyFavicon('');
    expect(icon.getAttribute('href')).toBe('./branding/icon-fingerprint.svg');
    expect(icon.hasAttribute('type')).toBe(false);
  });

  it('creates an icon only for an override and removes its own link on reset', () => {
    document.querySelector('link[rel="icon"]')?.remove();
    applyFavicon(null);
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
    applyFavicon('data:image/png;base64,aWNvbg==');
    expect(document.querySelector('link[rel="icon"]')).not.toBeNull();
    applyFavicon(null);
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
    expect(document.querySelector('link[rel="apple-touch-icon"]')).not.toBeNull();
  });

  it.each(['https://example.test/icon.png', 'data:text/html;base64,aWNvbg==', 'data:image/jpeg;base64,aWNvbg=='])('ignores unsupported persisted content: %s', (uri) => {
    applyFavicon(uri);
    expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/minds-icon.svg');
  });
});
