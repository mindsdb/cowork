import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const made = (label: string, empty = false) => ({ label, isEmpty: () => empty });
  return {
    setDockIcon: vi.fn(),
    windows: [] as { setIcon: ReturnType<typeof vi.fn>; isDestroyed: () => boolean }[],
    createFromPath: vi.fn((p: string) => made(`stock:${p}`)),
    createFromBuffer: vi.fn((b: Buffer) => made(`org:${b.length}`)),
  };
});

vi.mock('electron', () => ({
  app: { dock: { setIcon: electron.setDockIcon }, getPath: () => '/tmp', isPackaged: false },
  BrowserWindow: { getAllWindows: () => electron.windows },
  nativeImage: { createFromPath: electron.createFromPath, createFromBuffer: electron.createFromBuffer },
}));

import { MINDS_AUTH_HOST } from './minds-urls';
import {
  __resetOrgBrandingForTests,
  applyAppIcon,
  loadBrandImage,
  loadDesktopBrandImages,
  loadOrgIconDataUris,
  sniffImageType,
} from './org-branding';

const AUTH = MINDS_AUTH_HOST;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const ICON_URL = `${AUTH}/v1/organizations/org-acme/branding/icon?v=a1`;
const LOGO_URL = `${AUTH}/v1/organizations/org-acme/branding/logo?v=b2`;

let cacheRoot: string;

function response(body: Buffer | object, ok = true) {
  return {
    ok,
    json: async () => body,
    arrayBuffer: async () => {
      const b = body as Buffer;
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  } as unknown as Response;
}

function fetchWith(map: Record<string, Buffer | object | null>) {
  return vi.fn(async (url: string | URL | Request) => {
    const key = Object.keys(map).find((k) => String(url).startsWith(k));
    const body = key ? map[key] : null;
    return body ? response(body) : response({}, false);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function deps(fetchImpl: typeof fetch) {
  return { stockIconPath: '/assets/icon.png', cacheRoot, fetchImpl };
}

beforeEach(() => {
  cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'org-branding-'));
  __resetOrgBrandingForTests();
  electron.setDockIcon.mockClear();
  electron.createFromPath.mockClear();
  electron.createFromBuffer.mockClear();
  electron.windows = [{ setIcon: vi.fn(), isDestroyed: () => false }];
});

afterEach(() => {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
});

describe('sniffImageType', () => {
  it('accepts PNG, JPEG and WebP by their bytes and nothing else', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
  });
});

describe('loadBrandImage', () => {
  it('downloads only from the auth host, and caches by URL', async () => {
    const fetchImpl = fetchWith({ [ICON_URL]: PNG });
    expect(await loadBrandImage(ICON_URL, cacheRoot, fetchImpl)).toMatchObject({ type: 'image/png' });
    expect(await loadBrandImage(ICON_URL, cacheRoot, fetchImpl)).toMatchObject({ type: 'image/png' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const bad of ['https://images.globex.com/icon.png', ICON_URL.replace('https:', 'http:'), 'data:image/png;base64,AA==']) {
      expect(await loadBrandImage(bad, cacheRoot, fetchImpl)).toBeNull();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses SVG, oversized and failed downloads', async () => {
    expect(await loadBrandImage(ICON_URL, cacheRoot, fetchWith({ [ICON_URL]: SVG }))).toBeNull();
    expect(await loadBrandImage(ICON_URL, cacheRoot, fetchWith({ [ICON_URL]: Buffer.concat([PNG, Buffer.alloc(1_000_001)]) }))).toBeNull();
    expect(await loadBrandImage(ICON_URL, cacheRoot, fetchWith({}))).toBeNull();
  });
});

describe('applyAppIcon', () => {
  it('sets the dock and window icons, and the stock icon for null or an empty image', () => {
    const image = { isEmpty: () => false } as never;
    applyAppIcon(image, '/assets/icon.png');
    expect(electron.setDockIcon).toHaveBeenLastCalledWith(image);
    expect(electron.windows[0].setIcon).toHaveBeenLastCalledWith(image);
    applyAppIcon(null, '/assets/icon.png');
    expect(electron.createFromPath).toHaveBeenCalledWith('/assets/icon.png');
    expect(electron.setDockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'stock:/assets/icon.png' }));
    applyAppIcon({ isEmpty: () => true } as never, '/assets/icon.png');
    expect(electron.windows[0].setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'stock:/assets/icon.png' }));
  });
});

describe('loadDesktopBrandImages', () => {
  it("returns the org's images as data URIs and sets its icon as the app icon", async () => {
    const fetchImpl = fetchWith({ [ICON_URL]: PNG, [LOGO_URL]: JPEG });
    const result = await loadDesktopBrandImages({ iconUrl: ICON_URL, logoUrl: LOGO_URL, logoDarkUrl: null }, deps(fetchImpl));
    expect(result?.iconUrl).toMatch(/^data:image\/png;base64,/);
    expect(result?.logoUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(result?.logoDarkUrl).toBeNull();
    expect(electron.setDockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: `org:${PNG.length}` }));
    expect(electron.windows[0].setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: `org:${PNG.length}` }));
  });

  it('puts the stock icon back for no branding, no icon, an untrusted host, or a failed download', async () => {
    for (const urls of [
      null,
      { iconUrl: null, logoUrl: LOGO_URL },
      { iconUrl: 'https://images.globex.com/icon.png' },
      { iconUrl: ICON_URL },
    ]) {
      await loadDesktopBrandImages(urls, deps(fetchWith({ [LOGO_URL]: PNG })));
      expect(electron.setDockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'stock:/assets/icon.png' }));
    }
  });

  it('lets a newer call win over one it overtook', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slowFetch = vi.fn(async () => { await gate; return response(PNG); }) as unknown as typeof fetch;
    const first = loadDesktopBrandImages({ iconUrl: ICON_URL }, deps(slowFetch));
    await loadDesktopBrandImages(null, deps(fetchWith({})));
    release();
    expect(await first).toBeNull();
    expect(electron.setDockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'stock:/assets/icon.png' }));
  });
});

describe('loadOrgIconDataUris', () => {
  it('turns each trusted org icon into a data URI and leaves out the rest, without touching the app icon', async () => {
    const other = `${AUTH}/v1/organizations/org-beta/branding/icon?v=1`;
    const fetchImpl = fetchWith({ [ICON_URL]: PNG, [other]: SVG });
    const result = await loadOrgIconDataUris(
      { 'org-acme': ICON_URL, 'org-beta': other, 'org-gamma': '/v1/organizations/org-gamma/branding/icon', 'org-x': 'https://images.globex.com/i.png' },
      { cacheRoot, fetchImpl },
    );
    expect(Object.keys(result)).toEqual(['org-acme']);
    expect(result['org-acme']).toMatch(/^data:image\/png;base64,/);
    expect(electron.setDockIcon).not.toHaveBeenCalled();
    expect(await loadOrgIconDataUris(null, { cacheRoot, fetchImpl })).toEqual({});
  });
});
