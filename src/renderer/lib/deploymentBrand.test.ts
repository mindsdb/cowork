import { describe, it, expect, vi, afterEach } from 'vitest';
import { TITLE_SNIPPET } from '../../shared/deployment-brand';
import { parseDeploymentBrand, resolveBrandLoad } from './deploymentBrand';

const EMPTY = {
  productName: null, skin: null, theme: null, logoUrl: null, iconUrl: null, appleTouchIconUrl: null, skinLocked: null,
};

describe('parseDeploymentBrand', () => {
  it('keeps every valid field', () => {
    const raw = {
      productName: "  Acme & Co's Cowork ",
      skin: { id: 'ada-co', label: ' Ada ' },
      theme: 'light',
      logoUrl: '/brand/sidebar-logo.svg?v=3f9a1c2b7d10',
      iconUrl: '/brand/icon.png',
      appleTouchIconUrl: '/brand/apple-touch-icon.png?v=91d0c3e4f5a6',
      skinLocked: true,
    };
    expect(parseDeploymentBrand(raw)).toEqual({
      brand: {
        productName: "Acme & Co's Cowork",
        skin: { id: 'ada-co', label: 'Ada' },
        theme: 'light',
        logoUrl: '/brand/sidebar-logo.svg?v=3f9a1c2b7d10',
        iconUrl: '/brand/icon.png',
        appleTouchIconUrl: '/brand/apple-touch-icon.png?v=91d0c3e4f5a6',
        skinLocked: true,
      },
      dropped: [],
    });
  });

  it('keeps skinLocked false as a set value', () => {
    expect(parseDeploymentBrand({ skinLocked: false })).toEqual({ brand: { ...EMPTY, skinLocked: false }, dropped: [] });
  });

  it('reads an empty config as no brand', () => {
    expect(parseDeploymentBrand({})).toEqual({ brand: EMPTY, dropped: [] });
  });

  it('ignores keys it does not know', () => {
    expect(parseDeploymentBrand({ capabilities: { anything: false } })).toEqual({ brand: EMPTY, dropped: [] });
  });

  it.each([
    ['productName', ''],
    ['productName', '   '],
    ['productName', 'x'.repeat(65)],
    ['productName', 42],
    ['skin', { id: 'Ada', label: 'Ada' }],
    ['skin', { id: 'ada_co', label: 'Ada' }],
    ['skin', { id: 'a'.repeat(33), label: 'Ada' }],
    ['skin', { id: 'ada', label: '' }],
    ['skin', { id: 'ada', label: 'x'.repeat(33) }],
    ['skin', 'ada'],
    ['theme', 'system'],
    ['logoUrl', 'https://example.com/logo.svg'],
    ['logoUrl', '//example.com/logo.svg'],
    ['logoUrl', '/other/logo.svg'],
    ['logoUrl', '/brand/../index-web.html'],
    ['logoUrl', '/brand/a/b.svg'],
    ['logoUrl', '/brand/logo.svg?x=1'],
    ['iconUrl', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['appleTouchIconUrl', 'javascript:alert(1)'],
    ['skinLocked', 'true'],
    ['skinLocked', 1],
  ])('drops a bad %s (%j) and keeps the rest', (field, value) => {
    const { brand, dropped } = parseDeploymentBrand({ productName: 'Acme Cowork', [field]: value });
    expect(dropped).toEqual(field === 'productName' ? ['productName'] : [field]);
    expect(brand[field as keyof typeof brand]).toBeNull();
    if (field !== 'productName') expect(brand.productName).toBe('Acme Cowork');
  });

  it('keeps a 64-character name and a 32-character style', () => {
    const { brand } = parseDeploymentBrand({
      productName: 'x'.repeat(64),
      skin: { id: 'a'.repeat(32), label: 'y'.repeat(32) },
    });
    expect(brand.productName).toHaveLength(64);
    expect(brand.skin).toEqual({ id: 'a'.repeat(32), label: 'y'.repeat(32) });
  });
});

describe('resolveBrandLoad', () => {
  it('never reads a brand on a build with the platform UI on', () => {
    expect(resolveBrandLoad(true, { productName: 'Acme Cowork' })).toEqual({ status: 'off' });
  });

  it.each([undefined, null, [], 'Acme', 7])('fails when the config set %j', (raw) => {
    expect(resolveBrandLoad(false, raw)).toEqual({ status: 'failed' });
  });

  it('loads an object', () => {
    expect(resolveBrandLoad(false, { productName: 'Acme Cowork' })).toEqual({
      status: 'loaded', brand: { ...EMPTY, productName: 'Acme Cowork' }, dropped: [],
    });
  });
});

describe('the page-load brand', () => {
  afterEach(() => {
    vi.doUnmock('./deployment');
    vi.resetModules();
    vi.restoreAllMocks();
    window.COWORK_DEPLOYMENT_BRAND = {};
  });

  async function loadWith(platformUi: boolean, raw: unknown) {
    vi.resetModules();
    vi.doMock('./deployment', () => ({ PLATFORM_UI: platformUi }));
    window.COWORK_DEPLOYMENT_BRAND = raw;
    return import('./deploymentBrand');
  }

  it('reports a config that did not load once, naming the file', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await loadWith(false, undefined);
    expect(mod.BRAND_LOAD).toEqual({ status: 'failed' });
    expect(mod.DEPLOYMENT_BRAND).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain('/brand/brand.js');
  });

  it('warns once per field it ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadWith(false, { productName: 'Acme Cowork', theme: 'sepia', logoUrl: 'https://x' });
    expect(mod.DEPLOYMENT_BRAND?.productName).toBe('Acme Cowork');
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      "The deployment brand's theme is not valid and was ignored.",
      "The deployment brand's logoUrl is not valid and was ignored.",
    ]);
  });

  it('stays silent and reads nothing with the platform UI on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await loadWith(true, { productName: 'Acme Cowork' });
    expect(mod.BRAND_LOAD).toEqual({ status: 'off' });
    expect(mod.DEPLOYMENT_BRAND).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});

// The tab title is set by an inline line in the page, before the bundle loads,
// and by nothing else. It must accept exactly the names the parser accepts.
describe('the inline tab-title line agrees with the parser', () => {
  it.each([
    "Acme & Co's Cowork",
    '  Acme Cowork  ',
    '',
    '   ',
    'x'.repeat(64),
    'x'.repeat(65),
    42,
    null,
    undefined,
  ])('for the name %j', (name) => {
    const fakeDocument = { title: 'MindsHub Cowork' };
    const fakeWindow = { COWORK_DEPLOYMENT_BRAND: name === undefined ? {} : { productName: name } };
    new Function('window', 'document', TITLE_SNIPPET)(fakeWindow, fakeDocument);
    const parsed = parseDeploymentBrand(fakeWindow.COWORK_DEPLOYMENT_BRAND as Record<string, unknown>).brand.productName;
    expect(fakeDocument.title).toBe(parsed ?? 'MindsHub Cowork');
  });

  it.each([undefined, null, 'Acme', []])('keeps the stock title when the config set %j', (raw) => {
    const fakeDocument = { title: 'MindsHub Cowork' };
    new Function('window', 'document', TITLE_SNIPPET)({ COWORK_DEPLOYMENT_BRAND: raw }, fakeDocument);
    expect(fakeDocument.title).toBe('MindsHub Cowork');
  });
});
