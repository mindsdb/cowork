// A deployment brand's style and theme defaults, through the real skins
// module. Each case loads the module fresh under one brand, as a page load
// does, against the browser storage the previous loads left behind.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrandLoad, DeploymentBrand } from './deploymentBrand';

const NONE: DeploymentBrand = {
  productName: null, skin: null, theme: null, logoUrl: null, iconUrl: null, appleTouchIconUrl: null, skinLocked: null,
};
const OFF: BrandLoad = { status: 'off' };
const FAILED: BrandLoad = { status: 'failed' };
const loaded = (fields: Partial<DeploymentBrand> = {}): BrandLoad => ({
  status: 'loaded', brand: { ...NONE, ...fields }, dropped: [],
});
const ACME = loaded({ productName: 'Acme Cowork', skin: { id: 'acme', label: 'Acme' }, theme: 'light' });
const BETA = loaded({ skin: { id: 'beta', label: 'Beta' }, theme: 'dark' });
const STOCK = loaded();

async function pageLoad(load: BrandLoad) {
  vi.resetModules();
  vi.doMock('./deploymentBrand', () => ({
    BRAND_LOAD: load,
    DEPLOYMENT_BRAND: load.status === 'loaded' ? load.brand : null,
  }));
  const skins = await import('./skins');
  skins.seedBrandDefaults();
  return skins;
}

const stored = (key: string) => window.localStorage.getItem(key);

/** What the page then shows, as the entry file reads it. */
async function shows(load: BrandLoad) {
  const skins = await pageLoad(load);
  return { skin: skins.loadSkin(), theme: stored('anton.theme') };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.doUnmock('./deploymentBrand');
  vi.restoreAllMocks();
});

describe('the style list', () => {
  it('lists the brand style first and makes it the default', async () => {
    const skins = await pageLoad(ACME);
    expect(skins.SKINS.map((s) => s.id)).toEqual(['acme', 'normal', '8bit', 'custom']);
    expect(skins.SKINS[0]).toEqual({ id: 'acme', label: 'Acme', title: 'Use the Acme look.' });
    expect(skins.DEFAULT_SKIN).toBe('acme');
    expect(skins.normalizeSkin('acme')).toBe('acme');
  });

  it.each([['off', OFF], ['failed', FAILED], ['empty', STOCK]] as const)('stays stock with a %s brand', async (_name, load) => {
    const skins = await pageLoad(load);
    expect(skins.SKINS.map((s) => s.id)).toEqual(['normal', '8bit', 'custom']);
    expect(skins.DEFAULT_SKIN).toBe('normal');
    expect(skins.normalizeSkin('acme')).toBe('normal');
  });

  it('ignores a brand style that reuses a stock id', async () => {
    const skins = await pageLoad(loaded({ skin: { id: '8bit', label: 'Retro' } }));
    expect(skins.SKINS.map((s) => s.label)).toEqual(['Normal', '8-Bit', 'Custom']);
  });
});

describe('the brand defaults', () => {
  it('apply in a fresh browser', async () => {
    expect(await shows(ACME)).toEqual({ skin: 'acme', theme: 'light' });
  });

  it('apply once in a browser that used stock Cowork before', async () => {
    window.localStorage.setItem('anton.skin', 'normal');
    window.localStorage.setItem('anton.theme', 'dark');
    expect(await shows(ACME)).toEqual({ skin: 'acme', theme: 'light' });
  });

  it("apply once in a browser that kept another build's brand keys", async () => {
    window.localStorage.setItem('anton.skin@acme', '8bit');
    window.localStorage.setItem('anton.skin-default', 'acme');
    window.localStorage.setItem('anton.theme-default', 'acme:light');
    window.localStorage.setItem('anton.theme', 'dark');
    expect(await shows(ACME)).toEqual({ skin: 'acme', theme: 'light' });
  });

  it("leave a person's later choice alone while they don't change", async () => {
    await shows(ACME);
    window.localStorage.setItem('anton.skin', '8bit');
    window.localStorage.setItem('anton.theme', 'dark');
    expect(await shows(ACME)).toEqual({ skin: '8bit', theme: 'dark' });
  });

  it('apply again after a switch to an empty brand and back', async () => {
    await shows(ACME);
    window.localStorage.setItem('anton.skin', '8bit');
    window.localStorage.setItem('anton.theme', 'dark');
    // An empty brand sets no style or theme: the saved ones stay.
    expect(await shows(STOCK)).toEqual({ skin: '8bit', theme: 'dark' });
    expect(await shows(ACME)).toEqual({ skin: 'acme', theme: 'light' });
  });

  it('let a leftover brand style fall back to Normal under an empty brand', async () => {
    await shows(ACME);
    expect(await shows(STOCK)).toEqual({ skin: 'normal', theme: 'light' });
  });

  it('apply on a switch to another brand and back', async () => {
    await shows(ACME);
    expect(await shows(BETA)).toEqual({ skin: 'beta', theme: 'dark' });
    expect(await shows(ACME)).toEqual({ skin: 'acme', theme: 'light' });
  });

  it('keep a picked style when only the theme changes', async () => {
    await shows(ACME);
    window.localStorage.setItem('anton.skin', '8bit');
    expect(await shows(loaded({ skin: { id: 'acme', label: 'Acme' }, theme: 'dark' }))).toEqual({ skin: '8bit', theme: 'dark' });
  });

  it('touch only the theme for a brand with a theme alone, and only the style for a style alone', async () => {
    window.localStorage.setItem('anton.skin', '8bit');
    window.localStorage.setItem('anton.theme', 'dark');
    expect(await shows(loaded({ theme: 'light' }))).toEqual({ skin: '8bit', theme: 'light' });
    expect(await shows(loaded({ skin: { id: 'acme', label: 'Acme' } }))).toEqual({ skin: 'acme', theme: 'light' });
  });

  it('apply again over an unreadable record', async () => {
    window.localStorage.setItem('anton.brandDefaults', '{not json');
    expect(await shows(ACME)).toEqual({ skin: 'acme', theme: 'light' });
    window.localStorage.setItem('anton.brandDefaults', '{"skin":7,"theme":"light"}');
    window.localStorage.setItem('anton.skin', '8bit');
    expect(await shows(ACME)).toEqual({ skin: 'acme', theme: 'light' });
  });

  it('write nothing with the platform UI on', async () => {
    window.localStorage.setItem('anton.skin', '8bit');
    expect(await shows(OFF)).toEqual({ skin: '8bit', theme: null });
    expect(stored('anton.brandDefaults')).toBeNull();
  });
});

