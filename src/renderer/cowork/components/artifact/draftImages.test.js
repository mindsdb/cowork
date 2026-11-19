import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchAuthenticatedBlob: vi.fn(),
  apiOrigin: 'https://cowork.example',
}));

vi.mock('../../lib/authenticatedResource', () => ({
  fetchAuthenticatedBlob: mocks.fetchAuthenticatedBlob,
}));
vi.mock('../../../platform/host', () => ({
  host: { getApiOrigin: () => mocks.apiOrigin },
}));

import { resolveDraftImageUrl, useDraftImageLoader } from './draftImages';

const API = 'https://cowork.example';
const FOLDER = '/api/v1/artifacts/drafts/3f2b1c4e-0000-4000-8000-000000000001/9a8b7c6d5e4f40318a2b3c4d5e6f7a8b';
const REPORT = `${FOLDER}/report.md`;

describe('resolveDraftImageUrl', () => {
  it.each([
    ['chart.png', `${API}${FOLDER}/chart.png`],
    ['./chart.png', `${API}${FOLDER}/chart.png`],
    ['img/chart.png', `${API}${FOLDER}/img/chart.png`],
    ['Revenue%20chart.png', `${API}${FOLDER}/Revenue%20chart.png`],
    ['chart.png#top', `${API}${FOLDER}/chart.png`],
  ])('loads %s from the artifact folder', (src, expected) => {
    expect(resolveDraftImageUrl(src, REPORT, API)).toBe(expected);
  });

  it('resolves against the document, so a report in a subfolder reaches back into the artifact', () => {
    const nested = `${FOLDER}/docs/report.md`;
    expect(resolveDraftImageUrl('chart.png', nested, API)).toBe(`${API}${FOLDER}/docs/chart.png`);
    expect(resolveDraftImageUrl('../img/chart.png', nested, API)).toBe(`${API}${FOLDER}/img/chart.png`);
  });

  it('takes an absolute draft URL as well as an origin-relative one', () => {
    expect(resolveDraftImageUrl('chart.png', `${API}${REPORT}`, API)).toBe(`${API}${FOLDER}/chart.png`);
  });

  it.each([
    ['a parent folder', '../other/secret.png'],
    ['an absolute path', '/etc/hosts.png'],
    ['a file: URL', 'file:///tmp/x.png'],
    ['another host', '//attacker.example/x.png'],
    ['an http(s) URL', 'https://attacker.example/x.png'],
    ['an encoded parent folder', '%2e%2e/other/secret.png'],
    ['an encoded separator', '..%2fother%2fsecret.png'],
    ['an encoded backslash', '..%5cother.png'],
    ['backslashes', '..\\other\\secret.png'],
    ['a data: URL', 'data:image/png;base64,AAAA'],
    ['the document itself', 'report.md'],
    ['an empty src', ''],
    ['a blank src', '   '],
  ])('refuses %s', (_label, src) => {
    expect(resolveDraftImageUrl(src, REPORT, API)).toBeNull();
  });

  // Both paths below pass every other check, so each pins its own guard.
  it('refuses another artifact\'s folder in the same project', () => {
    expect(resolveDraftImageUrl('../0123456789abcdef0123456789abcdef/chart.png', REPORT, API)).toBeNull();
  });

  it('refuses another host serving the same path', () => {
    expect(resolveDraftImageUrl(`//attacker.example${FOLDER}/chart.png`, REPORT, API)).toBeNull();
  });

  it('refuses every image when the document has no draft URL of the drafts route', () => {
    expect(resolveDraftImageUrl('chart.png', '', API)).toBeNull();
    expect(resolveDraftImageUrl('chart.png', '/drafts/report.md', API)).toBeNull();
    expect(resolveDraftImageUrl('chart.png', 'data:text/markdown,hi', API)).toBeNull();
  });

  it('refuses a draft URL on another origin, so the credential never leaves the API', () => {
    expect(resolveDraftImageUrl('chart.png', `https://attacker.example${REPORT}`, API)).toBeNull();
  });
});

describe('useDraftImageLoader', () => {
  const png = new Blob(['png'], { type: 'image/png' });

  beforeEach(() => {
    mocks.apiOrigin = API;
    mocks.fetchAuthenticatedBlob.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches an image once, with the artifact version, and answers every later ask from that one request', async () => {
    mocks.fetchAuthenticatedBlob.mockResolvedValue(png);
    const { result } = renderHook(() => useDraftImageLoader(REPORT, 1700));

    await expect(result.current('chart.png')).resolves.toBe(png);
    await expect(result.current('./chart.png')).resolves.toBe(png);

    expect(mocks.fetchAuthenticatedBlob).toHaveBeenCalledTimes(1);
    expect(mocks.fetchAuthenticatedBlob).toHaveBeenCalledWith(`${API}${FOLDER}/chart.png?v=1700`);
  });

  it('remembers a missing file instead of asking again', async () => {
    mocks.fetchAuthenticatedBlob.mockRejectedValue(Object.assign(new Error('Could not load file (404)'), { status: 404 }));
    const { result } = renderHook(() => useDraftImageLoader(REPORT, 1700));

    await expect(result.current('missing.png')).rejects.toMatchObject({ status: 404 });
    await expect(result.current('missing.png')).rejects.toMatchObject({ status: 404 });
    expect(mocks.fetchAuthenticatedBlob).toHaveBeenCalledTimes(1);
  });

  it('refuses a file that is not an image', async () => {
    mocks.fetchAuthenticatedBlob.mockResolvedValue(new Blob(['<p>'], { type: 'text/html' }));
    const { result } = renderHook(() => useDraftImageLoader(REPORT, 1700));

    await expect(result.current('index.html')).rejects.toThrow('Not an image');
  });

  it('asks for nothing when the path is refused', () => {
    const { result } = renderHook(() => useDraftImageLoader(REPORT, 1700));

    expect(result.current('../other/secret.png')).toBeNull();
    expect(mocks.fetchAuthenticatedBlob).not.toHaveBeenCalled();
  });

  it('asks again once the artifact changes', async () => {
    mocks.fetchAuthenticatedBlob.mockResolvedValue(png);
    const { result, rerender } = renderHook(({ version }) => useDraftImageLoader(REPORT, version), {
      initialProps: { version: 1700 },
    });
    const first = result.current;
    await first('chart.png');

    rerender({ version: 1700 });
    expect(result.current).toBe(first);

    rerender({ version: 1800 });
    await result.current('chart.png');
    expect(mocks.fetchAuthenticatedBlob).toHaveBeenLastCalledWith(`${API}${FOLDER}/chart.png?v=1800`);
    expect(mocks.fetchAuthenticatedBlob).toHaveBeenCalledTimes(2);
  });
});
