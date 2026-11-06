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
  refreshDesktopOrgBranding,
  sniffImageType,
} from './org-branding';

const AUTH = MINDS_AUTH_HOST;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const ICON_URL = `${AUTH}/v1/organizations/org-acme/branding/icon?v=a1`;
const LOGO_URL = `${AUTH}/v1/organizations/org-acme/branding/logo?v=b2`;
const ACME = { id: 'org-acme', name: 'acme.example', displayName: 'Acme', isPersonal: false };
const PERSONAL = { id: 'org-me', name: 'personal_u', displayName: 'Personal Organization', isPersonal: true };

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

function deps(over: Partial<Parameters<typeof refreshDesktopOrgBranding>[0]> = {}) {
  return {
    freshAccessToken: async () => 'token',
    listMindsOrgs: async () => ({ orgs: [ACME, PERSONAL], activeOrgId: ACME.id }),
    stockIconPath: '/assets/icon.png',
    cacheRoot,
    ...over,
  };
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
    expect(await loadBrandImage(ICON_URL, 'org-acme', cacheRoot, fetchImpl)).toMatchObject({ type: 'image/png' });
    expect(await loadBrandImage(ICON_URL, 'org-acme', cacheRoot, fetchImpl)).toMatchObject({ type: 'image/png' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const bad of ['https://images.globex.com/icon.png', ICON_URL.replace('https:', 'http:'), 'data:image/png;base64,AA==']) {
      expect(await loadBrandImage(bad, 'org-acme', cacheRoot, fetchImpl)).toBeNull();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses SVG, oversized and failed downloads', async () => {
    expect(await loadBrandImage(ICON_URL, 'org-acme', cacheRoot, fetchWith({ [ICON_URL]: SVG }))).toBeNull();
    expect(await loadBrandImage(ICON_URL, 'org-acme', cacheRoot, fetchWith({ [ICON_URL]: Buffer.concat([PNG, Buffer.alloc(1_000_001)]) }))).toBeNull();
    expect(await loadBrandImage(ICON_URL, 'org-acme', cacheRoot, fetchWith({}))).toBeNull();
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

describe('refreshDesktopOrgBranding', () => {
  const brandingUrl = `${AUTH}/v1/organizations/current/branding/`;

  it("sets the org's icon and returns its images as data URIs", async () => {
    const fetchImpl = fetchWith({ [brandingUrl]: { icon_url: ICON_URL, logo_url: LOGO_URL, logo_dark_url: null }, [ICON_URL]: PNG, [LOGO_URL]: JPEG });
    const result = await refreshDesktopOrgBranding(deps({ fetchImpl }));
    expect(result).toMatchObject({ orgId: 'org-acme', orgName: 'Acme', logoDarkUrl: null });
    expect(result?.iconUrl).toMatch(/^data:image\/png;base64,/);
    expect(result?.logoUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(fetchImpl).toHaveBeenCalledWith(brandingUrl, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }));
    expect(electron.createFromBuffer).toHaveBeenCalled();
    expect(electron.setDockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: `org:${PNG.length}` }));
  });

  it.each([
    ['signed out', { freshAccessToken: async () => null }],
    ['a personal org', { listMindsOrgs: async () => ({ orgs: [ACME, PERSONAL], activeOrgId: PERSONAL.id }) }],
  ])('puts the stock icon back when %s', async (_name, over) => {
    const fetchImpl = fetchWith({});
    expect(await refreshDesktopOrgBranding(deps({ fetchImpl, ...over }))).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(electron.setDockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'stock:/assets/icon.png' }));
  });

  it('puts the stock icon back when auth fails, there is no image, or the icon download fails', async () => {
    for (const map of [
      {},
      { [brandingUrl]: { icon_url: null, logo_url: null } },
      { [brandingUrl]: { icon_url: ICON_URL } },
    ]) {
      expect(await refreshDesktopOrgBranding(deps({ fetchImpl: fetchWith(map) }))).toBeNull();
      expect(electron.setDockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'stock:/assets/icon.png' }));
    }
  });

  it('keeps the stock app icon when the org has a logo but no icon', async () => {
    const fetchImpl = fetchWith({ [brandingUrl]: { icon_url: null, logo_url: LOGO_URL }, [LOGO_URL]: PNG });
    const result = await refreshDesktopOrgBranding(deps({ fetchImpl }));
    expect(result).toMatchObject({ iconUrl: null });
    expect(electron.setDockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'stock:/assets/icon.png' }));
  });

  it('lets a newer read win over one it overtook', async () => {
    let release: () => void = () => {};
    const slow = new Promise<string>((resolve) => { release = () => resolve('token'); });
    const fetchImpl = fetchWith({ [brandingUrl]: { icon_url: ICON_URL }, [ICON_URL]: PNG });
    const first = refreshDesktopOrgBranding(deps({ fetchImpl, freshAccessToken: () => slow }));
    const second = await refreshDesktopOrgBranding(deps({ fetchImpl: fetchWith({}), freshAccessToken: async () => null }));
    release();
    expect(second).toBeNull();
    expect(await first).toBeNull();
    expect(electron.setDockIcon).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'stock:/assets/icon.png' }));
  });
});