describe('a brand that failed to load', () => {
  it("applies no defaults and doesn't overwrite the saved brand style", async () => {
    await shows(ACME);
    const skins = await pageLoad(FAILED);
    // The page shows Normal, since the brand style isn't registered...
    expect(skins.loadSkin()).toBe('normal');
    // ...and the app's mount-time save of that must not reach storage.
    skins.persistSkin(skins.loadSkin());
    expect(stored('anton.skin')).toBe('acme');
    expect(await shows(ACME)).toEqual({ skin: 'acme', theme: 'light' });
  });
});

describe('a style lock', () => {
  const LOCKED = loaded({ skinLocked: true });
  const LOCKED_ACME = loaded({ skin: { id: 'acme', label: 'Acme' }, skinLocked: true });

  it('keeps every browser on Normal when the brand sets no style', async () => {
    window.localStorage.setItem('anton.skin', '8bit');
    const skins = await pageLoad(LOCKED);
    expect(skins.SKIN_LOCKED).toBe(true);
    expect(skins.loadSkin()).toBe('normal');
    expect(skins.normalizeSkin('custom')).toBe('normal');
  });

  it("keeps every browser on the brand's own style", async () => {
    window.localStorage.setItem('anton.skin', '8bit');
    const skins = await pageLoad(LOCKED_ACME);
    expect(skins.loadSkin()).toBe('acme');
    expect(skins.normalizeSkin('normal')).toBe('acme');
  });

  it('saves no style over the one the browser saved', async () => {
    window.localStorage.setItem('anton.skin', '8bit');
    const skins = await pageLoad(LOCKED);
    skins.persistSkin(skins.loadSkin());
    skins.persistSkin('custom');
    expect(stored('anton.skin')).toBe('8bit');
  });

  it('gives the saved style back once the lock is off', async () => {
    window.localStorage.setItem('anton.skin', '8bit');
    expect(await shows(LOCKED_ACME)).toEqual({ skin: 'acme', theme: null });
    expect(stored('anton.skin')).toBe('8bit');
    expect(await shows(loaded({ skin: { id: 'acme', label: 'Acme' } }))).toEqual({ skin: '8bit', theme: null });
  });

  it('leaves the theme to the person', async () => {
    window.localStorage.setItem('anton.theme', 'light');
    expect(await shows(LOCKED)).toEqual({ skin: 'normal', theme: 'light' });
  });

  it.each([
    ['a brand with skinLocked false', loaded({ skinLocked: false })],
    ['a brand that failed to load', FAILED],
    ['the platform UI on', OFF],
  ] as const)(
    'is off for %s',
    async (_name, load) => {
      window.localStorage.setItem('anton.skin', '8bit');
      const skins = await pageLoad(load);
      expect(skins.SKIN_LOCKED).toBe(false);
      expect(skins.loadSkin()).toBe('8bit');
    },
  );
});

describe('blocked storage', () => {
  it('throws nothing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const skins = await pageLoad(ACME);
    expect(skins.loadSkin()).toBe('acme');
    expect(() => skins.persistSkin('8bit')).not.toThrow();
  });
});
