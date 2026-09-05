import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob, downloadFilename, downloadUrl } from './browserDownload';

let createObjectURL;
let revokeObjectURL;
let clicked;

beforeEach(() => {
  vi.useFakeTimers();
  clicked = [];
  createObjectURL = vi.fn(() => 'blob:object-url');
  revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
    clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downloadFilename', () => {
  /* Blob downloads have no Content-Disposition header; the anchor must carry the filename. */
  it.each([
    ['.anton/anton.md', 'anton.md'],
    ['reports/2026/q1.csv', 'q1.csv'],
    ['docs\\windows\\notes.txt', 'notes.txt'],
    ['report.csv', 'report.csv'],
    ['trailing/slash/', 'slash'],
  ])('takes the basename of %s', (path, expected) => {
    expect(downloadFilename(path)).toBe(expected);
  });

  it.each([[''], [null], [undefined], ['/'], ['\\']])('falls back for %s', (path) => {
    expect(downloadFilename(path)).toBe('download');
    expect(downloadFilename(path, 'artifact')).toBe('artifact');
  });
});

describe('downloadUrl', () => {
  it('clicks an attached anchor carrying the filename, then removes it', () => {
    expect(downloadUrl('https://example.test/report.csv', 'report.csv')).toBe(true);

    expect(clicked).toEqual([{
      href: 'https://example.test/report.csv',
      download: 'report.csv',
      attached: true,
    }]);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('names the file when the caller has no name to give', () => {
    downloadUrl('https://example.test/bytes', '');

    expect(clicked[0].download).toBe('download');
  });

  it('does nothing without a URL', () => {
    expect(downloadUrl('', 'report.csv')).toBe(false);
    expect(clicked).toEqual([]);
  });
});

describe('downloadBlob', () => {
  /* Delay revocation until the browser has started the download. */
  it('keeps the object URL alive well past the click', () => {
    const blob = new Blob(['a,b\n1,2\n'], { type: 'text/csv' });

    downloadBlob(blob, 'report.csv');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked[0]).toMatchObject({ href: 'blob:object-url', download: 'report.csv' });

    vi.advanceTimersByTime(999);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:object-url');
  });

  it('still revokes when the click throws', () => {
    HTMLAnchorElement.prototype.click.mockImplementation(() => {
      throw new Error('navigation blocked');
    });

    expect(() => downloadBlob(new Blob(['x']), 'x.txt')).toThrow('navigation blocked');

    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:object-url');
  });
});
