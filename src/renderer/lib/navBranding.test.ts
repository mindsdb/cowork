import { describe, it, expect, beforeEach } from 'vitest';
import { applyBrandIcons, applyFavicon, applyNavTitleColor, applyOrgFavicon } from './navBranding';
import { AUTH_IMAGE_HOST } from './orgBranding';
import type { DeploymentBrand } from './deploymentBrand';

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

describe('applyBrandIcons', () => {
  const brand = (fields: Partial<DeploymentBrand>): DeploymentBrand => ({
    productName: null, skin: null, theme: null, logoUrl: null, iconUrl: null, appleTouchIconUrl: null, skinLocked: null, ...fields,
  });
  const icon = () => document.querySelector('link[rel="icon"]')!;
  const touch = () => document.querySelector('link[rel="apple-touch-icon"]')!;

  beforeEach(() => {
    document.head.querySelectorAll('link').forEach((link) => link.remove());
    document.head.innerHTML += '<link rel="icon" type="image/svg+xml" href="/minds-icon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">';
  });

  it("points the tab and home-screen icons at the brand's files", () => {
    applyBrandIcons(brand({ iconUrl: '/brand/icon.png?v=1', appleTouchIconUrl: '/brand/apple-touch-icon.png' }));
    expect(icon().getAttribute('href')).toBe('/brand/icon.png?v=1');
    expect(icon().hasAttribute('type')).toBe(false);
    expect(touch().getAttribute('href')).toBe('/brand/apple-touch-icon.png');
  });

  it('leaves each icon the brand does not set, and everything without a brand', () => {
    applyBrandIcons(brand({ iconUrl: '/brand/icon.png' }));
    expect(touch().getAttribute('href')).toBe('/apple-touch-icon.png');
    applyBrandIcons(null);
    expect(icon().getAttribute('href')).toBe('/brand/icon.png');
  });

  it("brings the brand's icon back when a Settings favicon is cleared", () => {
    applyBrandIcons(brand({ iconUrl: '/brand/icon.png?v=1' }));
    applyFavicon('data:image/png;base64,aWNvbg==');
    expect(icon().getAttribute('href')).toBe('data:image/png;base64,aWNvbg==');
    applyFavicon(null);
    expect(icon().getAttribute('href')).toBe('/brand/icon.png?v=1');
    expect(icon().hasAttribute('type')).toBe(false);
  });
});

describe('applyOrgFavicon', () => {
  const ORG_ICON = `https://${AUTH_IMAGE_HOST}/v1/organizations/org-1/branding/icon?v=a1`;
  const icon = () => document.querySelector('link[rel="icon"]')!;

  beforeEach(() => {
    document.head.querySelectorAll('link').forEach((link) => link.remove());
    document.head.innerHTML += '<link rel="icon" type="image/svg+xml" href="/minds-icon.svg">';
  });

  it("uses the org's icon from the auth host and puts the page's own back", () => {
    applyOrgFavicon(ORG_ICON);
    expect(icon().getAttribute('href')).toBe(ORG_ICON);
    expect(icon().hasAttribute('type')).toBe(false);
    applyOrgFavicon(null);
    expect(icon().getAttribute('href')).toBe('/minds-icon.svg');
    expect(icon().getAttribute('type')).toBe('image/svg+xml');
  });

  it.each(['https://images.globex.com/icon.png', `http://${AUTH_IMAGE_HOST}/icon.png`, 'data:image/png;base64,aWNvbg=='])(
    'ignores %s',
    (url) => {
      applyOrgFavicon(url);
      expect(icon().getAttribute('href')).toBe('/minds-icon.svg');
    },
  );

  it('hands over to a Settings favicon and back without losing the page icon', () => {
    applyOrgFavicon(ORG_ICON);
    applyFavicon('data:image/png;base64,aWNvbg==');
    expect(icon().getAttribute('href')).toBe('data:image/png;base64,aWNvbg==');
    applyFavicon(null);
    expect(icon().getAttribute('href')).toBe('/minds-icon.svg');
  });
});

describe('navBranding — navBrand', () => {
  it('marks only the stock product for the stock mark', async () => {
    const { navBrand } = await import('./navBranding');
    expect(navBrand(null, null)).toEqual({ wordmark: 'MindsHub', logo: null, stockMark: true });
    expect(navBrand('Lumen Labs', null).stockMark).toBe(false);
    expect(navBrand(null, 'data:image/png;base64,abc').stockMark).toBe(false);
  });
});
